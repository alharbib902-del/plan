import { z } from 'zod';

/**
 * Phase 12 PR 2 — Zod schemas for the medevac lifecycle
 * Server Actions (accept/decline/withdraw/cancel).
 *
 * All UUIDs validated at the boundary (mirrors Phase 11 cargo
 * pattern); reason length capped at 500 to mirror the DB
 * length CHECK constraints.
 */

export const acceptOfferSchema = z
  .object({
    offer_id: z.string().uuid('معرّف العرض غير صحيح'),
    // Phase 13 PR 3 — optional cashback redemption (D7 caps
    // enforced server-side). UI must NOT send a redemption for
    // J5 covered-event medevac bookings; covered bookings have
    // no cash flow to credit. Phase 13.1 will add an RPC-level
    // guard on is_covered.
    cashback_redemption_sar: z
      .number()
      .int('قيمة الاسترداد يجب أن تكون عدداً صحيحاً')
      .min(0, 'قيمة الاسترداد لا يمكن أن تكون سالبة')
      .optional(),
  })
  .strict();

export type AcceptOfferInput = z.infer<typeof acceptOfferSchema>;

export const declineOfferSchema = z
  .object({
    offer_id: z.string().uuid('معرّف العرض غير صحيح'),
    reason: z
      .string()
      .trim()
      .max(500, 'سبب الرفض لا يتعدى 500 حرف')
      .optional(),
  })
  .strict();

export type DeclineOfferInput = z.infer<typeof declineOfferSchema>;

export const withdrawOfferSchema = z
  .object({
    offer_id: z.string().uuid('معرّف العرض غير صحيح'),
    reason: z
      .string()
      .trim()
      .max(500, 'سبب السحب لا يتعدى 500 حرف')
      .optional(),
  })
  .strict();

export type WithdrawOfferInput = z.infer<typeof withdrawOfferSchema>;

export const cancelRequestSchema = z
  .object({
    request_id: z.string().uuid('معرّف الطلب غير صحيح'),
    reason: z
      .string()
      .trim()
      .max(500, 'سبب الإلغاء لا يتعدى 500 حرف')
      .optional(),
  })
  .strict();

export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;
