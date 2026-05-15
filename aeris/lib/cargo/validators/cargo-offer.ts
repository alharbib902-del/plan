import { z } from 'zod';

/**
 * Phase 11 PR 2 — Zod schema for `submit_cargo_offer` Server Action.
 *
 * The §4.3 RPC accepts a JSONB payload. This schema mirrors the
 * required + optional fields and enforces:
 *   - cargo_request_id + aircraft_id: UUID shape
 *   - prices: number, base_price > 0, others ≥ 0
 *   - dates: YYYY-MM-DD shape; delivery >= pickup
 *   - text fields: trimmed (so "   " becomes "" → NULL via DB)
 *
 * Per Phase 11 spec §4.3, the RPC also enforces:
 *   - aircraft must be capability-matched to cargo_type
 *   - operator must own the aircraft
 *   - request must be in pending/offers_received status
 *   - request not expired
 *   - operator not already submitted on this request
 * — those don't fit Zod (need DB state).
 */

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const cargoOfferSchema = z
  .object({
    cargo_request_id: z.string().uuid('معرّف الطلب غير صحيح'),
    aircraft_id: z.string().uuid('معرّف الطائرة غير صحيح'),
    aircraft_snapshot: z
      .string()
      .trim()
      .max(500, 'وصف الطائرة لا يتعدى 500 حرف')
      .optional(),
    base_price_sar: z
      .number({ invalid_type_error: 'السعر الأساسي مطلوب' })
      .positive('السعر الأساسي يجب أن يكون موجباً'),
    insurance_price_sar: z
      .number()
      .nonnegative('سعر التأمين لا يمكن أن يكون سالباً')
      .optional()
      .default(0),
    customs_handling_price_sar: z
      .number()
      .nonnegative('سعر الجمارك لا يمكن أن يكون سالباً')
      .optional()
      .default(0),
    proposed_pickup_date: z
      .string()
      .regex(datePattern, 'تاريخ الاستلام غير صحيح (YYYY-MM-DD)'),
    proposed_delivery_date: z
      .string()
      .regex(datePattern, 'تاريخ التسليم غير صحيح (YYYY-MM-DD)'),
    operator_notes: z
      .string()
      .trim()
      .max(1000, 'الملاحظات لا تتعدى 1000 حرف')
      .optional(),
  })
  .superRefine((val, ctx) => {
    // Date order check (mirrors DB cargo_offers_date_order_check).
    if (val.proposed_delivery_date < val.proposed_pickup_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposed_delivery_date'],
        message: 'تاريخ التسليم يجب أن يكون بعد تاريخ الاستلام',
      });
    }
  });

export type CargoOfferInput = z.infer<typeof cargoOfferSchema>;
