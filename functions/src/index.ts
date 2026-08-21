/**
 * Cloud Functions entrypoint for the CATOUR app.
 *
 * This file defines the callable `groqChat` proxy and the push notification
 * helpers used by the app. It is the actual deploy target for `firebase deploy`
 * under the `functions` source directory.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const GROQ_API_KEY = defineSecret('GROQ_API_KEY');
const GROQ_API_ENDPOINT = process.env.GROQ_API_ENDPOINT?.trim() || 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_ENDPOINT_SOURCE = process.env.GROQ_API_ENDPOINT ? 'env' : 'default';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODELS: string[] = [];
const MAX_TOKENS_CAP = 600;
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);

export function getGroqModelCandidates(requestedModel?: string): string[] {
  const preferred = requestedModel?.trim();
  const seen = new Set<string>();
  const candidates: string[] = [];

  if (preferred) {
    seen.add(preferred);
    candidates.push(preferred);
  }

  for (const model of [DEFAULT_MODEL, ...FALLBACK_MODELS]) {
    if (model && !seen.has(model)) {
      seen.add(model);
      candidates.push(model);
    }
  }

  return candidates;
}

if (getApps().length === 0) {
  initializeApp();
}

const firestore = getFirestore();
const messaging = getMessaging();

interface SendPushRequest {
  recipientUid: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface SendPushResponse {
  sent: number;
}

export const sendPushNotification = onCall<SendPushRequest, Promise<SendPushResponse>>(
  { region: 'us-central1', cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to send notifications.');
    }

    const { recipientUid, title, body, data } = request.data || {};
    if (!recipientUid || typeof recipientUid !== 'string') {
      throw new HttpsError('invalid-argument', 'recipientUid is required.');
    }
    if (!title?.trim() || !body?.trim()) {
      throw new HttpsError('invalid-argument', 'title and body are required.');
    }

    const tokensRef = firestore
      .collection('users').doc(recipientUid).collection('fcmTokens');
    const tokensSnap = await tokensRef.get();

    if (tokensSnap.empty) {
      logger.info('[sendPushNotification] no registered tokens', { recipientUid });
      return { sent: 0 };
    }

    const tokens = tokensSnap.docs.map((d) => d.id);

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: title.trim(), body: body.trim() },
      data: data || {},
      webpush: {
        notification: { icon: '/assets/icon/catour.png' },
        fcmOptions: { link: '/notifications' },
      },
    });

    const staleTokens: string[] = [];
    response.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-argument'
        ) {
          staleTokens.push(tokens[i]);
        }
      }
    });

    if (staleTokens.length) {
      const batch = firestore.batch();
      staleTokens.forEach((t) => batch.delete(tokensRef.doc(t)));
      await batch.commit();
      logger.info('[sendPushNotification] pruned stale tokens', { count: staleTokens.length });
    }

    return { sent: response.successCount };
  }
);

interface ChatMessageInput {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqChatRequest {
  messages: ChatMessageInput[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

interface GroqChatResponse {
  reply: string;
}

export const groqChat = onCall<GroqChatRequest, Promise<GroqChatResponse>>(
  {
    secrets: [GROQ_API_KEY],
    region: 'us-central1',
    cors: true,
    timeoutSeconds: 30,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to use ALI.');
    }

    const data = request.data;
    if (!data || !Array.isArray(data.messages) || data.messages.length === 0) {
      throw new HttpsError('invalid-argument', 'A non-empty "messages" array is required.');
    }
    if (data.messages.length > 20) {
      throw new HttpsError('invalid-argument', 'Too many messages in one request.');
    }
    for (const m of data.messages) {
      if (!m || !ALLOWED_ROLES.has(m.role) || typeof m.content !== 'string') {
        throw new HttpsError('invalid-argument', 'Each message needs a valid role and string content.');
      }
      if (m.content.length > 6000) {
        throw new HttpsError('invalid-argument', 'A message is too long.');
      }
    }

    const apiKey = GROQ_API_KEY.value();
    if (!apiKey || !apiKey.trim()) {
      throw new HttpsError('failed-precondition', 'Groq API key is not configured on this Firebase Function.');
    }

    const modelCandidates = getGroqModelCandidates(data.model);
    let lastError: unknown = null;

    for (const model of modelCandidates) {
      const body = {
        model,
        messages: data.messages,
        temperature: typeof data.temperature === 'number'
          ? Math.min(Math.max(data.temperature, 0), 2)
          : 0.7,
        max_tokens: Math.min(data.max_tokens || 300, MAX_TOKENS_CAP),
        top_p: typeof data.top_p === 'number' ? data.top_p : 0.9,
        stream: false,
      };

      logger.info('[groqChat] request', {
        uid: request.auth.uid,
        model,
        max_tokens: body.max_tokens,
        top_p: body.top_p,
        endpoint: GROQ_API_ENDPOINT,
        endpointSource: GROQ_API_ENDPOINT_SOURCE,
      });

      try {
        const response = await fetch(GROQ_API_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          const isModelIssue = response.status === 400 || response.status === 404 || /model|unsupported|not found/i.test(errText);
          logger.warn('[groqChat] Groq API non-OK response', {
            status: response.status,
            model,
            errText: errText.slice(0, 500),
            uid: request.auth.uid,
          });

          if (response.status === 401 || response.status === 403) {
            throw new HttpsError(
              'failed-precondition',
              'Groq API rejected the configured API key. Update the GROQ_API_KEY secret and redeploy functions.',
            );
          }

          if (isModelIssue && model !== modelCandidates[modelCandidates.length - 1]) {
            lastError = new Error(`Groq model ${model} rejected the request (${response.status}).`);
            continue;
          }

          throw new HttpsError('internal', `AI service returned an error (${response.status}).`);
        }

        const json = await response.json();
        const reply: string | undefined = json.choices?.[0]?.message?.content;
        if (!reply || !reply.trim()) {
          throw new HttpsError('internal', 'AI service returned an empty response.');
        }

        return { reply };
      } catch (err) {
        lastError = err;
        if (err instanceof HttpsError) {
          if (err.code === 'internal' && model !== modelCandidates[modelCandidates.length - 1]) {
            const message = String(err.message || '');
            if (/model|unsupported|not found|empty response/i.test(message)) continue;
          }
          throw err;
        }
        logger.error('[groqChat] request failed', { model, err, uid: request.auth.uid });
        if (model === modelCandidates[modelCandidates.length - 1]) {
          throw new HttpsError('internal', 'Failed to reach the AI service.');
        }
      }
    }

    if (lastError instanceof Error) {
      logger.error('[groqChat] all Groq models failed', { uid: request.auth.uid, lastError: lastError.message });
    }
    throw new HttpsError('internal', 'Failed to reach the AI service.');
  }
);

export const onNewChatMessage = onDocumentCreated(
  { document: 'chats/{chatId}/messages/{messageId}', region: 'us-central1' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const message = snap.data();
    const chatId = event.params.chatId as string;
    const senderId: string | undefined = message.senderId;
    const senderName: string = message.senderName || 'Someone';
    const text: string = message.text || '';
    if (!senderId || !text.trim()) return;

    const chatSnap = await firestore.collection('chats').doc(chatId).get();
    if (!chatSnap.exists) {
      logger.warn('[onNewChatMessage] parent chat doc missing', { chatId });
      return;
    }

    const chat = chatSnap.data() || {};
    const participants: string[] = Array.isArray(chat.participants) ? chat.participants : [];
    const recipientId = participants.find((uid) => uid !== senderId);
    if (!recipientId) {
      logger.warn('[onNewChatMessage] no recipient found for chat', { chatId, participants });
      return;
    }

    const snippet = text.length > 80 ? `${text.slice(0, 77)}...` : text;
    await firestore
      .collection('notifications').doc(recipientId).collection('items')
      .add({
        type: 'reply',
        title: `New message from ${senderName}`,
        message: snippet,
        unread: true,
        createdAt: FieldValue.serverTimestamp(),
        chatId,
      })
      .catch((err) => logger.warn('[onNewChatMessage] in-app notification write failed:', err));

    const tokensRef = firestore.collection('users').doc(recipientId).collection('fcmTokens');
    const tokensSnap = await tokensRef.get();
    if (tokensSnap.empty) {
      logger.info('[onNewChatMessage] recipient has no registered tokens', { recipientId });
      return;
    }

    const tokens = tokensSnap.docs.map((d) => d.id);
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: `New message from ${senderName}`, body: snippet },
      data: { type: 'chat', chatId },
      webpush: {
        notification: { icon: '/assets/icon/catour.png' },
        fcmOptions: { link: '/notifications' },
      },
    });

    const staleTokens: string[] = [];
    response.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-argument'
        ) {
          staleTokens.push(tokens[i]);
        }
      }
    });

    if (staleTokens.length) {
      const batch = firestore.batch();
      staleTokens.forEach((t) => batch.delete(tokensRef.doc(t)));
      await batch.commit();
      logger.info('[onNewChatMessage] pruned stale tokens', { count: staleTokens.length });
    }
  }
);

export const setEmailVerified = onCall<{ targetUid: string; verified: boolean }, Promise<{ success: boolean }>>(
  { region: 'us-central1', cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const callerUid = request.auth.uid;
    // Only allow super-admins to toggle the Auth emailVerified flag.
    // Check the `admins` collection (primary path). Fall back to an email
    // lookup if the UID-based doc is missing (mirrors AuthService behavior).
    try {
      let role = '';
      const adminDocRef = firestore.collection('admins').doc(callerUid);
      const adminSnap = await adminDocRef.get();
      if (adminSnap.exists) {
        role = (adminSnap.data() as any)?.role || '';
      } else {
        const callerEmail = (request.auth.token && (request.auth.token as any).email) || '';
        if (callerEmail) {
          const q = await firestore.collection('admins').where('email', '==', callerEmail).limit(1).get();
          if (!q.empty) {
            role = (q.docs[0].data() as any)?.role || '';
            // Optionally auto-migrate the doc to UID path is omitted here.
          }
        }
      }

      if (role !== 'super-admin') {
        throw new HttpsError('permission-denied', 'Only super-admins may change email verification status.');
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', 'Failed to verify caller permissions.');
    }

    const data = request.data as any || {};
    const targetUid = data.targetUid;
    const verified = !!data.verified;

    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUid is required.');
    }

    try {
      await getAuth().updateUser(targetUid, { emailVerified: verified });
      // Mirror the change in Firestore profile for consistency
      await firestore.collection('users').doc(targetUid).update({ isEmailVerified: verified });
      return { success: true };
    } catch (err: any) {
      logger.error('[setEmailVerified] update failed', { err, targetUid, verified });
      if (err.code === 'auth/user-not-found' || err.message?.includes('user-not-found')) {
        throw new HttpsError('not-found', 'Target user not found.');
      }
      throw new HttpsError('internal', 'Failed to update email verification status.');
    }
  }
);

export const checkEmailRegistered = onCall<{ email: string }, Promise<{ registered: boolean }>>(
  { region: 'us-central1', cors: true },
  async (request) => {
    const email = request.data?.email?.trim().toLowerCase();
    if (!email) {
      throw new HttpsError('invalid-argument', 'A valid email is required.');
    }

    try {
      await getAuth().getUserByEmail(email);
      return { registered: true };
    } catch (err: any) {
      const errorCode = String(err?.code || '').replace(/^auth\//, '');
      if (errorCode === 'user-not-found') {
        return { registered: false };
      }
      logger.error('[checkEmailRegistered] lookup failed', { err });
      throw new HttpsError('internal', 'Unable to check the email address.');
    }
  }
);

export const getUserAuth = onCall<{ targetUid: string }, Promise<{ emailVerified: boolean }>>(
  { region: 'us-central1', cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const callerUid = request.auth.uid;
    // Allow admins and super-admins to read Auth user status.
    try {
      let role = '';
      const adminDocRef = firestore.collection('admins').doc(callerUid);
      const adminSnap = await adminDocRef.get();
      if (adminSnap.exists) {
        role = (adminSnap.data() as any)?.role || '';
      } else {
        const callerEmail = (request.auth.token && (request.auth.token as any).email) || '';
        if (callerEmail) {
          const q = await firestore.collection('admins').where('email', '==', callerEmail).limit(1).get();
          if (!q.empty) {
            role = (q.docs[0].data() as any)?.role || '';
          }
        }
      }

      if (role !== 'super-admin' && role !== 'admin') {
        throw new HttpsError('permission-denied', 'Only admins may read user Auth status.');
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError('internal', 'Failed to verify caller permissions.');
    }

    const data = request.data as any || {};
    const targetUid = data.targetUid;
    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'targetUid is required.');
    }

    try {
      const userRecord = await getAuth().getUser(targetUid);
      return { emailVerified: !!userRecord.emailVerified };
    } catch (err: any) {
      logger.error('[getUserAuth] failed', { err, targetUid });
      if (err.code === 'auth/user-not-found' || err.message?.includes('user-not-found')) {
        throw new HttpsError('not-found', 'Target user not found.');
      }
      throw new HttpsError('internal', 'Failed to fetch user Auth status.');
    }
  }
);
