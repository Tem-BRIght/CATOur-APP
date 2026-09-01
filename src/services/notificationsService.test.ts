import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockAddDoc: vi.fn(),
  mockQuery: vi.fn((...args) => args),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  addDoc: mocks.mockAddDoc,
  updateDoc: vi.fn(),
  getDocs: mocks.mockGetDocs,
  writeBatch: vi.fn(),
  query: mocks.mockQuery,
  orderBy: vi.fn(),
  limit: vi.fn((value) => value),
  where: vi.fn((field, op, value) => ({ field, op, value })),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(),
  Timestamp: class Timestamp {},
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => vi.fn()) }));
vi.mock('../firebase', () => ({ firestore: {}, functions: {} }));

import { createNotification, getNotificationTarget } from './notificationsService';

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

describe('session-scoped notification dedupe', () => {
  it('skips a repeated notification when the same session and type already exists for that user', async () => {
    mocks.mockGetDocs.mockResolvedValueOnce({ empty: false });
    mocks.mockAddDoc.mockClear();

    await createNotification({
      userId: 'user-1',
      type: 'checked_in',
      title: 'Attendance confirmed',
      message: 'Your attendance is confirmed.',
      sessionId: 'session-1',
    });

    expect(mocks.mockAddDoc).not.toHaveBeenCalled();
  });
});