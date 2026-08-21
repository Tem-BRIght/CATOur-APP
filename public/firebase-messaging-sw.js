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
  self.registration.showNotification(title || 'CATOUR', {
    body: body || '',
    icon: '/assets/icon/catour.png',
  });
});
