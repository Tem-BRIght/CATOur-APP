import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildJoinedSessionFallbacks } from './sessionService';
import { checkTourBookingConflict, hasTourTypeConflict } from './tourScheduleService';
import { getLatestTodaySlots } from '../pages/Settings/Tour/Tour';

const { updateDocMock, getDocMock, getDocsMock, addDocMock, setDocMock, runTransactionMock } = vi.hoisted(() => ({
  updateDocMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocsMock: vi.fn().mockResolvedValue({ docs: [] }),
  addDocMock: vi.fn(),
  setDocMock: vi.fn(),
  runTransactionMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db: unknown, path: string) => ({ db, path })),
  doc: vi.fn((db: unknown, path: string, id?: string) => ({ db, path, id })),
  getFirestore: vi.fn(() => ({ type: 'fake-db' })),
  getDoc: getDocMock,
  setDoc: setDocMock,
  updateDoc: updateDocMock,
  addDoc: addDocMock,
  arrayUnion: vi.fn((value: unknown) => ({ __arrayUnion: value })),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-ts'),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: getDocsMock,
  runTransaction: runTransactionMock,
  Timestamp: class Timestamp {},
}));

vi.mock('../firebase', () => ({
  firestore: { type: 'fake-firestore' },
}));

vi.mock('./notificationsService', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./userProfileService', () => ({
  getUserProfile: vi.fn(),
}));

import { getUserProfile } from './userProfileService';

