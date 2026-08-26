// src/services/sessionService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Manages tour sessions stored in Firestore.
//
// Collection path:  sessions/{sessionId}
//
// ── ID FORMAT ─────────────────────────────────────────────────────────────
// Session (and mirrored booking) IDs are now human-readable sequence codes:
//
//     TOUR-2026-0000-0001
//     TOUR-{year}-{8-digit zero-padded counter, split into two groups of 4}
//
// The counter resets every calendar year and lives in:
//     counters/tourSessions_{year}   →  { count: number }
//
// It's incremented atomically inside a Firestore transaction
// (generateSequentialTourId), so two guides generating a QR at the same
// instant can never collide on the same ID.
//
// IMPORTANT: because the doc ID is no longer derived from
// (guideId + date + startTime) like the old buildSlotSessionId() scheme was,
// getOrCreateSessionForSlot() now looks up an existing session by
// guideId + startTime with a Firestore query instead of guessing the ID.
// This keeps "re-generate QR for the same slot" idempotent (no duplicate
// pending sessions) even though the ID itself is now sequential, not derived.
// ─────────────────────────────────────────────────────────────────────────────

import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, arrayUnion,
  onSnapshot, serverTimestamp, Unsubscribe,
  query, where, getDocs, runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { firestore } from '../firebase';
import { createNotification } from './notificationsService';
import { getUserProfile } from './userProfileService';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Tourist {
  uid: string;
  name: string;
  email: string;
  joinedAt: string;
  gender?: string;
  nationality?: string;
  religion?: string;
  dateOfBirth?: string;
  address?: string;
  age?: number | string;
  birthMonth?: string;
}

export interface VisitedStop {
  destinationId: string;
  destinationName: string;
  visitedAt: string;
  touristUids: string[];
  tourists: Tourist[];
}

export interface TourSession {
  id: string;
  destinationId: string;
  destinationName: string;
  itinerary?: string[];
  tourTypeId?: string;       // ← links session to a tourTypes/{id} doc
  tourTypeName?: string;     // ← e.g. "Heritage Walk", "Food Tour"
  guideId: string;
  guideName: string;
  guidePhotoUrl?: string;
  startTime: string;        // ISO string
  endTime?: string;
  tourists: Tourist[];
  // Mirrors tourists[].map(t => t.uid) as a flat string array. Firestore
  // can't do `array-contains` on an object field looking for a matching
  // `uid` sub-field, so this flat array exists purely so
  // getUserJoinedSessions() can query "every session this uid is on" in a
  // single query, no matter whether they joined via Check Availability
  // (joinTour) or by scanning the guide's QR (addTouristToSession).
  touristUids?: string[];
  completedStops?: string[]; // ← stop IDs the guide has marked as visited (shared live with tourists)
  visitedStops?: VisitedStop[]; // Visit records with the tourists in the session at check-in time
  createdAt: string;
  status: 'pending' | 'active' | 'ended' | 'Cancelled';
  cancelReason?: string;
  cancelledAt?: string;
}

// ── Firestore refs ──────────────────────────────────────────────────────────

const sessionsCol = () => collection(firestore, 'sessions');
const sessionDoc = (sessionId: string) => doc(firestore, 'sessions', sessionId);
const counterDoc = (year: number) => doc(firestore, 'counters', `tourSessions_${year}`);

// ── Sequential, human-readable ID generation ─────────────────────────────────

/**
 * generateSequentialTourId
 * Atomically increments a per-year counter and returns a formatted ID:
 *
 *     TOUR-2026-0000-0001
 *
 * Uses a Firestore transaction so concurrent QR generations (two guides,
 * or rapid "Refresh QR" taps) can never produce the same number.
 */
