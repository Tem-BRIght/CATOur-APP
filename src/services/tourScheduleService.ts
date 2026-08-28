// services/tourScheduleService.ts
import {
  getFirestore, collection, getDocs, doc, runTransaction, updateDoc,
  query, where, documentId,
} from 'firebase/firestore';
import { getOrCreateSessionForSlot, addTouristToSession } from './sessionService';
import { getUserProfile } from './userProfileService';
import { createNotification } from './notificationsService';

export interface TourSlot {
  startTime: string;
  endTime: string;
  maxSpots: number;
  bookedCount: number;
  joinedUserIds: string[];
  date: string;
  // CHANGED: index into the guide's RAW `availabilitySlots` array in
  // Firestore — NOT the position of this slot in whatever filtered/sorted
  // list the UI builds. joinTour() indexes straight into the unfiltered
  // array, so this is the value that must be passed to it. Previously the
  // UI passed the filtered-array position instead, which could silently
  // book the wrong slot whenever the raw array wasn't already
  // today-only-and-in-order.
  rawIndex: number;
}

export interface TourSchedule {
  id: string;                 // guide document ID
  guideName: string;
  guideId: string;
  destinationName: string;
  destinationId: string;
  date: string;
  slots: TourSlot[];
}

export interface TourGuideSchedule {
  guideId: string;
  guideName: string;
  guidePhotoUrl?: string;
  destinationName: string;
  destinationId: string;
  date: string;
  slots: TourSlot[];
}

export interface TourTypeWithSchedules {
  id: string;
  name: string;
  duration?: string;
  description?: string;
  // CHANGED: resolved destination names for "Places You'll Visit", pulled
  // from tourTypes/{id}.destinations (an array of destination IDs) — the
  // same field TourSession.tsx already reads on the guide/tourist session
  // screen. No invented copy — if the admin hasn't pinned destinations for
  // a tour type, this is just an empty array.
  places: string[];
  guides: TourGuideSchedule[];
}

const db = getFirestore();

export function resolveGuideTourTypeIds(
  guideData: any,
  typeMap: Map<string, { destinationIds: string[] }>
): string[] {
  const explicit = Array.isArray(guideData?.tourTypeIds) ? guideData.tourTypeIds : [];
  if (explicit.length > 0) return explicit;

  const assignedDestinationIds = Array.isArray(guideData?.assignedDestinationIds)
    ? guideData.assignedDestinationIds
    : [];
  const fallbackDestId = guideData?.assignedDestId ? String(guideData.assignedDestId) : '';
  const destinations = new Set<string>([
    ...assignedDestinationIds.map((id: string) => String(id)),
    ...(fallbackDestId ? [fallbackDestId] : []),
  ]);

  if (destinations.size === 0) return [];

  return Array.from(typeMap.entries())
    .filter(([, info]) => info.destinationIds.some((id) => destinations.has(id)))
    .map(([typeId]) => typeId);
}

function isSlotJoinable(slot: any): boolean {
  const maxSpots = Number(slot?.maxSpots ?? 10);
  const bookedCount = Number(slot?.bookedCount ?? slot?.sessionCount ?? 0);
  if (!Number.isFinite(maxSpots) || maxSpots <= 0) return false;
  if (bookedCount >= maxSpots) return false;

  const date = String(slot?.date || '');
  const endTime = String(slot?.endTime || '23:59');
  if (!date) return false;

  const now = new Date();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  if (date < todayStr) return false;
  if (date === todayStr) {
    const slotStartDate = new Date(`${date}T${String(slot?.startTime || '00:00')}:00`);
    const slotEndDate = new Date(`${date}T${endTime}:00`);
    if (slotEndDate <= slotStartDate) slotEndDate.setDate(slotEndDate.getDate() + 1);
    const slotEndMs = slotEndDate.getTime();
    if (Number.isNaN(slotEndMs) || slotEndMs <= now.getTime()) return false;
  }

  return true;
}

