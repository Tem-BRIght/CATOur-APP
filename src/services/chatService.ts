// src/services/chatService.ts
// ─────────────────────────────────────────────────────────────────────────
// 1-on-1 chat between a tour guide and a tourist, scoped to a specific
// session — mirrors feedbackService.ts's deterministic-ID pattern so a
// guide/tourist pair always lands in the same thread for that tour.
//
// Firestore shape:
//   chats/{chatId}
//     participants: [guideId, touristId]
//     guideId, guideName, touristId, touristName, sessionId
//     lastMessage, lastMessageSenderId, lastMessageAt, createdAt
//   chats/{chatId}/messages/{messageId}
//     senderId, senderName, text, createdAt, read
//
// chatId = `${sessionId}_${touristId}` — deterministic, so re-opening the
// chat from either side (guide's Tourist List, tourist's Tour Session)
// always resolves to the same thread.
//
// Push notifications are NOT sent from here — see functions/src/index.ts's
// `onNewChatMessage` Firestore trigger, which fires automatically whenever
// a doc is added to chats/{chatId}/messages.
// ─────────────────────────────────────────────────────────────────────────

import {
  collection, doc, setDoc, addDoc, getDoc, onSnapshot,
  query, orderBy, limit, serverTimestamp, Unsubscribe,
} from 'firebase/firestore';
import { firestore } from '../firebase';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string; // ISO, resolved from Firestore Timestamp
  read: boolean;
}

export interface ChatThread {
  id: string;
  sessionId: string;
  guideId: string;
  guideName: string;
  touristId: string;
  touristName: string;
  lastMessage: string;
  lastMessageSenderId: string;
  lastMessageAt: string;
}

const chatDoc = (chatId: string) => doc(firestore, 'chats', chatId);
const messagesCol = (chatId: string) => collection(firestore, 'chats', chatId, 'messages');

/** Deterministic chat ID — one thread per (session, tourist) pair. */
export const buildChatId = (sessionId: string, touristId: string) =>
  `${sessionId}_${touristId}`;

/**
 * getOrCreateChat
 * Ensures the parent chat doc exists (creates it on first message) and
 * returns the chatId. Safe to call every time the modal opens — setDoc
 * with merge won't clobber an existing thread's history.
 */
export async function getOrCreateChat(params: {
  sessionId: string;
  guideId: string;
  guideName: string;
  touristId: string;
  touristName: string;
}): Promise<string> {
  const { sessionId, guideId, guideName, touristId, touristName } = params;
  const chatId = buildChatId(sessionId, touristId);

  await setDoc(chatDoc(chatId), {
    sessionId,
    guideId,
    guideName,
    touristId,
    touristName,
    participants: [guideId, touristId],
    createdAt: serverTimestamp(),
  }, { merge: true });

  return chatId;
}

/**
 * sendMessage
 * Writes the message doc and updates the parent chat's "last message"
 * preview fields in one go. The push notification itself is handled
 * server-side by the onNewChatMessage trigger — this function only writes
 * to Firestore.
 */
export async function sendMessage(params: {
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
}): Promise<void> {
  const { chatId, senderId, senderName, text } = params;
  const trimmed = text.trim();
  if (!trimmed) return;

  await addDoc(messagesCol(chatId), {
    senderId,
    senderName,
    text: trimmed,
    createdAt: serverTimestamp(),
    read: false,
  });

  await setDoc(chatDoc(chatId), {
    lastMessage: trimmed,
    lastMessageSenderId: senderId,
    lastMessageAt: serverTimestamp(),
  }, { merge: true });
}

/**
 * subscribeMessages
 * Real-time listener for a chat thread's messages, oldest-first, capped at
 * the most recent 100 so a long-running tour's chat doesn't balloon the
 * initial payload.
 */
export function subscribeMessages(
  chatId: string,
  onChange: (messages: ChatMessage[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(messagesCol(chatId), orderBy('createdAt', 'asc'), limit(100)),
    (snap) => {
      const messages: ChatMessage[] = snap.docs.map((d) => {
        const data = d.data();
        const ts = data.createdAt;
        return {
          id: d.id,
          senderId: data.senderId || '',
          senderName: data.senderName || '',
          text: data.text || '',
          createdAt: ts?.toDate ? ts.toDate().toISOString() : new Date().toISOString(),
          read: !!data.read,
        };
      });
      onChange(messages);
    },
    (err) => console.error('[chatService] subscribeMessages error:', err),
  );
}

export async function getChatThread(chatId: string): Promise<ChatThread | null> {
  try {
    const snap = await getDoc(chatDoc(chatId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      id: snap.id,
      sessionId: data.sessionId || '',
      guideId: data.guideId || '',
      guideName: data.guideName || '',
      touristId: data.touristId || '',
      touristName: data.touristName || '',
      lastMessage: data.lastMessage || '',
      lastMessageSenderId: data.lastMessageSenderId || '',
      lastMessageAt: data.lastMessageAt?.toDate?.()?.toISOString() || '',
    };
  } catch (err) {
    console.error('[chatService] getChatThread failed:', err);
    return null;
  }
}
