// public/firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Same values as src/firebase.ts's firebaseConfig — copy them here.
firebase.initializeApp({
  apiKey: 'AIzaSyDS9QJtZBmMBbBZb6Sowxvc-PYEtlHe3LU',
  authDomain: 'seeways-be14b.firebaseapp.com',
  projectId: 'seeways-be14b',
  storageBucket: 'seeways-be14b.firebasestorage.app',
  messagingSenderId: '53598789861',
  appId: '1:53598789861:web:bcae5bc7423a56de49b40c',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(title || 'CATOUR', {
    body: body || '',
    icon: '/assets/icon/catour.png',
    data: { link: data.link || '/notifications' },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/notifications';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    const target = new URL(link, self.location.origin).href;
    const existing = windowClients.find(client => client.url === target);
    if (existing && 'focus' in existing) return existing.focus();
    return clients.openWindow(target);
  }));
});
