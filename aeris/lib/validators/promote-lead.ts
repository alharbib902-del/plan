import { z } from 'zod';
import { tripPreferencesSchema } from '@/lib/validators/trip-preferences';

export const AIRCRAFT_CATEGORIES = [
  'light',
  'mid',
  'super_mid',
  'heavy',
  'long_range',
] as const;

export type AircraftCategoryValue = (typeof AIRCRAFT_CATEGORIES)[number];

export const promoteLeadSchema = z.object({
  lead_id: z.string().uuid('lead_id_invalid'),
  aircraft_category: z.enum(AIRCRAFT_CATEGORIES, {
    required_error: 'aircraft_category_required',
    invalid_type_error: 'aircraft_category_invalid',
  }),
  special_requests: z
    .string()
    .trim()
    .max(2000, 'special_requests_too_long')
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional(),
  // Phase 6.1 PR 2: structured customer preferences. The
  // founder amends customer-pre-filled values (read from
  // lead_inquiries.preferences) before submitting.
  // tripPreferencesSchema is .strict() (rejects unknown
  // keys) and all fields are optional.
  preferences: tripPreferencesSchema.optional(),
});

export type PromoteLeadInput = z.infer<typeof promoteLeadSchema>;

export const AIRCRAFT_CATEGORY_LABEL_AR: Record<AircraftCategoryValue, string> = {
  light: 'خفيفة',
  mid: 'متوسطة',
  super_mid: 'متوسطة فاخرة',
  heavy: 'كبيرة',
  long_range: 'بعيدة المدى',
};
