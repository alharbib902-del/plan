import { z } from 'zod';

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
});

export type PromoteLeadInput = z.infer<typeof promoteLeadSchema>;

export const AIRCRAFT_CATEGORY_LABEL_AR: Record<AircraftCategoryValue, string> = {
  light: 'خفيفة',
  mid: 'متوسطة',
  super_mid: 'متوسطة فاخرة',
  heavy: 'كبيرة',
  long_range: 'بعيدة المدى',
};
