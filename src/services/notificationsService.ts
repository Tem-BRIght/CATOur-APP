import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, writeBatch,
  query, orderBy, limit, onSnapshot, serverTimestamp, Timestamp, Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { firestore, functions } from '../firebase';

interface SendPushRequest { recipientUid: string; title: string; body: string; data?: Record<string, string> }
interface SendPushResponse { sent: number }
const callSendPush = httpsCallable<SendPushRequest, SendPushResponse>(functions, 'sendPushNotification');

async function sendPushNotification(request: SendPushRequest): Promise<void> {
  try { await callSendPush(request); }
  catch (error) { console.warn('[notificationsService] push notification failed:', error); }
}

export type NotifType =
  | 'like' | 'rating' | 'location' | 'info' | 'system' | 'visit' | 'reply'
  | 'destination' | 'reserved' | 'new_message' | 'join_confirmed' | 'join_blocked'
  | 'cancel_confirmed' | 'session_reminder' | 'checked_in' | 'scan_failed'
  | 'session_started' | 'destination_visited' | 'session_ended' | 'feedback_reminder'
  | 'message_replied' | 'roster_update' | 'session_assigned' | 'guide_conflict'
  | 'slot_status_change' | 'analytics_update';

export interface AppNotification {
  id: string;
  type: NotifType;
  title: string;
  message: string;
  unread: boolean;
  createdAt: string;
  destinationId?: string;
  reviewId?: string;
  replyId?: string;
  ticketId?: string;
  sessionId?: string;
  registrationId?: string;
  messageId?: string;
  guideId?: string;
}

export type NotificationRole = 'user' | 'tourguide' | 'admin';
export interface NotificationTarget { path: string; params?: Record<string, string> }

export function getNotificationTarget(
  notification: Pick<AppNotification, 'type' | 'sessionId' | 'ticketId' | 'messageId'>,
  role: NotificationRole,
): NotificationTarget {
  const id = notification.sessionId;
  const sessionPath = id ? `/tour-session/${encodeURIComponent(id)}` : '/tour';
  switch (notification.type) {
    case 'join_confirmed': case 'join_blocked': case 'cancel_confirmed': case 'session_reminder':
      return { path: '/tour', params: id ? { sessionId: id } : undefined };
    case 'checked_in': return { path: sessionPath, params: id ? { autoOpenMap: 'true' } : undefined };
    case 'session_started': case 'destination_visited': return { path: sessionPath };
    case 'session_ended': case 'feedback_reminder':
      return { path: id ? `/feedback/${encodeURIComponent(id)}` : '/tour' };
    case 'roster_update': return { path: id ? `/tourguide/list/${encodeURIComponent(id)}` : '/tourguide/home' };
    case 'session_assigned':
      return { path: role === 'tourguide' && id ? `/tourguide/list/${encodeURIComponent(id)}` : '/tourguide/home' };
    case 'guide_conflict': return { path: '/admin/guide-assignment' };
    case 'slot_status_change': return { path: id ? `/admin/tour-roster/${encodeURIComponent(id)}` : '/admin/tour-schedules' };
    case 'analytics_update': return { path: '/admin/analytics' };
    case 'message_replied': case 'new_message':
      return { path: notification.ticketId ? `/support-chat/${encodeURIComponent(notification.ticketId)}` : '/notifications',
        params: notification.messageId ? { messageId: notification.messageId } : undefined };
    default: return { path: role === 'tourguide' ? '/tourguide/home' : '/home' };
  }
}

