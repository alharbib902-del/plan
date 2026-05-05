import { z } from 'zod';

// E.164: starts with '+', then 7-15 digits (first non-zero).
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Phase 5 multi-operator dispatch input.
 *
 * Spec acceptance #14: 1 ≤ N ≤ 8 phones, each E.164. The Server
 * Action enforces this here BEFORE any DB call. The RPC re-checks
 * length 1..8 + uniqueness as defense-in-depth, so a bad caller
 * still sees a structured `invalid_targets` error.
 *
 * Phone uniqueness is enforced here too: the same operator phone
 * twice in the same dispatch is a UI mistake, not a feature.
 */
export const dispatchTripV2Schema = z.object({
  trip_request_id: z.string().uuid('trip_id_invalid'),
  phones: z
    .array(z.string().trim().regex(E164, 'phone_invalid'))
    .min(1, 'phones_too_few')
    .max(8, 'phones_too_many')
    .refine(
      (arr) => new Set(arr).size === arr.length,
      'phones_duplicate'
    ),
});

export type DispatchTripV2Input = z.infer<typeof dispatchTripV2Schema>;
