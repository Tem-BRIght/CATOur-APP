// src/services/feedbackService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Manages tourist → tour guide feedback stored in Firestore.
//
// Collection path:  feedback/{sessionId_touristId}
//
// One doc per (session, tourist) pair — using a deterministic doc ID means a
// tourist can only submit feedback once per session (re-submitting just
// overwrites their own doc, it never creates a duplicate).
//
// Schema written here matches what Reviews.tsx already queries:
//   collection(firestore, 'feedback')
//     .where('guideId', '==', guideId)
//     .orderBy('createdAt', 'desc')
//   → reads: rating, comment, createdAt
// ─────────────────────────────────────────────────────────────────────────────

import {
  collection, doc, setDoc, getDoc, serverTimestamp,
} from 'firebase/firestore';
import { firestore } from '../firebase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GuideFeedbackInput {
  sessionId: string;
  guideId: string;
  guideName: string;
  destinationId?: string;
  destinationName?: string;
  touristId: string;
  touristName?: string;
  rating: number;              // 1-5
  categoryRatings?: {
    knowledge?: number;
    friendliness?: number;
    punctuality?: number;
    communication?: number;
  };
  comment?: string;
}

export interface GuideFeedback extends GuideFeedbackInput {
  id: string;
  destinationId: string;
  destinationName: string;
  touristName: string;
  categoryRatings: NonNullable<GuideFeedbackInput['categoryRatings']>;
  comment: string;
  createdAt?: unknown;
}

// ── Firestore refs ────────────────────────────────────────────────────────────

const feedbackCol = () => collection(firestore, 'feedback');

/** Deterministic doc ID → one submission per tourist per session. */
const feedbackDocId = (sessionId: string, touristId: string) =>
  `${sessionId}_${touristId}`;

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * hasSubmittedFeedback
 * Checks whether this tourist has already left feedback for this session.
 * Used to show a "you already reviewed this tour" state instead of the form.
 */
export async function hasSubmittedFeedback(
  sessionId: string,
  touristId: string,
): Promise<boolean> {
  try {
    const snap = await getDoc(doc(feedbackCol(), feedbackDocId(sessionId, touristId)));
    return snap.exists();
  } catch (err) {
    console.error('[feedbackService] hasSubmittedFeedback failed:', err);
    return false;
  }
}

/**
 * getFeedback
 * Fetches the tourist's own feedback doc for this session (e.g. to pre-fill
 * the form if they navigate back to it before it's disabled).
 */
export async function getFeedback(
  sessionId: string,
  touristId: string,
): Promise<GuideFeedback | null> {
  try {
    const snap = await getDoc(doc(feedbackCol(), feedbackDocId(sessionId, touristId)));
    return snap.exists()
      ? { id: snap.id, ...(snap.data() as Omit<GuideFeedback, 'id'>) }
      : null;
  } catch (err) {
    console.error('[feedbackService] getFeedback failed:', err);
    return null;
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * submitGuideFeedback
 * Creates/overwrites the tourist's feedback doc for this session.
 */
export async function submitGuideFeedback(input: GuideFeedbackInput): Promise<void> {
  if (input.rating < 1 || input.rating > 5) {
    throw new Error('Rating must be between 1 and 5.');
  }

  const sessionSnap = await getDoc(doc(firestore, 'sessions', input.sessionId));
  if (!sessionSnap.exists()) throw new Error('Tour session not found.');
  const session = sessionSnap.data() as { status?: string; checkedInUids?: string[] };
  if (session.status !== 'ended' || !session.checkedInUids?.includes(input.touristId)) {
    throw new Error('Only checked-in tourists can submit feedback for an ended tour.');
  }

  const ref = doc(feedbackCol(), feedbackDocId(input.sessionId, input.touristId));

  await setDoc(ref, {
    sessionId: input.sessionId,
    guideId: input.guideId,
    guideName: input.guideName,
    destinationId: input.destinationId || '',
    destinationName: input.destinationName || '',
    touristId: input.touristId,
    touristName: input.touristName || 'Anonymous',
    rating: input.rating,
    categoryRatings: input.categoryRatings || {},
    comment: input.comment?.trim() || '',
    createdAt: serverTimestamp(),
  });
}
