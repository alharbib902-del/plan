import { z } from 'zod';

import { isoBirthDateSchema } from '@/lib/medevac/validators/medevac-subscription';

/**
 * Phase 12 PR 2 — extracted helpers for the J5 Shield
 * routing decision inside `submitMedevacRequestAuthed`.
 *
 * Round 1 PR #76 P1 #1 fix moved the J5 covered-event
 * dispatch from §4.2 RPC into the Server Action layer; this
 * module holds the truthy-discriminator + schema so the
 * branching logic is testable in isolation (no Next.js
 * runtime dependencies).
 *
 * Round 2 PR #77 P2 #3 fix — patient_member_dob reuses the
 * `isoBirthDateSchema` from medevac-subscription so a
 * shape-valid-but-overflowing date (e.g. "2026-02-31") is
 * rejected at the Zod boundary. Previously a regex-only
 * check let those pass through to the RPC, where Postgres
 * cast the DATE argument BEFORE the function body could
 * return `patient_dob_invalid` — surfacing a raw 22008
 * `datetime_field_overflow` instead of the structured code.
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
    // Round 3 PR #77 P2 #1 fix — preprocess so the schema
    // accepts the same allowlist as isUseSubscriptionTruthy
    // (boolean true OR string 'true' OR number 1 OR string
    // '1'). Without this, submitMedevacRequestAuthed would
    // route a payload like { use_subscription: 'true', ... }
    // into the Shield branch (because the helper returns
    // true), then the schema's z.literal(true) check would
    // reject the SAME value and the caller gets
    // `validation_failed` instead of consuming a Shield
    // event. The preprocess normalises any truthy variant
    // to the literal boolean true BEFORE the literal check
    // runs, keeping the routing decision and the validation
    // step semantically aligned.
    use_subscription: z.preprocess(
      (val) => (isUseSubscriptionTruthy(val) ? true : val),
      z.literal(true)
    ),
    subscription_id: z.string().uuid('معرّف الاشتراك غير صحيح'),
    patient_member_name: z
      .string()
      .trim()
      .min(1, 'اسم العضو المُغطَّى مطلوب')
      .max(200, 'اسم العضو لا يتعدى 200 حرف'),
    // Round 2 PR #77 P2 #3 fix — reuses the strict DOB
    // contract from medevac-subscription so semantically
    // invalid dates (2026-02-31 / 2026-13-01 / future) are
    // rejected at the Zod boundary, BEFORE Postgres argument
    // binding for §4.7 consume_aeris_shield_event would
    // raise a raw 22008.
    patient_member_dob: isoBirthDateSchema,
  })
  .passthrough();

export type ShieldRoutingInput = z.infer<typeof shieldRoutingSchema>;
