import { z } from 'zod';

const ratingField = z.coerce
  .number()
  .int('التقييم يجب أن يكون رقمًا صحيحًا')
  .min(1, 'التقييم يجب أن يكون بين 1 و 5')
  .max(5, 'التقييم يجب أن يكون بين 1 و 5');

const optionalRatingField = z
  .union([z.literal(''), ratingField])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value));

export const reviewSchema = z.object({
  booking_id: z.string().uuid('معرّف الحجز غير صالح'),
  overall_rating: ratingField,
  aircraft_rating: optionalRatingField,
  crew_rating: optionalRatingField,
  service_rating: optionalRatingField,
  comment: z
    .string()
    .max(1000, 'التعليق طويل جدًا')
    .optional()
    .transform((value) => value?.trim() ?? ''),
});

export type ReviewInput = z.infer<typeof reviewSchema>;
