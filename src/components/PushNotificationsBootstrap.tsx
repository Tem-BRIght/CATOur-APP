// src/components/PushNotificationsBootstrap.tsx
// ─────────────────────────────────────────────────────────────────────────
// Mounted once inside <AuthProvider> (see App.tsx). Renders nothing — it
// just requests Notification permission after login, registers the FCM
// token, and shows a lightweight notification for foreground pushes
// (background pushes are handled by public/firebase-messaging-sw.js).
//
// Web-only for now: on native (Capacitor) builds, `Notification` /
// `serviceWorker` aren't meaningfully present, so this silently no-ops —
// native push would use @capacitor/push-notifications instead, wired up
// separately.
// ─────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { getToken, onMessage } from 'firebase/messaging';
import { useAuth } from '../context/AuthContext';
import { messagingPromise } from '../firebase';
import { saveFcmToken } from '../services/pushNotificationsService';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

const PushNotificationsBootstrap: React.FC = () => {
  const { user } = useAuth();
  const registeredForUidRef = useRef<string | null>(null);

  // ── Register + save token once per login ──────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    if (registeredForUidRef.current === user.uid) return;

    // Android/iOS must use Capacitor's native FCM registration. Previously
    // this was only attempted after opening the Notifications page, so most
    // users never had a token for the server to deliver a push to.
    if (Capacitor.isNativePlatform()) {
      let registrationListener: { remove: () => Promise<void> } | undefined;
      let cancelled = false;

      const registerNativePush = async () => {
        try {
          registrationListener = await PushNotifications.addListener('registration', async ({ value }) => {
            if (cancelled) return;
            await saveFcmToken(user.uid, value, Capacitor.getPlatform());
            registeredForUidRef.current = user.uid;
          });

          const permission = await PushNotifications.requestPermissions();
          if (permission.receive === 'granted') {
            await PushNotifications.register();
          }
        } catch (err) {
          console.warn('[Push] Failed to register native push notifications:', err);
        }
      };

      void registerNativePush();
      return () => {
        cancelled = true;
        void registrationListener?.remove();
      };
    }

    if (!VAPID_KEY) {
      console.warn('[Push] VITE_FIREBASE_VAPID_KEY is not set — push notifications disabled.');
      return;
    }
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

    let cancelled = false;

    (async () => {
      try {
        const messaging = await messagingPromise;
        if (!messaging || cancelled) return;

        if (Notification.permission === 'denied') return;

        const permission = Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission();
        if (permission !== 'granted' || cancelled) return;

        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration,
        });

        if (token && !cancelled) {
          await saveFcmToken(user.uid, token);
          registeredForUidRef.current = user.uid;
        }
      } catch (err) {
        console.warn('[Push] Failed to register for push notifications:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.uid]);

  // ── Foreground messages ────────────────────────────────────────────────
  // The service worker only fires for background/closed-tab pushes — while
  // the tab is open and focused, FCM delivers here instead, so we show our
  // own notification.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;

    let unsubscribe: (() => void) | undefined;
    (async () => {
      const messaging = await messagingPromise;
      if (!messaging) return;
      unsubscribe = onMessage(messaging, (payload) => {
        const title = payload.notification?.title || 'CATOUR';
        const body = payload.notification?.body || '';
        if (Notification.permission === 'granted') {
          new Notification(title, { body, icon: '/assets/icon/catour.png' });
        }
      });
    })();
    return () => { unsubscribe?.(); };
  }, []);

  return null;
};

export default PushNotificationsBootstrap;
