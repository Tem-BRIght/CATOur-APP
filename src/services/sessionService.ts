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

function isPermissionDeniedError(error: unknown): boolean {
  if (!error) return false;

  const code = typeof (error as any)?.code === 'string' ? (error as any).code.toLowerCase() : '';
  const message = typeof (error as any)?.message === 'string' ? (error as any).message.toLowerCase() : '';

  return code === 'permission-denied'
    || message.includes('permission denied')
    || message.includes('missing or insufficient permissions')
    || message.includes('insufficient permissions');
}

async function getSessionProfile(uid: string) {
  try {
    return await getUserProfile(uid);
  } catch (error) {
    // Session records already contain fallback tourist details; private profiles may be unreadable.
    if (isPermissionDeniedError(error)) return null;
    throw error;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Tourist {
  uid: string;
  name: string;
  email: string;
  joinedAt: string;
<<<<<<< HEAD
  status?: 'Joined' | 'Checked-In' | 'Cancelled' | 'Pending' | 'Reviewed';
=======
  status?: 'Joined' | 'Checked-In' | 'Cancelled';
>>>>>>> origin/main
  cancelledAt?: string;
  cancelReason?: string;
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

export interface TourGuideProfile {
  firstName?: string;
  lastName?: string;
  age?: number | string;
  birthdate?: number | string;
  dateOfBirth?: string;
  address?: string;
  region?: string;
  city?: string;
  district?: string;
  barangay?: string;
  nationality?: string;
  photoUrl?: string;
  img?: string;
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
  guideProfile?: TourGuideProfile;
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
  cancelledUids?: string[];
  checkedInUids?: string[];
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

async function enrichGuideProfile(session: TourSession): Promise<TourSession> {
  if (!session.guideId) return session;

  try {
    const guideSnap = await getDoc(doc(firestore, 'tourGuides', session.guideId));
    if (guideSnap.exists()) {
      const guideProfile = guideSnap.data() as TourGuideProfile;
      session.guideProfile = guideProfile;
      session.guidePhotoUrl = guideProfile.photoUrl || guideProfile.img || session.guidePhotoUrl;
      session.guideName = session.guideName || `${guideProfile.firstName || ''} ${guideProfile.lastName || ''}`.trim();
    }
  } catch (error) {
    if (!isPermissionDeniedError(error)) console.warn('[sessionService] guide profile load failed:', error);
  }

  return session;
}

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
    checkedInUids: [],
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
  const startDate = new Date(`${date}T${startTime}:00`);
  const endDate = new Date(`${date}T${endTime}:00`);
  if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
  const startISO = startDate.toISOString();
  const endISO = endDate.toISOString();

  // Look for an existing session for this exact guide + slot start time.
  const existingSnap = await getDocs(
    query(sessionsCol(), where('guideId', '==', guideId), where('startTime', '==', startISO))
  );

  const existingDoc = existingSnap.docs.find((candidate) => (
    (candidate.data() as Partial<TourSession>).status !== 'Cancelled'
  ));

  if (existingDoc) {
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
    tourists: initialTourist ? [{ ...initialTourist, status: 'Joined' as const }] : [],
    touristUids: initialTourist ? [initialTourist.uid] : [],
    checkedInUids: [],
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
    status: tourist.status,
    cancelledAt: tourist.cancelledAt,
    cancelReason: tourist.cancelReason,
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
  const profile = tourist.uid ? await getSessionProfile(tourist.uid) : null;
  const hydratedTourist = hydrateTouristProfile(tourist, profile);
  hydratedTourist.status = 'Joined';

  // Check if already in the list
  const existingTourist = currentTourists.find(t => t.uid === hydratedTourist.uid);
  if (existingTourist && existingTourist.status !== 'Cancelled') {
    const enriched = await Promise.all(currentTourists.map(async (t) => {
      const profile = t.uid ? await getSessionProfile(t.uid) : null;
      return hydrateTouristProfile(t, profile);
    }));
    return enriched;
  }

  // A cancelled roster entry is retained for the admin audit trail. A fresh
  // registration gets a new active roster entry and UID registration.
  // Use arrayUnion so this is a single atomic server-side write instead of a
  // client-side read-then-overwrite — two tourists joining at the same
  // moment can no longer clobber each other's write. touristUids is kept in
  // the same write so the two arrays never drift apart — it's what
  // getUserJoinedSessions() queries against.
  try {
    const update: Record<string, unknown> = {
      tourists: arrayUnion(hydratedTourist),
      touristUids: arrayUnion(hydratedTourist.uid),
    };
    if (existingTourist?.status === 'Cancelled') {
      update.cancelledUids = (data.cancelledUids || []).filter((uid) => uid !== hydratedTourist.uid);
    }
    await updateDoc(ref, update);
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

export async function checkInTouristToSession(
  sessionId: string,
  userId: string,
): Promise<void> {
  if (!userId) throw new Error('User not logged in');

  await runTransaction(firestore, async (transaction) => {
    const ref = sessionDoc(sessionId);
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('Session not found');

    const session = snap.data() as TourSession;
    if (session.status === 'ended' || session.status === 'Cancelled') {
      throw new Error('This tour session is no longer active.');
    }
    if (!Array.isArray(session.touristUids) || !session.touristUids.includes(userId)
      || session.cancelledUids?.includes(userId)) {
      throw new Error('You are not registered for this tour session.');
    }

    const checkedInUids = Array.isArray(session.checkedInUids) ? session.checkedInUids : [];
    if (!checkedInUids.includes(userId)) {
      transaction.update(ref, {
        checkedInUids: [...checkedInUids, userId],
        tourists: (session.tourists || []).map((tourist) => tourist.uid === userId && tourist.status !== 'Cancelled'
          ? { ...tourist, status: 'Checked-In' as const }
          : tourist),
      });
    }
  });
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
      type: 'reserved',
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
<<<<<<< HEAD
    let guideId = '';
    let sessionDate = '';
    let sessionStartTime = '';
    let session: TourSession | null = null;
    let sessionRef: any = null;

    if (sessionId.startsWith('slot:')) {
      const parts = sessionId.split(':');
      guideId = parts[1] || '';
      sessionDate = parts[2] || '';
      sessionStartTime = parts[3] || '';
    } else {
      sessionRef = sessionDoc(sessionId);
      const sessionSnap = await transaction.get(sessionRef);
      if (sessionSnap.exists()) {
        session = sessionSnap.data() as TourSession;
        guideId = session.guideId;
      }
    }

    if (!guideId) throw new Error('Tour guide not found');

    const guideRef = doc(firestore, 'tourGuides', guideId);
=======
    const sessionRef = sessionDoc(sessionId);
    const sessionSnap = await transaction.get(sessionRef);
    if (!sessionSnap.exists()) throw new Error('Session not found');

    const session = sessionSnap.data() as TourSession;
    if (session.status !== 'pending') {
      throw new Error('This tour can only be cancelled before it starts.');
    }
    const tourists = Array.isArray(session.tourists) ? session.tourists : [];
    const tourist = tourists.find((item) => item.uid === userId);
    if (!session.touristUids?.includes(userId) || !tourist) {
      throw new Error('You are not joined to this tour.');
    }
    if (session.checkedInUids?.includes(userId) || tourist.status === 'Checked-In') {
      throw new Error('This tour cannot be cancelled after check-in.');
    }

    const guideRef = doc(firestore, 'tourGuides', session.guideId);
>>>>>>> origin/main
    const guideSnap = await transaction.get(guideRef);
    if (!guideSnap.exists()) throw new Error('Tour guide not found');

    const slots = Array.isArray(guideSnap.data().availabilitySlots)
      ? [...guideSnap.data().availabilitySlots]
      : [];
<<<<<<< HEAD

    let slotIndex = -1;
    if (session?.startTime) {
      const sessionStart = new Date(session.startTime).getTime();
      slotIndex = slots.findIndex((slot: any) =>
        new Date(`${slot.date}T${slot.startTime}:00`).getTime() === sessionStart
      );
    }
    if (slotIndex < 0 && sessionDate && sessionStartTime) {
      slotIndex = slots.findIndex((slot: any) =>
        slot.date === sessionDate && slot.startTime === sessionStartTime
      );
    }
    if (slotIndex < 0) {
      slotIndex = slots.findIndex((slot: any) =>
        Array.isArray(slot.joinedUserIds) && slot.joinedUserIds.includes(userId)
      );
    }

    if (slotIndex >= 0) {
      const slot = { ...slots[slotIndex] };
      const previousBookedCount = Number(slot.bookedCount ?? slot.sessionCount ?? 0);
      const previousSessionCount = Number(slot.sessionCount ?? previousBookedCount);
      const hadSlotRegistration = (Array.isArray(slot.joinedUserIds) ? slot.joinedUserIds : [])
        .includes(userId);
      slot.joinedUserIds = (Array.isArray(slot.joinedUserIds) ? slot.joinedUserIds : [])
        .filter((id: string) => id !== userId);
      slot.bookedCount = Math.max(0, previousBookedCount - (hadSlotRegistration ? 1 : 0));
      slot.sessionCount = Math.max(0, previousSessionCount - (hadSlotRegistration ? 1 : 0));
      slots[slotIndex] = slot;
      transaction.update(guideRef, { availabilitySlots: slots });
    }

    if (session && sessionRef) {
      const tourists = Array.isArray(session.tourists) ? session.tourists : [];
      transaction.update(sessionRef, {
        tourists: tourists.map((item) => item.uid === userId
          ? {
              ...item,
              status: 'Cancelled',
              cancelReason: trimmedReason,
              cancelledAt: new Date().toISOString(),
            }
          : item),
        touristUids: session.touristUids || [],
        cancelledUids: arrayUnion(userId),
        checkedInUids: (session.checkedInUids || []).filter((id) => id !== userId),
      });
    }
=======
    const sessionStart = new Date(session.startTime).getTime();
    const slotIndex = slots.findIndex((slot: any) =>
      new Date(`${slot.date}T${slot.startTime}:00`).getTime() === sessionStart
    );
    if (slotIndex < 0) throw new Error('The assigned tour slot could not be found.');

    const slot = { ...slots[slotIndex] };
    const previousBookedCount = Number(slot.bookedCount ?? slot.sessionCount ?? 0);
    const previousSessionCount = Number(slot.sessionCount ?? previousBookedCount);
    const hadSlotRegistration = (Array.isArray(slot.joinedUserIds) ? slot.joinedUserIds : [])
      .includes(userId);
    slot.joinedUserIds = (Array.isArray(slot.joinedUserIds) ? slot.joinedUserIds : [])
      .filter((id: string) => id !== userId);
    slot.bookedCount = Math.max(0, previousBookedCount - (hadSlotRegistration ? 1 : 0));
    slot.sessionCount = Math.max(0, previousSessionCount - (hadSlotRegistration ? 1 : 0));
    slots[slotIndex] = slot;

    transaction.update(guideRef, { availabilitySlots: slots });
    transaction.update(sessionRef, {
      tourists: tourists.map((item) => item.uid === userId
        ? {
            ...item,
            status: 'Cancelled',
            cancelReason: trimmedReason,
            cancelledAt: new Date().toISOString(),
          }
        : item),
      touristUids: session.touristUids || [],
      cancelledUids: arrayUnion(userId),
      checkedInUids: (session.checkedInUids || []).filter((id) => id !== userId),
    });
>>>>>>> origin/main
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
  const session = await runTransaction(firestore, async (transaction): Promise<TourSession | null> => {
    const ref = sessionDoc(sessionId);
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error('Session not found');

    const current = { id: snap.id, ...snap.data() } as TourSession;
    if (current.status !== 'active') throw new Error('The tour session is not active.');
    if ((current.completedStops || []).includes(stopId)) return null;

    transaction.update(ref, { completedStops: arrayUnion(stopId) });
    return current;
  });

  // Another guide tab may have claimed this stop while this transaction was
  // retrying. Only the transaction winner may create visit analytics.
  if (!session) return;

  const stopName = await getStopName(stopId);
  const checkedInUids = Array.isArray(session.checkedInUids) ? session.checkedInUids : [];
  const checkedInTourists = checkedInUids.length > 0
    ? (session.tourists || []).filter((tourist) => checkedInUids.includes(tourist.uid))
    : [];
  const visitedStop: VisitedStop = {
    destinationId: stopId,
    destinationName: stopName || 'Tour stop',
    visitedAt: new Date().toISOString(),
    touristUids: checkedInTourists.map((tourist) => tourist.uid),
    tourists: checkedInTourists,
  };

  await updateDoc(sessionDoc(sessionId), { visitedStops: arrayUnion(visitedStop) });

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
    let snap = await getDoc(sessionDoc(sessionId));
    let sessionData: Record<string, unknown> | null = snap.exists()
      ? snap.data() as Record<string, unknown>
      : null;

    // Older/generated tour records may survive only in the mirrored bookings
    // collection. Keep the tourist review flow usable for those sessions.
    if (!sessionData) {
      const bookingSnap = await getDoc(doc(firestore, 'bookings', sessionId));
      if (bookingSnap.exists()) sessionData = bookingSnap.data() as Record<string, unknown>;
    }

    if (!sessionData) return null;
    const session = { id: sessionId, ...sessionData } as TourSession;
    await enrichGuideProfile(session);
    if (Array.isArray(session.tourists)) {
      const enrichedTourists = await Promise.all(session.tourists.map(async (tourist) => {
        const profile = tourist.uid ? await getSessionProfile(tourist.uid) : null;
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

function normalizeSessionForViewer(session: TourSession, uid: string): TourSession {
  const touristByUid = new Map<string, Tourist>();
  (session.tourists || []).forEach((tourist) => {
    if (tourist.uid) touristByUid.set(tourist.uid, tourist);
  });
  const tourists = Array.from(touristByUid.values());
  const viewerTourist = tourists.find((tourist) => tourist.uid === uid);
  const viewerCancelled = session.cancelledUids?.includes(uid)
    && viewerTourist?.status === 'Cancelled';

  return {
    ...session,
    tourists,
    ...(viewerCancelled
      ? {
          status: 'Cancelled' as const,
          cancelReason: viewerTourist.cancelReason || session.cancelReason,
          cancelledAt: viewerTourist.cancelledAt || session.cancelledAt,
        }
      : {}),
  };
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
<<<<<<< HEAD
    const existing: TourSession | undefined = sessionMap.get(fallbackId);

    const merged: TourSession = existing
      ? {
          ...existing,
          tourists: existing.tourists || [],
          touristUids: Array.from(new Set([...(existing.touristUids || []), uid])),
        }
      : {
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
          cancelledUids: [],
          checkedInUids: [],
          createdAt: new Date().toISOString(),
          status: 'pending',
          tourTypeId: slot.tourTypeId || '',
          tourTypeName: slot.tourTypeName || 'Tour',
        };
=======
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
>>>>>>> origin/main

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
    const [sessionsSnap, guidesSnap, tourTypesSnap] = await Promise.all([
      // Keep this query scoped to the signed-in tourist so it is allowed by
      // Firestore rules and matches subscribeUserJoinedSessions().
      getDocs(query(sessionsCol(), where('touristUids', 'array-contains', uid))),
      getDocs(collection(firestore, 'tourGuides')),
      getDocs(collection(firestore, 'tourTypes')),
    ]);

    const tourTypeNames = new Map(
      tourTypesSnap.docs.map((tourTypeDoc) => [
        tourTypeDoc.id,
        String(tourTypeDoc.data().name || tourTypeDoc.data().title || ''),
      ])
    );

    const sessions = sessionsSnap.docs
      .map((d) => {
        const session = { id: d.id, ...d.data() } as TourSession;
        return normalizeSessionForViewer({
          ...session,
          tourTypeName: session.tourTypeName || tourTypeNames.get(session.tourTypeId || '') || 'Tour',
        }, uid);
      });

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
          tourTypeName: tourTypeNames.get(data.tourTypeIds?.[0] || '') || 'Tour',
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
      await enrichGuideProfile(session);
<<<<<<< HEAD

      const hasTourists = Array.isArray(session.tourists) && session.tourists.length > 0;
      const touristUids = Array.isArray(session.touristUids) ? session.touristUids : [];
      const hasUids = touristUids.length > 0;

      if (!hasTourists && hasUids) {
        const builtTourists = await Promise.all(
          touristUids.map(async (uid) => {
            const profile = uid ? await getSessionProfile(uid) : null;
            const base: Tourist = {
              uid,
              name: profile?.displayName || profile?.name || '',
              email: profile?.email || '',
              joinedAt: new Date().toISOString(),
              status: 'Pending',
              cancelledAt: undefined,
              cancelReason: undefined,
              gender: '',
              nationality: '',
              religion: '',
              dateOfBirth: '',
              address: '',
              age: 0,
              birthMonth: '',
            };
            if (profile) {
              const hydrated = hydrateTouristProfile(base, profile);
              return { ...base, ...hydrated };
            }
            return base;
          })
        );
        session.tourists = builtTourists;
      } else if (hasTourists) {
=======
      if (Array.isArray(session.tourists)) {
>>>>>>> origin/main
        const enrichedTourists = await Promise.all(session.tourists.map(async (tourist) => {
          const profile = tourist.uid ? await getSessionProfile(tourist.uid) : null;
          return hydrateTouristProfile(tourist, profile);
        }));
        session.tourists = enrichedTourists;
      }
<<<<<<< HEAD

=======
>>>>>>> origin/main
      onChange(session);
    },
    (err) => console.error('[sessionService] subscribeSession error:', err)
  );
}

/**
 * Live tourist history/session state. The session document is the shared
 * source of truth for guide starts, destination progress, cancellation, and
 * closure, so the tourist list must not depend on a one-time read.
 */
export function subscribeUserJoinedSessions(
  uid: string,
  onChange: (sessions: TourSession[]) => void,
): Unsubscribe {
  const sessionsQuery = query(sessionsCol(), where('touristUids', 'array-contains', uid));
  const tourTypeNamesPromise = getDocs(collection(firestore, 'tourTypes'))
    .then((snap) => new Map(snap.docs.map((tourTypeDoc) => [
      tourTypeDoc.id,
      String(tourTypeDoc.data().name || tourTypeDoc.data().title || ''),
    ])))
    .catch(() => new Map<string, string>());
<<<<<<< HEAD
  const guidesPromise = getDocs(collection(firestore, 'tourGuides')).catch(() => null);

=======
>>>>>>> origin/main
  return onSnapshot(
    sessionsQuery,
    async (snap) => {
      const tourTypeNames = await tourTypeNamesPromise;
<<<<<<< HEAD
      const guidesSnap = await guidesPromise || await getDocs(collection(firestore, 'tourGuides')).catch(() => null);

=======
>>>>>>> origin/main
      const sessions = snap.docs
        .map((item) => {
          const session = { id: item.id, ...item.data() } as TourSession;
          return normalizeSessionForViewer({
            ...session,
            tourTypeName: session.tourTypeName || tourTypeNames.get(session.tourTypeId || '') || 'Tour',
          }, uid);
<<<<<<< HEAD
        });

      if (guidesSnap) {
        sessions.forEach((session) => {
          const guideData = guidesSnap.docs.find((guideDoc) => guideDoc.id === session.guideId)?.data() as any;
          if (guideData) {
            session.guidePhotoUrl = session.guidePhotoUrl || guideData.photoUrl || guideData.img || '';
            session.guideName = session.guideName || `${guideData.firstName || ''} ${guideData.lastName || ''}`.trim();
          }
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
              tourTypeName: tourTypeNames.get(data.tourTypeIds?.[0] || '') || 'Tour',
              startTime: slot.startTime || '',
              endTime: slot.endTime || '',
              date: slot.date || '',
              joinedUserIds: slot.joinedUserIds || [],
            }));
        });

        const merged = buildJoinedSessionFallbacks(uid, sessions, guideSlots);
        onChange(merged);
      } else {
        onChange(sessions.sort((a, b) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime()));
      }
=======
        })
        .sort((a, b) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime());
      onChange(sessions);
>>>>>>> origin/main
    },
    (err) => console.error('[sessionService] subscribeUserJoinedSessions error:', err),
  );
}
