import { z } from 'zod';

/**
 * Phase 14 — operator crew (crew_members CRUD) validators.
 *
 * Defence-in-depth: the SECURITY DEFINER RPCs re-validate every field +
 * own the ownership guard. Zod gives friendly form errors. Numbers come
 * as strings → coerced; languages/specializations come as string arrays
 * (the form splits a comma-separated input). There is NO delete.
 */

export const crewRoleSchema = z.enum([
  'captain',
  'first_officer',
  'flight_attendant',
]);

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional()
  );

const baseCrewFields = {
  full_name: z.string().trim().min(1, 'الاسم الكامل مطلوب').max(200),
  role: crewRoleSchema,
  nationality: z.string().trim().max(50).optional(),
  languages: z.array(z.string().trim().min(1)).max(20).optional().default([]),
  specializations: z
    .array(z.string().trim().min(1))
    .max(20)
    .optional()
    .default([]),
  experience_hours: optionalInt(0, 100000),
  license_number: z.string().trim().max(100).optional(),
  // yyyy-mm-dd from a <input type="date"> or '' — the RPC casts/validates.
  license_expiry: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح')
    .optional()
    .or(z.literal('')),
  extra_fee: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().min(0).max(1_000_000).optional()
  ),
};

export const createCrewSchema = z.object({ ...baseCrewFields });

export const updateCrewSchema = z.object({
  crew_id: z.string().uuid('معرّف العضو غير صالح'),
  ...baseCrewFields,
});

export const setCrewAvailabilitySchema = z.object({
  crew_id: z.string().uuid('معرّف العضو غير صالح'),
  is_available: z.boolean(),
});

export type CreateCrewInput = z.infer<typeof createCrewSchema>;
export type UpdateCrewInput = z.infer<typeof updateCrewSchema>;
export type SetCrewAvailabilityInput = z.infer<
  typeof setCrewAvailabilitySchema
>;