const itemsCol = (uid: string) => collection(firestore, 'notifications', uid, 'items');
const itemDoc = (uid: string, id: string) => doc(firestore, 'notifications', uid, 'items', id);
function toISO(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

export function subscribeNotifications(uid: string, onChange: (items: AppNotification[]) => void): Unsubscribe {
  return onSnapshot(query(itemsCol(uid), orderBy('createdAt', 'desc'), limit(60)), (snapshot) => {
    onChange(snapshot.docs.map((item) => {
      const data = item.data();
      return { id: item.id, type: (data.type as NotifType) || 'info', title: data.title || '', message: data.message || '',
        unread: data.unread !== false, createdAt: toISO(data.createdAt), destinationId: data.destinationId,
        reviewId: data.reviewId, replyId: data.replyId, ticketId: data.ticketId, sessionId: data.sessionId,
        registrationId: data.registrationId, messageId: data.messageId, guideId: data.guideId };
    }));
  }, (error) => console.error('[notificationsService] subscribe failed:', error));
}

export async function markNotifRead(uid: string, notifId: string): Promise<void> {
  try { await updateDoc(itemDoc(uid, notifId), { unread: false }); }
  catch (error) { console.error('[notificationsService] mark read failed:', error); }
}

export async function markAllNotifsRead(uid: string): Promise<void> {
  try {
    const snapshot = await getDocs(query(itemsCol(uid)));
    const batch = writeBatch(firestore);
    snapshot.docs.filter((item) => item.data().unread).forEach((item) => batch.update(item.ref, { unread: false }));
    await batch.commit();
  } catch (error) { console.error('[notificationsService] mark all read failed:', error); }
}

export async function deleteNotification(uid: string, notifId: string): Promise<void> {
  await deleteDoc(itemDoc(uid, notifId));
}

export async function deleteAllNotifications(uid: string): Promise<void> {
  const snapshot = await getDocs(query(itemsCol(uid)));
  const batch = writeBatch(firestore);
  snapshot.docs.forEach((item) => batch.delete(item.ref));
  await batch.commit();
}

export async function notifyReviewReply(params: { recipientUid: string; replierName: string; destinationId: string; destinationName: string; reviewId: string; replyId: string; replySnippet?: string }): Promise<void> {
  const message = params.replySnippet ? `"${params.replySnippet}"` : `${params.replierName} replied to your review at ${params.destinationName}.`;
  const title = `${params.replierName} replied to your review`;
  try {
    await addDoc(itemsCol(params.recipientUid), { type: 'reply', title, message, unread: true, createdAt: serverTimestamp(), destinationId: params.destinationId, reviewId: params.reviewId, replyId: params.replyId });
    await sendPushNotification({ recipientUid: params.recipientUid, title, body: message, data: { type: 'reply', destinationId: params.destinationId, reviewId: params.reviewId, replyId: params.replyId } });
  } catch (error) { console.error('[notificationsService] review reply failed:', error); }
}

export async function notifyVisitRecorded(recipientUid: string, destinationName: string, destinationId: string): Promise<void> {
  const title = 'Visit recorded'; const message = `Your visit to ${destinationName} has been recorded.`;
  try {
    await addDoc(itemsCol(recipientUid), { type: 'visit', title, message, unread: true, createdAt: serverTimestamp(), destinationId });
    await sendPushNotification({ recipientUid, title, body: message, data: { type: 'visit', destinationId } });
  } catch (error) { console.error('[notificationsService] visit notification failed:', error); }
}

export async function notifyNewDestination(params: { recipientUids: string[]; destinationId: string; destinationName: string; description?: string }): Promise<void> {
  const message = params.description || `${params.destinationName} is now available to explore!`;
  for (let offset = 0; offset < params.recipientUids.length; offset += 500) {
    const batch = writeBatch(firestore);
    params.recipientUids.slice(offset, offset + 500).forEach((uid) => batch.set(doc(itemsCol(uid)), {
      type: 'destination', title: 'New destination added', message, unread: true, createdAt: serverTimestamp(), destinationId: params.destinationId,
    }));
    try { await batch.commit(); } catch (error) { console.error('[notificationsService] destination notification failed:', error); }
  }
}

export async function createNotification(params: { userId: string; type: NotifType; title: string; message: string; link?: string; sessionId?: string; registrationId?: string; messageId?: string; guideId?: string }): Promise<void> {
  try {
    await addDoc(itemsCol(params.userId), { type: params.type, title: params.title, message: params.message, link: params.link || '', unread: true, createdAt: serverTimestamp(),
      ...(params.sessionId ? { sessionId: params.sessionId } : {}), ...(params.registrationId ? { registrationId: params.registrationId } : {}),
      ...(params.messageId ? { messageId: params.messageId } : {}), ...(params.guideId ? { guideId: params.guideId } : {}) });
  } catch (error) { console.error('[notificationsService] create failed:', error); }
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000); const hours = Math.floor(diff / 3600000); const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now'; if (mins < 60) return `${mins} min ago`; if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  if (days === 1) return 'Yesterday'; if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
