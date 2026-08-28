// src/services/pushNotificationsService.ts
// ─────────────────────────────────────────────────────────────────────────
// Manages per-user FCM token documents at users/{uid}/fcmTokens/{token}.
// Keyed by the token itself (not a random doc ID) so re-registering the
// same device is an idempotent overwrite, not a growing pile of dupes.
// ─────────────────────────────────────────────────────────────────────────

import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { firestore } from '../firebase';

const FCM_TOKEN_STORAGE_KEY = 'catour:fcmToken';

export async function saveFcmToken(
  uid: string,
  token: string,
  platform = 'web',
): Promise<void> {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // Ignore localStorage failures in restricted environments.
  }

  await setDoc(
    doc(firestore, 'users', uid, 'fcmTokens', token),
    {
      token,
      platform,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function removeFcmToken(uid: string, token: string): Promise<void> {
  try {
    await deleteDoc(doc(firestore, 'users', uid, 'fcmTokens', token));
  } catch (err) {
    console.warn('[pushNotificationsService] removeFcmToken failed:', err);
  }
}

export function getStoredFcmToken(): string | null {
  try {
    return typeof window !== 'undefined'
      ? window.localStorage.getItem(FCM_TOKEN_STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

export function clearStoredFcmToken(): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(FCM_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}