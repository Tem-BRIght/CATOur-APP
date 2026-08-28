import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(),
  Timestamp: class Timestamp {},
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => vi.fn()) }));
vi.mock('../firebase', () => ({ firestore: {}, functions: {} }));

import { getNotificationTarget } from './notificationsService';

describe('notification deep links', () => {
  it('opens the checked-in session map', () => {
    expect(getNotificationTarget({ type: 'checked_in', sessionId: 'session-1' }, 'user'))
      .toEqual({ path: '/tour-session/session-1', params: { autoOpenMap: 'true' } });
  });

  it('falls back to tour history when a session reference is missing', () => {
    expect(getNotificationTarget({ type: 'session_ended' }, 'user')).toEqual({ path: '/tour' });
  });

  it('opens the guide roster for a roster update', () => {
    expect(getNotificationTarget({ type: 'roster_update', sessionId: 'session-1' }, 'tourguide'))
      .toEqual({ path: '/tourguide/list/session-1' });
  });
});