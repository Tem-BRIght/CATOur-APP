export interface ReviewPayloadInput {
  userId: string;
  destinationId: string;
  destinationName: string;
  destinationImage?: string;
  authorName: string;
  authorAvatar?: string;
  overallRating: number;
  detailedRatings: Record<string, number>;
  feeling: string;
  review: string;
  visitDate: string;
  companion: string;
  duration: string;
  anonymous: boolean;
  allowVenueReply: boolean;
  photos: string[];
  createdAt?: Date;
  updatedAt?: Date;
  isEdit?: boolean;
}

export interface ReviewPointerPayloadInput {
  destinationId: string;
  destinationName: string;
  destinationImage?: string;
  reviewText?: string;
  overallRating?: number;
  anonymous?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  isEdit?: boolean;
}

export const buildReviewDocumentData = (input: ReviewPayloadInput) => ({
  userId: input.userId,
  destinationId: input.destinationId,
  destinationName: input.destinationName,
  destinationImage: input.destinationImage || '',
  authorName: input.authorName,
  authorAvatar: input.authorAvatar || '',
  overallRating: input.overallRating,
  detailedRatings: input.detailedRatings || {},
  feeling: input.feeling || '',
  review: input.review,
  text: input.review,
  visitDate: input.visitDate || '',
  companion: input.companion || '',
  duration: input.duration || '',
  anonymous: input.anonymous || false,
  allowVenueReply: input.allowVenueReply ?? true,
  photos: input.photos || [],
  photoBase64s: input.photos || [],
  createdAt: input.createdAt || new Date(),
  updatedAt: input.updatedAt || new Date(),
});

export const buildReviewPointerData = (input: ReviewPointerPayloadInput) => ({
  destId: input.destinationId,
  destName: input.destinationName,
  destImage: input.destinationImage || '',
  reviewText: input.reviewText || '',
  overallRating: input.overallRating ?? 0,
  anonymous: input.anonymous || false,
  createdAt: input.createdAt || new Date(),
  updatedAt: input.updatedAt || new Date(),
});
