import { z } from 'zod';

/**
 * Phase 12 PR 2 — Zod schemas for the medevac operator offer
 * surface (§4.3 submit_medevac_offer + §4.5 withdraw).
 *
 * Numeric width: prices stay DECIMAL(14, 2) in DB; Zod caps
 * at 99,999,999,999.99 (12 digits before decimal) which is
 * the spec-defined maximum that fits the column.
 *
 * Timestamps: pickup must be future + arrival > pickup. The
 * DB CHECK constraint medevac_offers_time_order_check enforces
 * arrival > pickup as defense-in-depth; pickup-future is a
 * Zod-only invariant (NOW() drifts) so the RPC checks it too.
 *
 * Whitespace handling: every string trimmed at the Zod boundary
 * (mirrors Phase 11 cargo + PR 1 medevac validator discipline).
 */

const PRICE_MAX = 99_999_999_999.99;

const isoTimestampSchema = z
  .string()
  .min(1, 'التوقيت مطلوب')
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'تنسيق التوقيت غير صحيح',
  });

export const medevacOfferSchema = z
  .object({
    medevac_request_id: z
      .string()
      .uuid('معرّف الطلب غير صحيح'),
    aircraft_id: z
      .string()
      .uuid('معرّف الطائرة غير صحيح'),
    aircraft_snapshot: z
      .string()
      .trim()
      .max(500, 'وصف الطائرة لا يتعدى 500 حرف')
      .optional()
      .nullable(),
    medical_team_snapshot: z
      .string()
      .trim()
      .max(500, 'وصف الطاقم الطبي لا يتعدى 500 حرف')
      .optional()
      .nullable(),
    base_price_sar: z
      .number()
      .positive('السعر الأساسي يجب أن يكون موجباً')
      .max(PRICE_MAX, 'السعر الأساسي خارج النطاق المسموح'),
    medical_team_price_sar: z
      .number()
      .min(0, 'سعر الطاقم الطبي لا يكون سالباً')
      .max(PRICE_MAX, 'سعر الطاقم الطبي خارج النطاق')
      .optional()
      .default(0),
    insurance_coordination_price_sar: z
      .number()
      .min(0, 'سعر تنسيق التأمين لا يكون سالباً')
      .max(PRICE_MAX, 'سعر تنسيق التأمين خارج النطاق')
      .optional()
      .default(0),
    proposed_pickup_at: isoTimestampSchema,
    proposed_arrival_at: isoTimestampSchema,
    operator_notes: z
      .string()
      .trim()
      .max(1000, 'الملاحظات لا تتعدى 1000 حرف')
      .optional()
      .nullable(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const pickup = Date.parse(val.proposed_pickup_at);
    const arrival = Date.parse(val.proposed_arrival_at);
    if (!Number.isNaN(pickup) && pickup <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposed_pickup_at'],
        message: 'موعد الإقلاع يجب أن يكون في المستقبل',
      });
    }
    if (
      !Number.isNaN(pickup) &&
      !Number.isNaN(arrival) &&
      arrival <= pickup
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposed_arrival_at'],
        message: 'موعد الوصول يجب أن يكون بعد موعد الإقلاع',
      });
    }
  });

export type MedevacOfferInput = z.infer<typeof medevacOfferSchema>;
