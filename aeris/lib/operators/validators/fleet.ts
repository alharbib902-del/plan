import { z } from 'zod';

/**
 * Phase 14 — operator fleet (aircraft CRUD) validators.
 *
 * Defence-in-depth: the SECURITY DEFINER RPCs re-validate every field
 * and own the registration-uniqueness + ownership guards. Zod gives the
 * form friendly errors before the network round-trip. Numbers arrive as
 * strings from the form → coerced; optional numerics treat '' as absent.
 */

export const aircraftCategorySchema = z.enum([
  'light',
  'mid',
  'super_mid',
  'heavy',
  'long_range',
]);

// status the operator may set via the edit form (retire is a separate action).
export const aircraftEditableStatusSchema = z.enum(['active', 'maintenance']);

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional()
  );

const baseAircraftFields = {
  manufacturer: z.string().trim().min(1, 'الصانع مطلوب').max(100),
  model: z.string().trim().min(1, 'الموديل مطلوب').max(100),
  category: aircraftCategorySchema,
  year: optionalInt(1960, 2100),
  max_passengers: z.coerce
    .number()
    .int()
    .min(1, 'عدد الركّاب يجب أن يكون 1 على الأقل')
    .max(100),
  max_range_km: optionalInt(1, 30000),
  base_hourly_rate: z.coerce
    .number()
    .min(1, 'السعر بالساعة يجب أن يكون أكبر من صفر')
    .max(1_000_000),
  is_cargo_capable: z.boolean().optional().default(false),
  is_medevac_capable: z.boolean().optional().default(false),
};

export const createAircraftSchema = z.object({
  registration: z.string().trim().min(1, 'رقم التسجيل مطلوب').max(20),
  ...baseAircraftFields,
});

export const updateAircraftSchema = z.object({
  aircraft_id: z.string().uuid('معرّف الطائرة غير صالح'),
  status: aircraftEditableStatusSchema,
  ...baseAircraftFields,
});

export const retireAircraftSchema = z.object({
  aircraft_id: z.string().uuid('معرّف الطائرة غير صالح'),
});

export type CreateAircraftInput = z.infer<typeof createAircraftSchema>;
export type UpdateAircraftInput = z.infer<typeof updateAircraftSchema>;
export type RetireAircraftInput = z.infer<typeof retireAircraftSchema>;
