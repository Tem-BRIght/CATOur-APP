// src/firebase.ts

import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFunctions, Functions } from 'firebase/functions';
import { getMessaging, isSupported, Messaging } from 'firebase/messaging';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export function getAuthActionCodeSettings(path = '/login') {
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:5173';

  return {
    url: `${origin}${path}`,
    handleCodeInApp: true,
  };
}

export const auth:      Auth            = getAuth(app);
export const firestore: Firestore       = getFirestore(app);
export const storage:   FirebaseStorage = getStorage(app);

export const functions: Functions = getFunctions(app, 'us-central1');

export const messagingPromise: Promise<Messaging | null> = (async () => {
  try {
    const supported = await isSupported();
    return supported ? getMessaging(app) : null;
  } catch {
    return null;
  }
})();

export default app;