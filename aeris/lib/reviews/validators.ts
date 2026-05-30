import { z } from 'zod';

import { clientsAr } from '@/lib/i18n/clients-ar';

const ratingField = z.coerce
  .number()
  .int(clientsAr.reviewValidationRatingInt)
  .min(1, clientsAr.reviewValidationRatingRange)
  .max(5, clientsAr.reviewValidationRatingRange);

const optionalRatingField = z
  .union([z.literal(''), ratingField])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value));

export const reviewSchema = z.object({
  booking_id: z.string().uuid(clientsAr.reviewValidationBookingId),
  overall_rating: ratingField,
  aircraft_rating: optionalRatingField,
  crew_rating: optionalRatingField,
  service_rating: optionalRatingField,
  comment: z
    .string()
    .max(1000, clientsAr.reviewValidationCommentLong)
    .optional()
    .transform((value) => value?.trim() ?? ''),
});

export type ReviewInput = z.infer<typeof reviewSchema>;
