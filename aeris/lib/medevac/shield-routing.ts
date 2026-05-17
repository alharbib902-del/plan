import { z } from 'zod';

/**
 * Phase 12 PR 2 — extracted helpers for the J5 Shield
 * routing decision inside `submitMedevacRequestAuthed`.
 *
 * Round 1 PR #76 P1 #1 fix moved the J5 covered-event
 * dispatch from §4.2 RPC into the Server Action layer; this
 * module holds the truthy-discriminator + schema so the
 * branching logic is testable in isolation (no Next.js
 * runtime dependencies).
 */

/**
 * The `use_subscription` payload discriminator can arrive
 * from a JSON form post as a boolean OR a string. Treat
 * exactly these as truthy (the Server Action narrowly
 * accepts this set; §4.2 RPC mirrors it as defense-in-depth
 * with a wider set including `'t'/'yes'` so a future caller
 * refactor still fails closed).
 */
export function isUseSubscriptionTruthy(value: unknown): boolean {
  return (
    value === true ||
    value === 'true' ||
    value === 1 ||
    value === '1'
  );
}

/**
 * Shape of the J5-routing extension on the request payload.
 * The Server Action validates this BEFORE calling §4.7
 * consume_aeris_shield_event. The base medevac request
 * payload (severity, service_level, route, value, contact_*)
 * is validated separately via medevacRequestAuthedSchema.
 */
export const shieldRoutingSchema = z
  .object({
    use_subscription: z.literal(true),
    subscription_id: z.string().uuid('معرّف الاشتراك غير صحيح'),
    patient_member_name: z
      .string()
      .trim()
      .min(1, 'اسم العضو المُغطَّى مطلوب')
      .max(200, 'اسم العضو لا يتعدى 200 حرف'),
    patient_member_dob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صحيح (YYYY-MM-DD)'),
  })
  .passthrough();

export type ShieldRoutingInput = z.infer<typeof shieldRoutingSchema>;