export interface TourBookingConflict {
  hasConflict: boolean;
  type: 'same_tour_type_same_day' | 'time_overlap' | null;
  message?: string;
  conflictingTourName?: string;
}

export function parseSlotTimeRange(date: string, startTime: string, endTime: string): { startMs: number; endMs: number } {
  const startMs = new Date(`${date}T${startTime}:00`).getTime();
  let endMs = new Date(`${date}T${endTime}:00`).getTime();
  if (Number.isNaN(endMs) || endMs <= startMs) {
    endMs = startMs + 60 * 60 * 1000;
  }
  return { startMs, endMs };
}

export function checkTourBookingConflict(
  sessions: Array<{
    status?: string;
    tourTypeId?: string;
    tourTypeName?: string;
    cancelledUids?: string[];
    startTime?: string;
    endTime?: string;
    date?: string;
  }>,
  target: {
    tourTypeId: string;
    date: string;
    startTime: string;
    endTime: string;
  },
  userId?: string,
): TourBookingConflict {
  const { startMs: targetStart, endMs: targetEnd } = parseSlotTimeRange(target.date, target.startTime, target.endTime);

  for (const session of sessions || []) {
    // Skip cancelled sessions or sessions where this user's registration was cancelled
    if (session.status === 'Cancelled') continue;
    if (userId && session.cancelledUids?.includes(userId)) continue;

    // Determine session's date string (YYYY-MM-DD)
    let sessionDate = session.date || '';
    let sessionStartMs = 0;
    let sessionEndMs = 0;

    if (session.startTime) {
      const d = new Date(session.startTime);
      if (!Number.isNaN(d.getTime())) {
        sessionStartMs = d.getTime();
        if (!sessionDate) {
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          sessionDate = `${year}-${month}-${day}`;
        }
      }
    }

    if (session.endTime) {
      const d = new Date(session.endTime);
      if (!Number.isNaN(d.getTime())) {
        sessionEndMs = d.getTime();
      }
    }

    if (sessionStartMs > 0 && (sessionEndMs <= sessionStartMs || Number.isNaN(sessionEndMs))) {
      sessionEndMs = sessionStartMs + 60 * 60 * 1000;
    }

    // 1. Same tour type on the same date (Rule: 1 tour type per day to every tourist)
    if (session.tourTypeId === target.tourTypeId && sessionDate === target.date) {
      return {
        hasConflict: true,
        type: 'same_tour_type_same_day',
        message: 'You have already joined this tour type for this date. Tourists can join only one session per tour type per day.',
        conflictingTourName: session.tourTypeName,
      };
    }

    // 2. Overlapping date and time on the same date (Rule: conflict on different tour type but same date and time)
    if (sessionDate === target.date && sessionStartMs > 0 && sessionEndMs > 0 && !Number.isNaN(targetStart) && !Number.isNaN(targetEnd)) {
      const isOverlap = targetStart < sessionEndMs && targetEnd > sessionStartMs;
      if (isOverlap) {
        return {
          hasConflict: true,
          type: 'time_overlap',
          message: `This session conflicts with another tour (${session.tourTypeName || 'Scheduled Tour'}) you have already joined on the same date and time.`,
          conflictingTourName: session.tourTypeName,
        };
      }
    }
  }

  return { hasConflict: false, type: null };
}

export function hasTourTypeConflict(
  sessions: Array<{
    status?: string;
    tourTypeId?: string;
    tourTypeName?: string;
    cancelledUids?: string[];
    startTime?: string;
    endTime?: string;
    date?: string;
  }>,
  targetOrTourTypeId: string | { tourTypeId: string; date: string; startTime: string; endTime: string },
  userId?: string,
): boolean {
  if (typeof targetOrTourTypeId === 'string') {
    return sessions.some((session) => (
      session.status !== 'Cancelled' && session.tourTypeId === targetOrTourTypeId
        && (!userId || !session.cancelledUids?.includes(userId))
    ));
  }
  return checkTourBookingConflict(sessions, targetOrTourTypeId, userId).hasConflict;
}