export async function generateSequentialTourId(): Promise<string> {
  const year = new Date().getFullYear();
  const ref = counterDoc(year);

  const nextNumber = await runTransaction(firestore, async (transaction) => {
    const snap = await transaction.get(ref);
    const current = snap.exists() ? (snap.data().count as number) || 0 : 0;
    const next = current + 1;
    transaction.set(ref, { count: next }, { merge: true });
    return next;
  });

  const padded = String(nextNumber).padStart(8, '0');
  const firstGroup = padded.slice(0, 4);
  const secondGroup = padded.slice(4);

  return `TOUR-${year}-${firstGroup}-${secondGroup}`;
}

// ── Write operations ─────────────────────────────────────────────────────────

/**
 * createSession
 * Creates a new session document using a sequential TOUR-YYYY-####-#### ID.
 * Returns the session ID.
 */
export async function createSession(params: {
  destinationId: string;
  destinationName: string;
  tourTypeId?: string;
  tourTypeName?: string;
  guideId: string;
  guideName: string;
  startTime: string;
  endTime?: string;
}): Promise<string> {
  const { destinationId, destinationName, tourTypeId, tourTypeName, guideId, guideName, startTime, endTime } = params;

  const id = await generateSequentialTourId();

  const sessionData = {
    destinationId,
    destinationName,
    tourTypeId: tourTypeId || '',
    tourTypeName: tourTypeName || '',
    guideId,
    guideName,
    startTime,
    endTime: endTime || '',
    tourists: [],
    touristUids: [],
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  await setDoc(sessionDoc(id), sessionData);
  return id;
}

/**
 * getOrCreateSessionForSlot
 * Looks up (or creates) the session tied to a specific Admin-assigned
 * availability slot — using the slot's REAL date + startTime/endTime
 * instead of just a bare date (which was defaulting to midnight before).
 *
 * CHANGED: previously the doc ID itself was derived from
 * (guideId + date + startTime) via buildSlotSessionId(), so "does a session
 * already exist for this slot" was just a doc-ID lookup. Now that IDs are
 * sequential TOUR-YYYY-####-#### codes, that same slot-uniqueness check is
 * done with a Firestore query on (guideId, startTime) instead.
 *
 * This is what GenerateQR.tsx calls instead of createSession().
 */
export async function getOrCreateSessionForSlot(params: {
  destinationId: string;
  destinationName: string;
  tourTypeId?: string;
  tourTypeName?: string;
  guideId: string;
  guideName: string;
  date: string;       // "YYYY-MM-DD"
  startTime: string;  // "HH:mm"
  endTime: string;    // "HH:mm"
  initialTourist?: Tourist;
}): Promise<TourSession> {
  const { destinationId, destinationName, tourTypeId, tourTypeName, guideId, guideName, date, startTime, endTime, initialTourist } = params;

  // Combine the Admin-assigned date + time-of-day into a real ISO instant —
  // this is the fix for the "midnight bug" (previously only `date` was used).
  const startISO = new Date(`${date}T${startTime}:00`).toISOString();
  const endISO = new Date(`${date}T${endTime}:00`).toISOString();

  // Look for an existing session for this exact guide + slot start time.
  const existingSnap = await getDocs(
    query(sessionsCol(), where('guideId', '==', guideId), where('startTime', '==', startISO))
  );

  if (!existingSnap.empty) {
    const existingDoc = existingSnap.docs[0];
    const existingSession = { id: existingDoc.id, ...existingDoc.data() } as TourSession;
    // CHANGED: keep the admin "Tour Guide Scheduling" booking row in sync
    // even when re-generating for the SAME slot (Refresh QR, remount, etc).
    void upsertBookingRecord(existingSession);
    return existingSession;
  }

  const id = await generateSequentialTourId();
  const ref = sessionDoc(id);

  const sessionData = {
    destinationId,
    destinationName,
    tourTypeId: tourTypeId || '',
    tourTypeName: tourTypeName || '',
    guideId,
    guideName,
    startTime: startISO,
    endTime: endISO,
    tourists: initialTourist ? [initialTourist] : [],
    touristUids: initialTourist ? [initialTourist.uid] : [],
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  await setDoc(ref, sessionData);
  const newSession = { id, ...sessionData } as TourSession;
  // CHANGED: this is the "mapupunta sa Tour Guide Scheduling" hookup —
  // Tour Type + Date + Time picked in GenerateQR.tsx now creates/updates a
  // matching row on the Admin's Tour Guide Scheduling table, using the same
  // TOUR-YYYY-####-#### ID as both the session doc ID and the booking doc ID.
  void upsertBookingRecord(newSession);
  return newSession;
}

// ── Admin sync: Tour Guide Scheduling ────────────────────────────────────────
// tour-guide-management.page.html (Admin → "Tour Guide Scheduling") reads a
// `bookings` collection and binds: booking.id, booking.guideName,
// booking.tourDate, booking.tourists (count), booking.status
// ('On-going' | 'Completed' | 'Cancelled'). The "Session ID" column shows
// booking.id — which is now the same TOUR-YYYY-####-#### code shown on the
// guide's Generate QR screen, since bookings/{sessionId} always mirrors
// sessions/{sessionId} 1:1.

function mapSessionStatusToBookingStatus(
  status: TourSession['status']
): 'On-going' | 'Completed' | 'Cancelled' {
  if (status === 'ended') return 'Completed';
  return 'On-going'; // both 'pending' and 'active' show as On-going on the admin table
}

/**
 * upsertBookingRecord
 * Mirrors a session into bookings/{sessionId} so the guide's generated QR
 * (tour type + date + time) immediately shows up on the Admin's
 * "Tour Guide Scheduling" page. Doc ID == session ID, so this is always a
 * safe overwrite — never creates duplicate booking rows for the same tour.
 */
export async function upsertBookingRecord(session: TourSession): Promise<void> {
  try {
    const tourDate = session.startTime
      ? new Date(session.startTime).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : '';

    await setDoc(
      doc(firestore, 'bookings', session.id),
      {
        id: session.id,
        guideId: session.guideId,
        guideName: session.guideName,
        destinationId: session.destinationId,
        destinationName: session.destinationName,
        tourTypeId: session.tourTypeId || '',
        tourTypeName: session.tourTypeName || '',
        tourDate,
        startTime: session.startTime,
        endTime: session.endTime || '',
        tourists: session.tourists?.length || 0,
        status: mapSessionStatusToBookingStatus(session.status),
        cancelReason: session.cancelReason || '',
        cancelledAt: session.cancelledAt || '',
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.error('[sessionService] upsertBookingRecord failed:', err);
  }
}

/**
 * addTouristToSession
 * Adds a tourist to the session's tourists array (if not already present).
 * Returns the updated tourist list.
 */
function getAgeFromBirthDate(dateString: string): number | '' {
  if (!dateString) return '';

  const birth = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return '';

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());

  if (!hasBirthdayPassed) age -= 1;
  return age > 0 ? age : 0;
}

export function hydrateTouristProfile(
  tourist: Partial<Tourist> & { uid?: string },
  profile: Partial<any> | null | undefined
): Tourist {
  const birthDate = tourist.dateOfBirth || profile?.dateOfBirth || '';
  const monthName = birthDate
    ? new Date(`${birthDate}T00:00:00`).toLocaleString('en-US', { month: 'long' })
    : '';

  const computedAge = tourist.age ?? profile?.age ?? getAgeFromBirthDate(birthDate);

  return {
    uid: tourist.uid || '',
    name: tourist.name || profile?.name?.firstname || profile?.displayName || '',
    email: tourist.email || profile?.email || '',
    joinedAt: tourist.joinedAt || new Date().toISOString(),
    gender: tourist.gender || profile?.gender || '',
    nationality: tourist.nationality || profile?.nationality || '',
    religion: tourist.religion || profile?.religion || '',
    dateOfBirth: birthDate,
    address: tourist.address || profile?.address || '',
    age: computedAge,
    birthMonth: tourist.birthMonth || monthName,
  };
}

export async function addTouristToSession(
  sessionId: string,
  tourist: Tourist
): Promise<Tourist[]> {
  const ref = sessionDoc(sessionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Session not found');

  const data = snap.data() as TourSession;
  const currentTourists = data.tourists || [];
  const profile = tourist.uid ? await getUserProfile(tourist.uid) : null;
  const hydratedTourist = hydrateTouristProfile(tourist, profile);

  // Check if already in the list
  const exists = currentTourists.some(t => t.uid === hydratedTourist.uid);
  if (exists) {
    const enriched = await Promise.all(currentTourists.map(async (t) => {
      const profile = t.uid ? await getUserProfile(t.uid) : null;
      return hydrateTouristProfile(t, profile);
    }));
    return enriched;
  }

  // Use arrayUnion so this is a single atomic server-side write instead of a
  // client-side read-then-overwrite — two tourists joining at the same
  // moment can no longer clobber each other's write. touristUids is kept in
  // the same write so the two arrays never drift apart — it's what
  // getUserJoinedSessions() queries against.
  try {
    await updateDoc(ref, {
      tourists: arrayUnion(hydratedTourist),
      touristUids: arrayUnion(hydratedTourist.uid),
    });
  } catch (err: any) {
    // Surface permission errors loudly instead of failing silently — if your
    // Firestore rules only allow the guide (owner) to write to sessions/{id},
    // a tourist's join will fail here with 'permission-denied' and the
    // tourists array will never grow even though the session loads fine.
    console.error('[sessionService] addTouristToSession failed:', err?.code || err);
    throw err;
  }

  const updatedTourists = [...currentTourists, hydratedTourist];
  // Keep the admin booking row's tourist count current.
  void upsertBookingRecord({ ...data, id: sessionId, tourists: updatedTourists });

  return updatedTourists;
}

/**
 * updateSessionStatus
 * Updates the session status to 'active' or 'ended'.
 */
export async function updateSessionStatus(
  sessionId: string,
  status: 'active' | 'ended' | 'Cancelled',
  reason?: string
): Promise<void> {
  const current = await getSession(sessionId);
  const update: any = { status };

  if (status === 'active') {
    const nowIso = new Date().toISOString();
    const hasRealStart = !!current?.startTime && !Number.isNaN(new Date(current.startTime).getTime());
    if (!hasRealStart || (current?.status !== 'active' && current?.status !== 'ended')) {
      update.startTime = nowIso;
    }
  }

  if (status === 'ended' || status === 'Cancelled') {
    update.endTime = new Date().toISOString();
  }

  if (status === 'Cancelled') {
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    update.cancelReason = trimmedReason || 'No reason provided';
    update.cancelledAt = new Date().toISOString();
  }

  await updateDoc(sessionDoc(sessionId), update);

  const updated = await getSession(sessionId);
  if (updated) {
    void upsertBookingRecord(updated);

    const activityType = status === 'active' ? 'started' : status === 'ended' ? 'completed' : 'cancelled';
    const activityTitle = status === 'active' ? `Tour Started: ${updated.destinationName}` : status === 'ended' ? `Tour Ended: ${updated.destinationName}` : `Tour Cancelled: ${updated.destinationName}`;

    try {
      await addDoc(collection(firestore, 'activityLog'), {
        type: activityType,
        title: activityTitle,
        sessionId: updated.id,
        timestamp: serverTimestamp(),
        extra: {
          destinationName: updated.destinationName,
          guideName: updated.guideName,
          status: updated.status,
        },
      });
    } catch (err) {
      console.warn('[sessionService] Failed to write activity log:', err);
    }

    if (status === 'Cancelled') {
      return;
    }

    const title = status === 'active' ? 'Tour Started' : 'Tour Ended';
    const message = status === 'active'
      ? `The tour "${updated.destinationName}" has started!`
      : `The tour "${updated.destinationName}" has ended.`;

    await Promise.all(updated.tourists.map(tourist => createNotification({
      userId: tourist.uid,
      type: 'location',
      title,
      message,
    })));
  }
}

async function getStopName(stopId: string): Promise<string> {
  try {
    const snap = await getDoc(doc(firestore, 'destinations', stopId));
    if (!snap.exists()) return '';
    const data = snap.data() as any;
    return data.title || data.name || '';
  } catch {
    return '';
  }
}

export async function cancelSession(sessionId: string, reason?: string): Promise<void> {
  await updateSessionStatus(sessionId, 'Cancelled', reason);
}

export async function cancelJoinedSession(
  sessionId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error('Please provide a valid reason for cancelling this tour.');

  await runTransaction(firestore, async (transaction) => {
    const sessionRef = sessionDoc(sessionId);
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists()) throw new Error('Session not found');

    const session = sessionSnap.data() as TourSession;
    if (session.status !== 'pending') {
      throw new Error('This tour can only be cancelled before it starts.');
    }
    if (!session.touristUids?.includes(userId)) {
      throw new Error('You are not joined to this tour.');
    }

    const guideRef = doc(firestore, 'tourGuides', session.guideId);
    const guideSnap = await transaction.get(guideRef);
    if (!guideSnap.exists()) throw new Error('Tour guide not found');

    const slots = Array.isArray(guideSnap.data().availabilitySlots)
      ? [...guideSnap.data().availabilitySlots]
      : [];
    const sessionStart = new Date(session.startTime).getTime();
    const slotIndex = slots.findIndex((slot: any) =>
      new Date(`${slot.date}T${slot.startTime}:00`).getTime() === sessionStart
    );
    if (slotIndex < 0) throw new Error('The assigned tour slot could not be found.');

    const slot = { ...slots[slotIndex] };
    const previousBookedCount = Number(slot.bookedCount ?? slot.sessionCount ?? 0);
    const previousSessionCount = Number(slot.sessionCount ?? previousBookedCount);
    slot.joinedUserIds = (Array.isArray(slot.joinedUserIds) ? slot.joinedUserIds : [])
      .filter((id: string) => id !== userId);
    slot.bookedCount = Math.max(0, previousBookedCount - 1);
    slot.sessionCount = Math.max(0, previousSessionCount - 1);
    slots[slotIndex] = slot;

    transaction.update(guideRef, { availabilitySlots: slots });
    transaction.update(sessionRef, {
      status: 'Cancelled',
      cancelReason: trimmedReason,
      cancelledAt: new Date().toISOString(),
    });
  });
}

/**
 * markStopVisited
 * Guide-only action: flags a tour stop (by destination ID) as visited/done.
 * Written atomically with arrayUnion so it's safe even if called in quick
 * succession, and it's picked up live by tourists via subscribeSession —
 * this is what powers the "tapos na sila sa destination" indicator on the
 * tourist's TourSession view.
 */
export async function markStopVisited(sessionId: string, stopId: string): Promise<void> {
  try {
    const session = await getSession(sessionId);
    if (!session) return;

    const stopName = await getStopName(stopId);
    const visitedStop: VisitedStop = {
      destinationId: stopId,
      destinationName: stopName || 'Tour stop',
      visitedAt: new Date().toISOString(),
      touristUids: (session.tourists || []).map((tourist) => tourist.uid),
      tourists: session.tourists || [],
    };

    await updateDoc(sessionDoc(sessionId), {
      completedStops: arrayUnion(stopId),
      visitedStops: arrayUnion(visitedStop),
    });

    // One deterministic visit per scanned tourist and destination. This is
    // what feeds Admin -> Tours visits without double-counting re-renders or
    // repeated taps on the same stop.
    await Promise.all(visitedStop.tourists
      .filter((tourist) => !!tourist.uid)
      .map((tourist) => setDoc(
        doc(firestore, 'visits', `${sessionId}__${stopId}__${tourist.uid}`),
        {
          sessionId,
          userId: tourist.uid,
          visitorId: tourist.uid,
          destinationId: stopId,
          destinationTop: visitedStop.destinationName,
          scannedAt: visitedStop.visitedAt,
          visitSource: 'tour-session',
        },
        { merge: true }
      )));

    await addDoc(collection(firestore, 'activityLog'), {
      type: 'checkin',
      title: `Destination visited: ${visitedStop.destinationName}`,
      sessionId,
      timestamp: serverTimestamp(),
      extra: {
        destinationId: stopId,
        destinationName: visitedStop.destinationName,
        guideName: session.guideName,
        tourName: session.destinationName,
        touristUids: visitedStop.touristUids,
        touristCount: visitedStop.tourists.length,
      },
    });
  } catch (err) {
    console.warn('[sessionService] Failed to write destination activity log:', err);
  }
}

/**
 * unmarkStopVisited
 * Reverts a stop back to "not yet visited" — lets the guide undo a mistaken tap.
 */
export async function unmarkStopVisited(sessionId: string, stopId: string): Promise<void> {
  const snap = await getDoc(sessionDoc(sessionId));
  if (!snap.exists()) return;
  const data = snap.data() as TourSession;
  const remaining = (data.completedStops || []).filter((id) => id !== stopId);
  const remainingVisitedStops = (data.visitedStops || []).filter(
    (stop) => stop.destinationId !== stopId
  );
  await updateDoc(sessionDoc(sessionId), {
    completedStops: remaining,
    visitedStops: remainingVisitedStops,
  });

  const tourists = data.tourists || [];
  await Promise.all(tourists
    .filter((tourist) => !!tourist.uid)
    .map((tourist) => deleteDoc(
      doc(firestore, 'visits', `${sessionId}__${stopId}__${tourist.uid}`)
    )));
}

// ── Read operations ──────────────────────────────────────────────────────────

/**
 * getSession
 * Fetches a single session document.
 */
export async function getSession(sessionId: string): Promise<TourSession | null> {
  try {
    const snap = await getDoc(sessionDoc(sessionId));
    if (!snap.exists()) return null;
    const session = { id: snap.id, ...snap.data() } as TourSession;
    if (Array.isArray(session.tourists)) {
      const enrichedTourists = await Promise.all(session.tourists.map(async (tourist) => {
        const profile = tourist.uid ? await getUserProfile(tourist.uid) : null;
        return hydrateTouristProfile(tourist, profile);
      }));
      session.tourists = enrichedTourists;
    }
    return session;
  } catch (err) {
    console.error('[sessionService] getSession error:', err);
    return null;
  }
}

/**
 * getUserJoinedSessions
 * Every session this tourist is on, regardless of whether they joined via
 * "Check Availability" (tourScheduleService.joinTour) or by scanning the
 * guide's QR (addTouristToSession from TourSession.tsx) — both paths now
 * write into the same touristUids array, so this single query is the
 * correct source of truth for a tourist-facing "My Tours" / history screen.
 * Sorted newest-first by startTime (client-side, since startTime is a plain
 * ISO string rather than a Firestore Timestamp).
 *
 * NOTE: if you add an orderBy() to this query later, Firestore will need a
 * composite index on (touristUids array-contains, startTime) — leaving the
 * sort client-side avoids requiring that index to be created manually.
 */
function normalizeSlotIsoValue(date: string, timeValue: string | undefined, fallbackTime = '00:00'): string {
  const value = (timeValue || fallbackTime).trim();

  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}T/.test(value) || /Z$/i.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }

  if (!date) return '';
  const parsed = new Date(`${date}T${value}:00`);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

export function buildJoinedSessionFallbacks(
  uid: string,
  sessions: TourSession[],
  guideSlots: Array<{
    guideId: string;
    guideName: string;
    guidePhotoUrl?: string;
    destinationId: string;
    destinationName: string;
    tourTypeId?: string;
    tourTypeName?: string;
    startTime: string;
    endTime?: string;
    date: string;
    joinedUserIds?: string[];
  }>
): TourSession[] {
  const sessionMap = new Map<string, TourSession>();

  sessions.forEach((session) => {
    const hasUidInFlatList = Array.isArray(session.touristUids) && session.touristUids.includes(uid);
    const hasUidInTouristsList = Array.isArray(session.tourists) && session.tourists.some((tourist) => tourist.uid === uid);

    if (hasUidInFlatList || hasUidInTouristsList) {
      sessionMap.set(session.id, session);
    }
  });

  guideSlots.forEach((slot) => {
    if (!Array.isArray(slot.joinedUserIds) || !slot.joinedUserIds.includes(uid)) return;

    const fallbackId = `slot:${slot.guideId}:${slot.date}:${slot.startTime}`;
    const existing = sessionMap.get(fallbackId);

    const merged: TourSession = existing || {
      id: fallbackId,
      destinationId: slot.destinationId,
      destinationName: slot.destinationName,
      guideId: slot.guideId,
      guideName: slot.guideName,
      guidePhotoUrl: slot.guidePhotoUrl,
      startTime: normalizeSlotIsoValue(slot.date, slot.startTime),
      endTime: normalizeSlotIsoValue(slot.date, slot.endTime),
      tourists: [],
      touristUids: [uid],
      createdAt: new Date().toISOString(),
      status: 'pending',
      tourTypeId: slot.tourTypeId || '',
      tourTypeName: slot.tourTypeName || 'Tour',
    };

    if (!existing) {
      sessionMap.set(fallbackId, merged);
    }
  });

  return Array.from(sessionMap.values()).sort((a, b) => {
    const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
    const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
    return bTime - aTime;
  });
}

export async function getUserJoinedSessions(uid: string): Promise<TourSession[]> {
  try {
    const [sessionsSnap, guidesSnap] = await Promise.all([
      getDocs(query(sessionsCol(), where('touristUids', 'array-contains', uid))),
      getDocs(collection(firestore, 'tourGuides')),
    ]);

    const sessions = sessionsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as TourSession));

    sessions.forEach((session) => {
      const guideData = guidesSnap.docs.find((guideDoc) => guideDoc.id === session.guideId)?.data() as any;
      session.guidePhotoUrl = guideData?.photoUrl || guideData?.img || '';
    });

    const guideSlots = guidesSnap.docs.flatMap((guideDoc) => {
      const data = guideDoc.data() as any;
      const slots = Array.isArray(data.availabilitySlots) ? data.availabilitySlots : [];

      return slots
        .filter((slot: any) => Array.isArray(slot.joinedUserIds) && slot.joinedUserIds.includes(uid))
        .map((slot: any) => ({
          guideId: guideDoc.id,
          guideName: `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown Guide',
          guidePhotoUrl: data.photoUrl || data.img || '',
          destinationId: data.assignedDestId || '',
          destinationName: data.assignedDestName || 'Unknown',
          tourTypeId: data.tourTypeIds?.[0] || '',
          tourTypeName: 'Tour',
          startTime: slot.startTime || '',
          endTime: slot.endTime || '',
          date: slot.date || '',
          joinedUserIds: slot.joinedUserIds || [],
        }));
    });

    return buildJoinedSessionFallbacks(uid, sessions, guideSlots);
  } catch (err) {
    console.error('[sessionService] getUserJoinedSessions failed:', err);
    return [];
  }
}

/**
 * subscribeSession
 * Real-time listener for a session.
 * Returns an unsubscribe function.
 */
export function subscribeSession(
  sessionId: string,
  onChange: (session: TourSession | null) => void
): Unsubscribe {
  return onSnapshot(
    sessionDoc(sessionId),
    async (snap) => {
      if (!snap.exists()) { onChange(null); return; }
      const session = { id: snap.id, ...snap.data() } as TourSession;
      if (Array.isArray(session.tourists)) {
        const enrichedTourists = await Promise.all(session.tourists.map(async (tourist) => {
          const profile = tourist.uid ? await getUserProfile(tourist.uid) : null;
          return hydrateTouristProfile(tourist, profile);
        }));
        session.tourists = enrichedTourists;
      }
      onChange(session);
    },
    (err) => console.error('[sessionService] subscribeSession error:', err)
  );
}