describe('tour booking conflict validation', () => {
  it('blocks same tour type on the same date (1 tour type per day rule)', () => {
    const existing = [
      {
        status: 'pending',
        tourTypeId: 'food-tour',
        tourTypeName: 'Food Tour',
        date: '2026-08-28',
        startTime: '2026-08-28T09:00:00.000Z',
        endTime: '2026-08-28T11:00:00.000Z',
      },
    ];

    const result = checkTourBookingConflict(existing, {
      tourTypeId: 'food-tour',
      date: '2026-08-28',
      startTime: '14:00',
      endTime: '16:00',
    });

    expect(result.hasConflict).toBe(true);
    expect(result.type).toBe('same_tour_type_same_day');
  });

  it('allows same tour type on a different date', () => {
    const existing = [
      {
        status: 'pending',
        tourTypeId: 'food-tour',
        tourTypeName: 'Food Tour',
        date: '2026-08-28',
        startTime: '2026-08-28T09:00:00.000Z',
        endTime: '2026-08-28T11:00:00.000Z',
      },
    ];

    const result = checkTourBookingConflict(existing, {
      tourTypeId: 'food-tour',
      date: '2026-08-29',
      startTime: '09:00',
      endTime: '11:00',
    });

    expect(result.hasConflict).toBe(false);
  });

  it('blocks different tour type if date and time overlap', () => {
    const existing = [
      {
        status: 'pending',
        tourTypeId: 'city-tour',
        tourTypeName: 'City Walking Tour',
        date: '2026-08-28',
        startTime: new Date('2026-08-28T09:00:00').toISOString(),
        endTime: new Date('2026-08-28T11:00:00').toISOString(),
      },
    ];

    // Attempting to join Food Tour from 10:00 to 12:00 on the same date (overlaps 10:00-11:00)
    const result = checkTourBookingConflict(existing, {
      tourTypeId: 'food-tour',
      date: '2026-08-28',
      startTime: '10:00',
      endTime: '12:00',
    });

    expect(result.hasConflict).toBe(true);
    expect(result.type).toBe('time_overlap');
  });

  it('allows different tour type on the same date if times do not overlap', () => {
    const existing = [
      {
        status: 'pending',
        tourTypeId: 'city-tour',
        tourTypeName: 'City Walking Tour',
        date: '2026-08-28',
        startTime: new Date('2026-08-28T09:00:00').toISOString(),
        endTime: new Date('2026-08-28T11:00:00').toISOString(),
      },
    ];

    // Attempting to join Food Tour in afternoon 14:00 to 16:00 (no overlap)
    const result = checkTourBookingConflict(existing, {
      tourTypeId: 'food-tour',
      date: '2026-08-28',
      startTime: '14:00',
      endTime: '16:00',
    });

    expect(result.hasConflict).toBe(false);
  });

  it('ignores cancelled sessions when checking conflicts', () => {
    const existing = [
      {
        status: 'Cancelled',
        tourTypeId: 'city-tour',
        tourTypeName: 'City Walking Tour',
        date: '2026-08-28',
        startTime: '2026-08-28T09:00:00.000Z',
        endTime: '2026-08-28T11:00:00.000Z',
      },
    ];

    const result = checkTourBookingConflict(existing, {
      tourTypeId: 'city-tour',
      date: '2026-08-28',
      startTime: '09:00',
      endTime: '11:00',
    });

    expect(result.hasConflict).toBe(false);
  });

  it('blocks joinTour when the tourist has a same-day scheduling conflict', async () => {
    vi.mocked(getUserProfile).mockResolvedValue({ emailVerified: true } as any);
    getDocsMock.mockResolvedValueOnce({
      docs: [{
        data: () => ({
          status: 'pending',
          tourTypeId: 'food',
          tourTypeName: 'Food Tour',
          date: '2026-08-28',
          startTime: '2026-08-28T09:00:00.000Z',
          endTime: '2026-08-28T11:00:00.000Z',
        }),
      }],
    });

    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({
          availabilitySlots: [{
            date: '2026-08-28',
            startTime: '23:00',
            endTime: '23:59',
            maxSpots: 10,
            bookedCount: 0,
            joinedUserIds: [],
          }],
        }),
      }),
      update: vi.fn(),
    };
    runTransactionMock.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction));

    const { joinTour } = await import('./tourScheduleService');

    await expect(joinTour('tourist-1', 'guide-1', 0, 'food', 'Food Tour', {
      name: 'Tourist One',
      email: 'one@example.com',
    })).rejects.toThrow(/tour type per day|scheduling conflict/);
    expect(transaction.update).not.toHaveBeenCalled();
  });

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T12:00:00'));

    try {
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
    } finally {
      vi.useRealTimers();
    }
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

  it('treats missing or insufficient permissions as a safe profile fallback', async () => {
    vi.mocked(getUserProfile).mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));

    const { getSession } = await import('./sessionService');
    const session = {
      id: 'session-1',
      guideId: 'guide-1',
      guideName: 'Guide One',
      destinationId: 'dest-1',
      destinationName: 'Old Town',
      startTime: '2026-06-01T08:00:00.000Z',
      tourists: [{ uid: 'tourist-1', name: 'Tourist One', email: 'one@example.com', joinedAt: '2026-08-23T09:00:00.000Z' }],
      touristUids: ['tourist-1'],
      status: 'pending',
      createdAt: '2026-06-01T00:00:00.000Z',
    } as any;

    getDocMock.mockResolvedValueOnce({ exists: () => true, data: () => session });

    const result = await getSession('session-1');

    expect(result).not.toBeNull();
    expect(result?.tourists[0]).toMatchObject({ uid: 'tourist-1', name: 'Tourist One', email: 'one@example.com' });
  });

  it('rejects check-in when the tourist is not registered', async () => {
    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ status: 'pending', touristUids: ['registered-user'] }),
      }),
      update: vi.fn(),
    };
    runTransactionMock.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => Promise<void>) => callback(transaction));

    const { checkInTouristToSession } = await import('./sessionService');

    await expect(checkInTouristToSession('session-1', 'unregistered-user'))
      .rejects.toThrow('not registered');
    expect(transaction.update).not.toHaveBeenCalled();
  });

  it('marks a registered tourist checked-in in the shared roster', async () => {
    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({
          status: 'active',
          touristUids: ['registered-user'],
          checkedInUids: [],
          tourists: [{ uid: 'registered-user', name: 'Registered Tourist', status: 'Joined' }],
        }),
      }),
      update: vi.fn(),
    };
    runTransactionMock.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => Promise<void>) => callback(transaction));

    const { checkInTouristToSession } = await import('./sessionService');
    await checkInTouristToSession('session-1', 'registered-user');

    expect(transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        checkedInUids: ['registered-user'],
        tourists: [expect.objectContaining({ uid: 'registered-user', status: 'Checked-In' })],
      }),
    );
  });

  it('does not check in a retained cancelled roster entry', async () => {
    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({
          status: 'active',
          touristUids: ['registered-user'],
          cancelledUids: [],
          checkedInUids: [],
          tourists: [
            { uid: 'registered-user', name: 'Old Registration', status: 'Cancelled' },
            { uid: 'registered-user', name: 'Fresh Registration', status: 'Joined' },
          ],
        }),
      }),
      update: vi.fn(),
    };
    runTransactionMock.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => Promise<void>) => callback(transaction));

    const { checkInTouristToSession } = await import('./sessionService');
    await checkInTouristToSession('session-1', 'registered-user');

    expect(transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tourists: [
          expect.objectContaining({ uid: 'registered-user', name: 'Old Registration', status: 'Cancelled' }),
          expect.objectContaining({ uid: 'registered-user', name: 'Fresh Registration', status: 'Checked-In' }),
        ],
      }),
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

    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        id: 'tour-1',
        data: () => ({
        status: 'active',
        completedStops: [],
        destinationName: 'Old Town Walk',
        guideName: 'Guide One',
        checkedInUids: ['tourist-1'],
        tourists: [
          { uid: 'tourist-1', name: 'Tourist One', email: 'one@example.com', joinedAt: '2026-08-23T09:00:00.000Z' },
        ],
        }),
      }),
      update: vi.fn(),
    };
    runTransactionMock.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => Promise<void>) => callback(transaction));
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ title: 'Pasig Museum' }),
    });

    await markStopVisited('tour-1', 'dest-42');

    expect(transaction.update).toHaveBeenCalledWith(expect.anything(), {
      completedStops: { __arrayUnion: 'dest-42' },
    });
    expect(updateDocMock).toHaveBeenCalledWith(expect.anything(), {
      visitedStops: {
        __arrayUnion: expect.objectContaining({
          destinationId: 'dest-42',
          destinationName: 'Pasig Museum',
          touristUids: ['tourist-1'],
          tourists: [expect.objectContaining({ uid: 'tourist-1' })],
        }),
      },
    });

    expect(setDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tour-1__dest-42__tourist-1' }),
      expect.objectContaining({
        sessionId: 'tour-1',
        userId: 'tourist-1',
        destinationId: 'dest-42',
      }),
      { merge: true },
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

  it('preserves a cancelled tourist and decrements only the matching slot', async () => {
    const transaction = {
      get: vi.fn()
        .mockResolvedValueOnce({
          exists: () => true,
          data: () => ({
            status: 'pending',
            guideId: 'guide-1',
            startTime: new Date('2026-06-01T08:00:00').toISOString(),
            touristUids: ['tourist-1', 'tourist-2'],
            checkedInUids: [],
            tourists: [
              { uid: 'tourist-1', name: 'One', status: 'Joined' },
              { uid: 'tourist-2', name: 'Two', status: 'Joined' },
            ],
          }),
        })
        .mockResolvedValueOnce({
          exists: () => true,
          data: () => ({
            availabilitySlots: [{
              date: '2026-06-01', startTime: '08:00', endTime: '09:00',
              bookedCount: 2, sessionCount: 2, joinedUserIds: ['tourist-1', 'tourist-2'],
            }],
          }),
        }),
      update: vi.fn(),
    };
    runTransactionMock.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => Promise<void>) => callback(transaction));

    const { cancelJoinedSession } = await import('./sessionService');
    await cancelJoinedSession('session-1', 'tourist-1', 'Plans changed');

    expect(transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        touristUids: ['tourist-1', 'tourist-2'],
        cancelledUids: { __arrayUnion: 'tourist-1' },
        tourists: [
          expect.objectContaining({ uid: 'tourist-1', status: 'Cancelled', cancelReason: 'Plans changed' }),
          expect.objectContaining({ uid: 'tourist-2', status: 'Joined' }),
        ],
      })
    );
    expect(transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ availabilitySlots: [expect.objectContaining({ bookedCount: 1, sessionCount: 1 })] })
    );
  });

  it('does not create a second analytics visit for an already visited stop', async () => {
    const { markStopVisited } = await import('./sessionService');
    const transaction = {
      get: vi.fn().mockResolvedValue({
      exists: () => true,
      data: () => ({ status: 'active', completedStops: ['dest-42'], tourists: [], checkedInUids: [] }),
      }),
      update: vi.fn(),
    };
    runTransactionMock.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => Promise<void>) => callback(transaction));

    await markStopVisited('tour-1', 'dest-42');

    expect(updateDocMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('rejects destination progress before the guide starts the session', async () => {
    const { markStopVisited } = await import('./sessionService');
    const transaction = {
      get: vi.fn().mockResolvedValue({
      exists: () => true,
      data: () => ({ status: 'pending', completedStops: [], tourists: [], checkedInUids: [] }),
      }),
      update: vi.fn(),
    };
    runTransactionMock.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => Promise<void>) => callback(transaction));

    await expect(markStopVisited('tour-1', 'dest-42')).rejects.toThrow('not active');
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