/**
 * Fetch all tour types and their associated guide schedules for the current
 * and upcoming dates. The public /tour page should surface available tours
 * that are already assigned by admins, not only slots scheduled today.
 */
export async function getTourTypesWithSchedules(): Promise<TourTypeWithSchedules[]> {
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  console.debug('[tourScheduleService] getTourTypesWithSchedules — today=', today);

  // Fetch independent collections together so the page waits for one network
  // round trip instead of two.
  const [tourTypesSnap, guidesSnap] = await Promise.all([
    getDocs(collection(db, 'tourTypes')),
    getDocs(collection(db, 'tourGuides')),
  ]);
  if (tourTypesSnap.empty) return [];

  const tourTypesMap = new Map<
    string,
    { name: string; description?: string; duration?: string; destinationIds: string[] }
  >();
  tourTypesSnap.docs.forEach((doc) => {
    const data = doc.data();
    tourTypesMap.set(doc.id, {
      name: data.name || 'Unnamed',
      description: data.description || '',
      duration: data.duration || '',
      destinationIds: Array.isArray(data.destinations) ? data.destinations : [],
    });
  });

  const result: TourTypeWithSchedules[] = [];

  // 3. For each tour type, find matching guides with an available slot
  for (const [typeId, typeInfo] of tourTypesMap) {
    const guides: TourGuideSchedule[] = [];

    for (const guideDoc of guidesSnap.docs) {
      const guideData = guideDoc.data();
      const tourTypeIds = resolveGuideTourTypeIds(guideData, tourTypesMap);

      if (!tourTypeIds.includes(typeId)) continue;

      const rawSlots: any[] = guideData.availabilitySlots || [];
      const taggedSlots = rawSlots
        .map((s, rawIndex) => ({ ...s, rawIndex }))
        .filter((s) => {
          const maxSpots = Number(s?.maxSpots ?? 10);
          const bookedCount = Number(s?.bookedCount ?? s?.sessionCount ?? 0);
          if (!Number.isFinite(maxSpots) || maxSpots <= 0) return false;
          if (bookedCount >= maxSpots) return false;
          const date = String(s?.date || '');
          if (!date) return false;
          return date >= today;
        });

      if (taggedSlots.length === 0) continue;

      console.debug(`[tourScheduleService] type=${typeId} guide=${guideDoc.id} slots=${taggedSlots.length}`);
      guides.push({
        guideId: guideDoc.id,
        guideName: `${guideData.firstName || ''} ${guideData.lastName || ''}`.trim() || 'Unknown Guide',
        guidePhotoUrl: guideData.photoUrl || guideData.img || '',
        destinationName: guideData.assignedDestName || 'Unknown',
        destinationId: guideData.assignedDestId || '',
        date: taggedSlots[0]?.date || today,
        slots: taggedSlots.map((s) => ({
          startTime: s.startTime,
          endTime: s.endTime,
          maxSpots: s.maxSpots ?? 10,
          bookedCount: s.bookedCount ?? 0,
          joinedUserIds: s.joinedUserIds ?? [],
          date: s.date,
          rawIndex: s.rawIndex,
        })),
      });
    }

    if (guides.length > 0) {
      result.push({
        id: typeId,
        name: typeInfo.name,
        description: typeInfo.description,
        duration: typeInfo.duration,
        places: [], // resolved below, once we know which types actually have guides today
        guides,
      });
    }
  }

  // 4. Resolve "Places You'll Visit" — batch lookup against `destinations`.
  //    Firestore 'in' queries cap at 30 IDs, so we chunk defensively.
  const allDestIds = Array.from(
    new Set(result.flatMap((t) => tourTypesMap.get(t.id)?.destinationIds || []))
  );

  if (allDestIds.length > 0) {
    const placeNameById = new Map<string, string>();
    const destinationSnaps = await Promise.all(
      Array.from({ length: Math.ceil(allDestIds.length / 30) }, (_, index) => {
        const chunk = allDestIds.slice(index * 30, index * 30 + 30);
        return getDocs(query(collection(db, 'destinations'), where(documentId(), 'in', chunk)));
      })
    );
    destinationSnaps.forEach((destsSnap) => {
      destsSnap.docs.forEach((d) => {
        const data = d.data() as any;
        placeNameById.set(d.id, data.title || data.name || 'Untitled');
      });
    });

    result.forEach((t) => {
      const ids = tourTypesMap.get(t.id)?.destinationIds || [];
      t.places = ids
        .map((id) => placeNameById.get(id))
        .filter((n): n is string => !!n);
    });
  }

  return result;
}

