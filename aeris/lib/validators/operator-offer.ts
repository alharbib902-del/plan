import { z } from 'zod';
import { AIRCRAFT_CATEGORIES } from './promote-lead';

const E164 = /^\+[1-9]\d{6,14}$/;

const optionalNonEmpty = (max: number, key: string) =>
  z
    .string()
    .trim()
    .max(max, key)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const operatorOfferSchema = z
  .object({
    operator_name: z
      .string()
      .trim()
      .min(2, 'operator_name_required')
      .max(120, 'operator_name_too_long'),
    operator_phone: z
      .string()
      .trim()
      .regex(E164, 'operator_phone_invalid'),
    operator_email: z
      .string()
      .trim()
      .max(120, 'operator_email_too_long')
      .transform((v) => (v.length === 0 ? null : v))
      .nullable()
      .optional()
      .refine(
        (v) =>
          v === null ||
          v === undefined ||
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        { message: 'operator_email_invalid' }
      ),

    aircraft_category: z
      .enum(AIRCRAFT_CATEGORIES, {
        invalid_type_error: 'aircraft_category_invalid',
      })
      .optional(),
    aircraft_type: optionalNonEmpty(80, 'aircraft_type_too_long'),
    aircraft_registration: optionalNonEmpty(20, 'aircraft_registration_too_long'),

    total_price_sar: z.coerce
      .number({
        required_error: 'total_price_required',
        invalid_type_error: 'total_price_invalid',
      })
      .min(1000, 'total_price_too_low')
      .max(99_999_999, 'total_price_too_high'),

    departure_eta: z
      .string()
      .min(1, 'departure_eta_required')
      .refine((v) => !Number.isNaN(Date.parse(v)), {
        message: 'departure_eta_invalid',
      }),

    validity_hours: z.coerce
      .number({
        invalid_type_error: 'validity_hours_invalid',
      })
      .int('validity_hours_invalid')
      .min(1, 'validity_hours_too_low')
      .max(168, 'validity_hours_too_high'),

    notes: optionalNonEmpty(2000, 'notes_too_long'),
  })
  .strict();

export type OperatorOfferInput = z.infer<typeof operatorOfferSchema>;
