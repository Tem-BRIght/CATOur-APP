import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildJoinedSessionFallbacks } from './sessionService';
import { getLatestTodaySlots } from '../pages/Settings/Tour/Tour';

const { updateDocMock, getDocMock, addDocMock } = vi.hoisted(() => ({
  updateDocMock: vi.fn(),
  getDocMock: vi.fn(),
  addDocMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db: unknown, path: string) => ({ db, path })),
  doc: vi.fn((db: unknown, path: string, id?: string) => ({ db, path, id })),
  getFirestore: vi.fn(() => ({ type: 'fake-db' })),
  getDoc: getDocMock,
  setDoc: vi.fn(),
  updateDoc: updateDocMock,
  addDoc: addDocMock,
  arrayUnion: vi.fn((value: unknown) => ({ __arrayUnion: value })),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-ts'),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  runTransaction: vi.fn(),
  Timestamp: class Timestamp {},
}));

vi.mock('../firebase', () => ({
  firestore: { type: 'fake-firestore' },
}));

vi.mock('./notificationsService', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

describe('joined session fallback', () => {
  it('includes guide slot joins even when the session document is missing', () => {
    const existingSessions = [
      {
        id: 'session-existing',
        guideId: 'guide-1',
        guideName: 'Guide One',
        destinationId: 'dest-1',
        destinationName: 'Old Town',
        startTime: '2026-06-01T08:00:00.000Z',
        tourists: [],
        touristUids: ['other-user'],
        status: 'pending',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ] as any[];

    const fallback = buildJoinedSessionFallbacks('current-user', existingSessions, [
      {
        guideId: 'guide-2',
        guideName: 'Guide Two',
        destinationId: 'dest-2',
        destinationName: 'Beach Run',
        tourTypeId: 'tour-type-2',
        tourTypeName: 'Beach Tour',
        startTime: '2026-06-02T09:00:00.000Z',
        endTime: '2026-06-02T10:00:00.000Z',
        date: '2026-06-02',
        joinedUserIds: ['current-user'],
      },
    ]);

    expect(fallback).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destinationName: 'Beach Run',
          guideName: 'Guide Two',
          tourTypeName: 'Beach Tour',
          touristUids: ['current-user'],
        }),
      ])
    );
  });

  it('keeps only the latest today slot for a tour type', () => {
    const type = {
      id: 'tour-type-1',
      name: 'City Tour',
      places: [],
      guides: [
        {
          guideId: 'guide-1',
          guideName: 'Guide One',
          destinationName: 'Old Town',
          destinationId: 'dest-1',
          date: '2026-06-02',
          slots: [
            { startTime: '08:00', endTime: '09:00', maxSpots: 10, bookedCount: 2, joinedUserIds: [], date: '2026-06-02', rawIndex: 0 },
            { startTime: '11:30', endTime: '12:30', maxSpots: 10, bookedCount: 1, joinedUserIds: [], date: '2026-06-02', rawIndex: 1 },
          ],
        },
        {
          guideId: 'guide-2',
          guideName: 'Guide Two',
          destinationName: 'Beach Road',
          destinationId: 'dest-2',
          date: '2026-06-02',
          slots: [
            { startTime: '10:00', endTime: '11:00', maxSpots: 8, bookedCount: 3, joinedUserIds: [], date: '2026-06-02', rawIndex: 0 },
          ],
        },
      ],
    } as any;

    const latest = getLatestTodaySlots(type);

    expect(latest).toHaveLength(1);
    expect(latest[0].guideName).toBe('Guide One');
    expect(latest[0].startTime).toBe('11:30');
  });

  it('keeps cancelled sessions visible so tourists can see the cancellation reason', () => {
    const existingSessions = [
      {
        id: 'session-cancelled',
        guideId: 'guide-1',
        guideName: 'Guide One',
        destinationId: 'dest-1',
        destinationName: 'Old Town',
        startTime: '2026-06-01T08:00:00.000Z',
        tourists: [],
        touristUids: ['current-user'],
        status: 'Cancelled',
        cancelReason: 'Guide was unavailable',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ] as any[];

    const fallback = buildJoinedSessionFallbacks('current-user', existingSessions, []);

    expect(fallback).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'session-cancelled',
          status: 'Cancelled',
          cancelReason: 'Guide was unavailable',
        }),
      ])
    );
  });
});

describe('session lifecycle logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        id: 'tour-1',
        destinationName: 'Old Town Walk',
        tourists: [],
        guideId: 'guide-1',
        guideName: 'Guide One',
      }),
    });
  });

  it('writes a real startTime and a started activity event when a tour begins', async () => {
    const { updateSessionStatus } = await import('./sessionService');

    await updateSessionStatus('tour-1', 'active');

    expect(updateDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'active',
        startTime: expect.any(String),
      })
    );

    expect(addDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'activityLog' }),
      expect.objectContaining({
        type: 'started',
        title: expect.stringContaining('Tour Started'),
        sessionId: 'tour-1',
      })
    );
  });

  it('logs a destination check-in when a stop is marked visited', async () => {
    const { markStopVisited } = await import('./sessionService');

    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        completedStops: [],
        destinationName: 'Old Town Walk',
        guideName: 'Guide One',
        tourists: [
          { uid: 'tourist-1', name: 'Tourist One', email: 'one@example.com', joinedAt: '2026-08-23T09:00:00.000Z' },
        ],
      }),
    }).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ title: 'Pasig Museum' }),
    });

    await markStopVisited('tour-1', 'dest-42');

    expect(updateDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        completedStops: { __arrayUnion: 'dest-42' },
        visitedStops: {
          __arrayUnion: expect.objectContaining({
            destinationId: 'dest-42',
            destinationName: 'Pasig Museum',
            touristUids: ['tourist-1'],
            tourists: [expect.objectContaining({ uid: 'tourist-1' })],
          }),
        },
      })
    );

    expect(addDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'activityLog' }),
      expect.objectContaining({
        type: 'checkin',
        title: expect.stringContaining('Destination visited: Pasig Museum'),
        sessionId: 'tour-1',
        extra: expect.objectContaining({
          touristUids: ['tourist-1'],
          touristCount: 1,
        }),
      })
    );
  });

  it('stores the cancellation reason when a tour is cancelled', async () => {
    const { updateSessionStatus } = await import('./sessionService');

    await updateSessionStatus('tour-1', 'Cancelled', 'Guide was unavailable');

    expect(updateDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'Cancelled',
        cancelReason: 'Guide was unavailable',
        cancelledAt: expect.any(String),
      })
    );
  });
});