/**
 * A slot belonging to "upcoming" (future-dated, beyond today) availability,
 * tagged with which guide it belongs to — a tour type can be offered by
 * several guides, each with their own future schedule.
 */
export interface UpcomingSlotEntry extends TourSlot {
  guideId: string;
  guideName: string;
  guidePhotoUrl?: string;
}

export interface UpcomingSlotGroup {
  date: string; // "YYYY-MM-DD"
  slots: UpcomingSlotEntry[];
}

/**
 * getUpcomingSlotsForTourType
 * Looks across every guide who offers `typeId` and returns all of their
 * FUTURE (date > today) availability slots — the counterpart to
 * getTourTypesWithSchedules(), which is intentionally scoped to today only.
 * Used to power an "Upcoming Tours" section under the Available Slots
 * modal, so tourists can see (and join) sessions scheduled for later days,
 * not just today's.
 *
 * Grouped and sorted by date, then by start time within each date.
 */
export async function getUpcomingSlotsForTourType(typeId: string): Promise<UpcomingSlotGroup[]> {
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  console.debug('[tourScheduleService] getUpcomingSlotsForTourType — today=', today, 'typeId=', typeId);

  const tourTypesSnap = await getDocs(collection(db, 'tourTypes'));
  const typeMap = new Map<string, { destinationIds: string[] }>();
  tourTypesSnap.docs.forEach((typeDoc) => {
    const data = typeDoc.data();
    typeMap.set(typeDoc.id, {
      destinationIds: Array.isArray(data.destinations) ? data.destinations : [],
    });
  });

  const guidesSnap = await getDocs(collection(db, 'tourGuides'));
  const byDate = new Map<string, UpcomingSlotEntry[]>();

  guidesSnap.docs.forEach((guideDoc) => {
    const guideData = guideDoc.data();
    const tourTypeIds = resolveGuideTourTypeIds(guideData, typeMap);
    if (!tourTypeIds.includes(typeId)) return;

    const guideName = `${guideData.firstName || ''} ${guideData.lastName || ''}`.trim() || 'Unknown Guide';
    const guidePhotoUrl = guideData.photoUrl || guideData.img || '';
    const rawSlots: any[] = guideData.availabilitySlots || [];

    rawSlots
      .map((s, rawIndex) => ({ ...s, rawIndex }))
      .filter((s) => isSlotJoinable({ ...s, bookedCount: s.bookedCount ?? s.sessionCount ?? 0 }) && s.date > today)
      .forEach((s) => {
        const entry: UpcomingSlotEntry = {
          startTime: s.startTime,
          endTime: s.endTime,
          maxSpots: s.maxSpots ?? 10,
          bookedCount: s.bookedCount ?? 0,
          joinedUserIds: s.joinedUserIds ?? [],
          date: s.date,
          rawIndex: s.rawIndex,
          guideId: guideDoc.id,
          guideName,
          guidePhotoUrl,
        };
        const bucket = byDate.get(s.date) || [];
        bucket.push(entry);
        byDate.set(s.date, bucket);
      });
  });

  return Array.from(byDate.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, slots]) => ({
      date,
      slots: slots.sort((a, b) => a.startTime.localeCompare(b.startTime)),
    }));
}

/**
 * Legacy: fetch all schedules (used by other parts if needed)
 */
