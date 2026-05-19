import { z } from 'zod';

/**
 * Phase 11 PR 2 — Zod schemas for cargo offer/request action wrappers.
 *
 * These schemas validate the SHAPE of the input only; all business
 * rules (offer status, ownership, expiry) are enforced inside the
 * SECURITY DEFINER RPCs (§4.4-§4.6 of PHASE-11-CARGO-SPEC.md +
 * PHASE-11-PR-2-SPEC.md). Two layers — Zod at the Server Action
 * boundary catches malformed inputs before the round-trip; the
 * RPC enforces auth + state.
 *
 * Reasons are capped at 500 chars (matches DB CHECK constraints
 * in §1.2 + §1.3 of the migration). `.trim()` collapses
 * whitespace-only into empty so the optional pattern works
 * naturally — if the user submits "   " the trim makes it ""
 * which the DB then converts to NULL via NULLIF(BTRIM(...), '').
 */

const reasonField = z
  .string()
  .trim()
  .max(500, 'السبب لا يتعدى 500 حرف')
  .optional();

export const acceptOfferSchema = z.object({
  offer_id: z.string().uuid('معرّف العرض غير صحيح'),
  // Phase 13 PR 3 — optional cashback redemption at accept time
  // (D7 caps enforced server-side by redeem_cashback_for_booking).
  cashback_redemption_sar: z
    .number()
    .int('قيمة الاسترداد يجب أن تكون عدداً صحيحاً')
    .min(0, 'قيمة الاسترداد لا يمكن أن تكون سالبة')
    .optional(),
});

export const declineOfferSchema = z.object({
  offer_id: z.string().uuid('معرّف العرض غير صحيح'),
  reason: reasonField,
});

export const cancelRequestSchema = z.object({
  request_id: z.string().uuid('معرّف الطلب غير صحيح'),
  reason: reasonField,
});

export const withdrawOfferSchema = z.object({
  offer_id: z.string().uuid('معرّف العرض غير صحيح'),
  reason: reasonField,
});

export type AcceptOfferInput = z.infer<typeof acceptOfferSchema>;
export type DeclineOfferInput = z.infer<typeof declineOfferSchema>;
export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;
export type WithdrawOfferInput = z.infer<typeof withdrawOfferSchema>;
