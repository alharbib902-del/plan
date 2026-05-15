import { z } from 'zod';

/**
 * Phase 11 PR 1 — Zod schemas for the cargo intake RPCs.
 *
 * Two surfaces:
 *   - cargoRequestPublicSchema: §4.1 create_cargo_request_guest
 *     (full payload from /cargo public form including customer
 *     name/phone/email)
 *   - cargoRequestAuthedSchema: §4.2 create_cargo_request_authenticated
 *     (same shape minus customer fields — those come from clients
 *     table via session)
 *
 * Per-category required fields enforced via z.discriminatedUnion;
 * Zod is the primary validation line, DB CHECK constraints are
 * defense-in-depth (Codex round 3 P2 #3 strict per-category form).
 *
 * Width limits mirror the §3.1 schema (Codex round 8 P1 #1):
 *   - customer_name: max 120
 *   - customer_phone: max 20
 *   - customer_email: max 120
 *   - origin_iata / destination_iata: max 4
 */

// ============================================================
// Shared field schemas
// ============================================================

const cargoTypeSchema = z.enum(['horse', 'luxury_car', 'valuables', 'other']);

const horseFieldsSchema = z
  .object({
    horse_count: z
      .number()
      .int()
      .positive()
      .max(30, 'لا يمكن شحن أكثر من 30 خيلاً في الرحلة الواحدة'),
    horse_groom_required: z.boolean().optional(),
    horse_cites_status: z
      .enum(['ready', 'in_progress', 'help_needed'])
      .optional(),
    horse_stall_requirements: z.string().optional(),
  })
  .strict();

const luxuryCarFieldsSchema = z
  .object({
    car_make: z.string().min(1, 'صانع السيارة مطلوب'),
    car_model: z.string().min(1, 'موديل السيارة مطلوب'),
    car_year: z
      .number()
      .int()
      .min(1900)
      .max(2100)
      .optional(),
    car_running_condition: z.boolean().optional(),
    car_enclosed_required: z.boolean().optional(),
  })
  .strict();

const valuablesFieldsSchema = z
  .object({
    valuables_declared_value_sar: z
      .number()
      .positive('القيمة المُصرَّح بها يجب أن تكون موجبة'),
    valuables_security_level: z
      .enum(['standard', 'high', 'armed_escort'])
      .optional(),
    valuables_climate_controlled: z.boolean().optional(),
    valuables_item_description: z.string().optional(),
  })
  .strict();

const otherFieldsSchema = z
  .object({
    other_description: z
      .string()
      .min(1, 'وصف البضاعة مطلوب لفئة "أخرى"'),
    other_dimensions_lwh_cm: z.string().optional(),
    other_weight_kg: z.number().positive().optional(),
    other_special_handling: z.string().optional(),
  })
  .strict();

const sharedShipmentSchema = z.object({
  origin_iata: z
    .string()
    .max(4, 'رمز IATA لا يتعدى 4 أحرف')
    .optional()
    .nullable(),
  origin_freeform: z.string().optional().nullable(),
  destination_iata: z
    .string()
    .max(4, 'رمز IATA لا يتعدى 4 أحرف')
    .optional()
    .nullable(),
  destination_freeform: z.string().optional().nullable(),
  pickup_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صحيح (YYYY-MM-DD)'),
  delivery_date_target: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صحيح (YYYY-MM-DD)')
    .optional()
    .nullable(),
  flexibility_days: z.number().int().min(0).max(7).optional().default(0),
  estimated_value_sar: z.number().positive('القيمة التقديرية يجب أن تكون موجبة'),
  insurance_required: z.boolean().optional().default(false),
  handling_notes: z.string().optional().nullable(),
});

const customerFieldsSchema = z.object({
  customer_name: z
    .string()
    .min(1, 'الاسم مطلوب')
    .max(120, 'الاسم لا يتعدى 120 حرفاً'),
  customer_phone: z
    .string()
    .min(1, 'رقم الهاتف مطلوب')
    .max(20, 'رقم الهاتف لا يتعدى 20 حرفاً'),
  customer_email: z
    .string()
    .email('بريد إلكتروني غير صحيح')
    .max(120, 'البريد الإلكتروني لا يتعدى 120 حرفاً')
    .optional()
    .nullable(),
});

// ============================================================
// Public schema (§4.1)
// ============================================================

export const cargoRequestPublicSchema = z
  .discriminatedUnion('cargo_type', [
    z
      .object({ cargo_type: z.literal('horse') })
      .merge(customerFieldsSchema)
      .merge(sharedShipmentSchema)
      .merge(horseFieldsSchema),
    z
      .object({ cargo_type: z.literal('luxury_car') })
      .merge(customerFieldsSchema)
      .merge(sharedShipmentSchema)
      .merge(luxuryCarFieldsSchema),
    z
      .object({ cargo_type: z.literal('valuables') })
      .merge(customerFieldsSchema)
      .merge(sharedShipmentSchema)
      .merge(valuablesFieldsSchema),
    z
      .object({ cargo_type: z.literal('other') })
      .merge(customerFieldsSchema)
      .merge(sharedShipmentSchema)
      .merge(otherFieldsSchema),
  ])
  .superRefine((val, ctx) => {
    // Route-presence cross-field check (DB §3.1
    // cargo_requests_*_present_check is the second line)
    if (!val.origin_iata?.trim() && !val.origin_freeform?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['origin_iata'],
        message: 'حدد مكان الانطلاق (IATA أو نص حر)',
      });
    }
    if (
      !val.destination_iata?.trim() &&
      !val.destination_freeform?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination_iata'],
        message: 'حدد الوجهة (IATA أو نص حر)',
      });
    }
    // Date-order cross-field check (mirrors DB
    // cargo_requests_date_order_check)
    if (
      val.delivery_date_target &&
      val.delivery_date_target < val.pickup_date
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['delivery_date_target'],
        message: 'تاريخ التسليم يجب أن يكون بعد تاريخ الاستلام',
      });
    }
  });

export type CargoRequestPublicInput = z.infer<typeof cargoRequestPublicSchema>;

// ============================================================
// Authed schema (§4.2)
// ============================================================
//
// Same shape minus customer fields (sourced from clients table
// at the RPC layer to prevent identity spoofing).

export const cargoRequestAuthedSchema = z
  .discriminatedUnion('cargo_type', [
    z
      .object({ cargo_type: z.literal('horse') })
      .merge(sharedShipmentSchema)
      .merge(horseFieldsSchema),
    z
      .object({ cargo_type: z.literal('luxury_car') })
      .merge(sharedShipmentSchema)
      .merge(luxuryCarFieldsSchema),
    z
      .object({ cargo_type: z.literal('valuables') })
      .merge(sharedShipmentSchema)
      .merge(valuablesFieldsSchema),
    z
      .object({ cargo_type: z.literal('other') })
      .merge(sharedShipmentSchema)
      .merge(otherFieldsSchema),
  ])
  .superRefine((val, ctx) => {
    if (!val.origin_iata?.trim() && !val.origin_freeform?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['origin_iata'],
        message: 'حدد مكان الانطلاق',
      });
    }
    if (
      !val.destination_iata?.trim() &&
      !val.destination_freeform?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination_iata'],
        message: 'حدد الوجهة',
      });
    }
    if (
      val.delivery_date_target &&
      val.delivery_date_target < val.pickup_date
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['delivery_date_target'],
        message: 'تاريخ التسليم يجب أن يكون بعد تاريخ الاستلام',
      });
    }
  });

export type CargoRequestAuthedInput = z.infer<typeof cargoRequestAuthedSchema>;
