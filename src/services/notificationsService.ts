// src/services/notificationsService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Manages per-user notifications stored in Firestore.
//
// Collection path:  notifications/{uid}/items/{notifId}
// ─────────────────────────────────────────────────────────────────────────────

import {
  collection, doc,
  addDoc, updateDoc, getDocs, writeBatch,
  query, orderBy, limit, onSnapshot,
  serverTimestamp, Timestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { firestore } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

// NEW — callable client for the sendPushNotification Cloud Function.
interface SendPushRequest {
  recipientUid: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}
interface SendPushResponse {
  sent: number;
}
const callSendPush = httpsCallable<SendPushRequest, SendPushResponse>(functions, 'sendPushNotification');

async function sendPushNotification(request: SendPushRequest): Promise<void> {
  try {
    await callSendPush(request);
  } catch (err) {
    // A push delivery problem must not prevent the notification from being
    // available in the app's Notifications screen.
    console.warn('[notificationsService] push notification failed (non-fatal):', err);
  }
}

// ── Write helpers ────────────────────────────────────────────────────────

export async function notifyReviewReply(params: {
  recipientUid:    string;
  replierName:     string;
  destinationId:   string;
  destinationName: string;
  reviewId:        string;
  replyId:         string;
  replySnippet?:   string;
}): Promise<void> {
  const { recipientUid, replierName, destinationId, destinationName, reviewId, replyId, replySnippet } = params;
  const title = `${replierName} replied to your review`;
  const message = replySnippet
    ? `"${replySnippet}"`
    : `${replierName} replied to your review at ${destinationName}.`;

  try {
    await addDoc(itemsCol(recipientUid), {
      type:           'reply' as NotifType,
      title,
      message,
      unread:         true,
      createdAt:      serverTimestamp(),
      destinationId,
      reviewId,
      replyId,
    });
  } catch (err) {
    console.error('[notificationsService] notifyReviewReply failed:', err);
    return; // don't bother pushing if we couldn't even write the in-app notification
  }

  // NEW — fire the actual push notification. Best-effort: a push failure
  // (no tokens, function error, etc.) never blocks or rolls back the
  // in-app notification written above.
  await sendPushNotification({
    recipientUid,
    title,
    body: message,
    data: { type: 'reply', destinationId, reviewId, replyId },
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifType =
  | 'like'
  | 'rating'
  | 'location'
  | 'info'
  | 'system'
  | 'visit'
  | 'reply'
  | 'destination';
  | 'new_message';

export interface AppNotification {
  id:        string;
  type:      NotifType;
  title:     string;
  message:   string;
  unread:    boolean;
  createdAt: string;
  destinationId?: string;
  reviewId?:      string;
  replyId?:       string;
  ticketId?:     string;
}

// ── Firestore refs ────────────────────────────────────────────────────────────

const itemsCol = (uid: string) =>
  collection(firestore, 'notifications', uid, 'items');

const itemDoc = (uid: string, notifId: string) =>
  doc(firestore, 'notifications', uid, 'items', notifId);

// ── Timestamp helper ──────────────────────────────────────────────────────────

function toISO(ts: unknown): string {
  if (!ts) return new Date().toISOString();
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (ts instanceof Date)      return ts.toISOString();
  if (typeof ts === 'string')  return ts;
  return new Date().toISOString();
}

// ── Real-time listener ────────────────────────────────────────────────────────

export function subscribeNotifications(
  uid:      string,
  onChange: (notifs: AppNotification[]) => void,
): Unsubscribe {
  const q = query(itemsCol(uid), orderBy('createdAt', 'desc'), limit(60));

  return onSnapshot(
    q,
    (snap) => {
      const items: AppNotification[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id:             d.id,
          type:           (data.type as NotifType) ?? 'info',
          title:          data.title   ?? '',
          message:        data.message ?? '',
          unread:         data.unread  ?? true,
          createdAt:      toISO(data.createdAt),
          destinationId:  data.destinationId ?? undefined,
          reviewId:       data.reviewId      ?? undefined,
          replyId:        data.replyId       ?? undefined,
          ticketId:       data.ticketId     ?? undefined,
        };
      });
      onChange(items);
    },
    (err) => console.error('[notificationsService] subscribeNotifications error:', err),
  );
}

// ── Mark read ─────────────────────────────────────────────────────────────────

export async function markNotifRead(uid: string, notifId: string): Promise<void> {
  try {
    await updateDoc(itemDoc(uid, notifId), { unread: false });
  } catch (err) {
    console.error('[notificationsService] markNotifRead failed:', err);
  }
}

export async function markAllNotifsRead(uid: string): Promise<void> {
  try {
    const snap = await getDocs(query(itemsCol(uid)));
    const batch = writeBatch(firestore);
    snap.docs.forEach((d) => {
      if (d.data().unread) {
        batch.update(d.ref, { unread: false });
      }
    });
    await batch.commit();
  } catch (err) {
    console.error('[notificationsService] markAllNotifsRead failed:', err);
  }
}

export async function notifyVisitRecorded(
  recipientUid: string,
  destinationName: string,
  destinationId: string,
): Promise<void> {
  const title = 'Visit recorded';
  const message = `Your visit to ${destinationName} has been recorded.`;

  try {
    await addDoc(itemsCol(recipientUid), {
      type:           'visit' as NotifType,
      title,
      message,
      unread:         true,
      createdAt:      serverTimestamp(),
      destinationId,
    });
  } catch (err) {
    console.error('[notificationsService] notifyVisitRecorded failed:', err);
    return;
  }

  await sendPushNotification({
    recipientUid,
    title,
    body: message,
    data: { type: 'visit', destinationId },
  });
}

export async function notifyNewDestination(params: {
  recipientUids:   string[];
  destinationId:   string;
  destinationName: string;
  description?:    string;
}): Promise<void> {
  const { recipientUids, destinationId, destinationName, description } = params;
  const message = description
    ? description
    : `${destinationName} is now available to explore!`;

  const BATCH_SIZE = 500;
  for (let i = 0; i < recipientUids.length; i += BATCH_SIZE) {
    const chunk = recipientUids.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(firestore);

    chunk.forEach((uid) => {
      const ref = doc(itemsCol(uid));
      batch.set(ref, {
        type:          'destination' as NotifType,
        title:         '📍 New destination added!',
        message,
        unread:        true,
        createdAt:     serverTimestamp(),
        destinationId,
      });
    });

    try {
      await batch.commit();
    } catch (err) {
      console.error('[notificationsService] notifyNewDestination batch failed:', err);
    }
  }
}

// ── 🆕 SINGLE createNotification helper (used by tourScheduleService) ──────

export async function createNotification({
  userId,
  type,
  title,
  message,
  link = '',
}: {
  userId: string;
  type: NotifType;
  title: string;
  message: string;
  link?: string;
}): Promise<void> {
  try {
    await addDoc(itemsCol(userId), {
      type,
      title,
      message,
      link,
      unread: true,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[notificationsService] createNotification failed:', err);
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (mins  <  1)  return 'just now';
  if (mins  < 60)  return `${mins} min ago`;
  if (hours < 24)  return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  if (days  === 1) return 'Yesterday';
  if (days  <  7)  return `${days} days ago`;

  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
