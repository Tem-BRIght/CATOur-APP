import { describe, expect, it } from 'vitest';
import { buildReviewDocumentData, buildReviewPointerData } from './reviewService';

describe('review Firestore payload helpers', () => {
  it('builds a canonical review document payload', () => {
    const payload = buildReviewDocumentData({
      userId: 'user-1',
      destinationId: 'dest-1',
      destinationName: 'Bohol Beach Club',
      destinationImage: 'https://example.com/image.jpg',
      authorName: 'Jane Doe',
      authorAvatar: 'https://example.com/avatar.jpg',
      overallRating: 5,
      detailedRatings: { cleanliness: 5 },
      feeling: 'happy',
      review: 'Loved it!',
      visitDate: '2026-07-01',
      companion: 'Friends',
      duration: '2-3 hours',
      anonymous: false,
      allowVenueReply: true,
      photos: ['photo-1'],
      createdAt: new Date('2026-07-07T00:00:00.000Z'),
      updatedAt: new Date('2026-07-07T00:10:00.000Z'),
      isEdit: false,
    });

    expect(payload).toMatchObject({
      userId: 'user-1',
      destinationId: 'dest-1',
      destinationName: 'Bohol Beach Club',
      destinationImage: 'https://example.com/image.jpg',
      authorName: 'Jane Doe',
      authorAvatar: 'https://example.com/avatar.jpg',
      overallRating: 5,
      detailedRatings: { cleanliness: 5 },
      review: 'Loved it!',
      text: 'Loved it!',
      photos: ['photo-1'],
      photoBase64s: ['photo-1'],
      anonymous: false,
      allowVenueReply: true,
    });
    expect(payload.createdAt).toBeInstanceOf(Date);
    expect(payload.updatedAt).toBeInstanceOf(Date);
  });

  it('builds a pointer payload for the user reviews index', () => {
    const payload = buildReviewPointerData({
      destinationId: 'dest-1',
      destinationName: 'Bohol Beach Club',
      destinationImage: 'https://example.com/image.jpg',
      reviewText: 'Loved it!',
      overallRating: 5,
      anonymous: false,
      createdAt: new Date('2026-07-07T00:00:00.000Z'),
      updatedAt: new Date('2026-07-07T00:10:00.000Z'),
      isEdit: false,
    });

    expect(payload).toMatchObject({
      destId: 'dest-1',
      destName: 'Bohol Beach Club',
      destImage: 'https://example.com/image.jpg',
      reviewText: 'Loved it!',
      overallRating: 5,
      anonymous: false,
    });
    expect(payload.createdAt).toBeInstanceOf(Date);
    expect(payload.updatedAt).toBeInstanceOf(Date);
  });
});