export async function getTourSchedules(options?: { guideId?: string; status?: string }): Promise<TourSchedule[]> {
  const guidesCol = collection(db, 'tourGuides');
  const snapshot = await getDocs(guidesCol);
  const schedules: TourSchedule[] = [];
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  console.debug('[tourScheduleService] getTourSchedules — today=', today, 'options=', options);

  for (const docSnap of snapshot.docs) {
    if (options?.guideId && docSnap.id !== options.guideId) continue;

    const data = docSnap.data();
    const slots = data.availabilitySlots;
    if (!slots || !Array.isArray(slots) || slots.length === 0) continue;

    const futureSlots = slots
      .map((s: any, rawIndex: number) => ({ ...s, rawIndex }))
      .filter((s: any) => s.date >= today);
    if (futureSlots.length === 0) continue;

    const firstSlot = futureSlots[0];
    schedules.push({
      id: docSnap.id,
      guideName: `${data.firstName} ${data.lastName}`,
      guideId: docSnap.id,
      destinationName: data.assignedDestName || 'Unknown',
      destinationId: data.assignedDestId || '',
      date: firstSlot.date,
      slots: futureSlots.map((s: any) => ({
        startTime: s.startTime,
        endTime: s.endTime,
        maxSpots: s.maxSpots ?? 10,
        bookedCount: s.bookedCount ?? 0,
        joinedUserIds: s.joinedUserIds ?? [],
        date: s.date,
        rawIndex: s.rawIndex,
      })),
    });
  }
  return schedules;
}

/**
 * Join a specific slot of a schedule.
 * Uses a Firestore transaction to safely increment bookedCount and add the user.
 *
 * IMPORTANT: `slotIndex` must be the slot's rawIndex (its position in the
 * guide's raw `availabilitySlots` array in Firestore) — not its position in
 * any filtered/sorted list the UI builds. getTourTypesWithSchedules() now
 * returns that rawIndex on every TourSlot for exactly this reason.
 *
 * CHANGED: this used to ONLY write to
 * tourGuides/{guideId}.availabilitySlots[].joinedUserIds — a completely
 * separate record from sessions/{id}.tourists[], which is what the guide's
 * live Tourist List, Start/End session, stop-tracking, and feedback
 * eligibility are all built on (and what gets written when a tourist scans
 * the guide's QR instead of using "Check Availability" here). That split
 * meant a Check-Availability join was invisible everywhere else in the app.
 * Now, after the slot reservation succeeds, we also get-or-create the same
 * TOUR-YYYY-####-#### session this slot's QR would use and add the tourist
 * to it — so both join paths converge on one record.
 */
export async function joinTour(
  userId: string,
  guideId: string,
  slotIndex: number,
  tourTypeId: string,
  tourTypeName: string,
  tourist: { name: string; email: string },
): Promise<void> {
  if (!userId) throw new Error('User not logged in');
  const userProfile = await getUserProfile(userId);
  if (!userProfile?.emailVerified) {
    throw new Error('Please verify your profile before joining a tour.');
  }
  if (!tourist.email?.trim()) {
    throw new Error('Your account requires a valid email before joining a tour. Please verify your profile.');
  }

  const joinedSessionsSnap = await getDocs(
    query(collection(db, 'sessions'), where('touristUids', 'array-contains', userId))
  );
  const joinedSessions = (joinedSessionsSnap?.docs || []).map((sessionDoc) => (
    sessionDoc.data() as {
      status?: string;
      tourTypeId?: string;
      tourTypeName?: string;
      cancelledUids?: string[];
      startTime?: string;
      endTime?: string;
      date?: string;
    }
  ));

  const guideRef = doc(db, 'tourGuides', guideId);

  // Returned out of the transaction so the session-sync step below has
  // everything it needs without a second read.
  const bookedSlot = await runTransaction(db, async (transaction) => {
    const guideSnap = await transaction.get(guideRef);
    if (!guideSnap.exists()) throw new Error('Guide not found');

    const data = guideSnap.data();
    const slots = data.availabilitySlots;
    if (!slots || !Array.isArray(slots) || slotIndex >= slots.length) {
      throw new Error('Invalid slot index');
    }

    const slot = slots[slotIndex];
    if (!slot || typeof slot !== 'object') {
      throw new Error('Invalid slot data');
    }
    const slotDateString = String(slot.date || '');
    const slotStartTime = String(slot.startTime || '');
    const slotEndTime = String(slot.endTime ?? slot.startTime ?? '');
    const slotStartDate = new Date(`${slotDateString}T${slotStartTime}:00`);
    const slotEndDate = new Date(`${slotDateString}T${slotEndTime}:00`);
    if (slotEndDate <= slotStartDate) slotEndDate.setDate(slotEndDate.getDate() + 1);
    if (Number.isNaN(slotStartDate.getTime()) || Number.isNaN(slotEndDate.getTime())) {
      throw new Error('Invalid slot date or time');
    }
    const now = new Date();
    if (slotEndDate <= now) {
      throw new Error('This slot has already ended and can no longer be joined.');
    }

    const conflictCheck = checkTourBookingConflict(joinedSessions, {
      tourTypeId,
      date: slotDateString,
      startTime: slotStartTime,
      endTime: slotEndTime,
    }, userId);
    if (conflictCheck.hasConflict) {
      throw new Error(conflictCheck.message || 'You cannot join this tour due to a scheduling conflict.');
    }

    const maxSpots = Number(slot.maxSpots ?? 10);
    const bookedCount = Number(slot.bookedCount ?? slot.sessionCount ?? 0);
    const sessionCount = Number(slot.sessionCount ?? bookedCount);
    const joinedUserIds = slot.joinedUserIds ?? [];

    if (bookedCount >= maxSpots) {
      throw new Error('This slot is fully booked');
    }
    if (joinedUserIds.includes(userId)) {
      throw new Error('You have already joined this slot');
    }

    // Update the slot
    const updatedSlot = {
      ...slot,
      bookedCount: bookedCount + 1,
      sessionCount: sessionCount + 1,
      joinedUserIds: [...joinedUserIds, userId],
    };
    const newSlots = [...slots];
    newSlots[slotIndex] = updatedSlot;

    transaction.update(guideRef, { availabilitySlots: newSlots });

    return {
      date: slot.date as string,
      startTime: slot.startTime as string,
      endTime: slot.endTime as string,
      destinationId: data.assignedDestId || '',
      destinationName: data.assignedDestName || 'Unknown',
      guideName: `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown Guide',
    };
  });

  // ── Mirror this join into the same `sessions` doc the QR-scan flow uses ──
  // getOrCreateSessionForSlot() looks up the existing session by
  // (guideId + startTime) before creating one, so this is safe to call
  // whether or not the guide has already generated a QR for this slot.
  try {
    const session = await getOrCreateSessionForSlot({
      destinationId: bookedSlot.destinationId,
      destinationName: bookedSlot.destinationName,
      tourTypeId,
      tourTypeName,
      guideId,
      guideName: bookedSlot.guideName,
      date: bookedSlot.date,
      startTime: bookedSlot.startTime,
      endTime: bookedSlot.endTime,
      initialTourist: {
        uid: userId,
        name: tourist.name || 'Tourist',
        email: tourist.email || '',
        joinedAt: new Date().toISOString(),
      },
    });

    await addTouristToSession(session.id, {
      uid: userId,
      name: tourist.name || 'Tourist',
      email: tourist.email || '',
      joinedAt: new Date().toISOString(),
    });
    await createNotification({
      userId,
      type: 'reserved',
      title: 'Tour Joined',
      message: `You have joined the tour "${session.destinationName}" with guide ${bookedSlot.guideName}.`,
    });
  } catch (err) {
    // Do not report a successful join when the shared session record was not
    // written. The slot reservation is still retained for manual recovery;
    // Firestore rules should allow this service to write both records.
    console.error('[tourScheduleService] joinTour: failed to sync session record for guide/slot', guideId, slotIndex, err);
    throw err;
  }
}
