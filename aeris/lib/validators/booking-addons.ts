import { z } from 'zod';

import { ADDONS_BY_SUBTYPE } from '@/lib/addons/catalog';

/**
 * Phase 6.2: Zod schemas for the booking add-ons surface.
 *
 * Three schemas, one per Server Action shipped in PR 2b:
 *   - `adminAttachAddonSchema` — admin attach (founder picks
 *     a catalog entry, optionally overrides price + quantity).
 *   - `customerRemoveAddonSchema` — customer-side soft-cancel
 *     of a `'pending'` add-on.
 *   - `customerConfirmCheckoutSchema` — customer-side confirm
 *     of every `'pending'` add-on on the booking.
 *
 * Codex iteration-3 P1 #2 fix: neither customer schema
 * accepts a `booking_id` input. The Server Action extracts
 * `booking_id` from the verified token's payload and uses
 * THAT as the UPDATE target. A crafted request passing
 * token-for-A + booking_id-of-B can no longer confuse the
 * action because there is no `booking_id` input to confuse.
 *
 * The schemas + Server Actions are exported in PR 1 so that
 * `tsc --noEmit` validates their shapes, but no UI consumer
 * imports them yet (PR 2b is the consumer).
 */

// ============================================================================
// Admin attach
// ============================================================================

export const adminAttachAddonSchema = z.object({
  trip_request_id: z.string().uuid('trip_request_id_invalid'),
  addon_subtype: z
    .string()
    .refine((v) => ADDONS_BY_SUBTYPE.has(v), 'addon_subtype_unknown'),
  // Both override fields are optional. When omitted, the
  // catalog default is used. When supplied, must fall inside
  // the catalog [min, max] range — checked server-side in
  // PR 2a's `attach_booking_addon` SQL function (defense in
  // depth alongside this Zod).
  unit_price_override: z
    .number()
    .nonnegative('unit_price_negative')
    .optional(),
  quantity: z
    .number()
    .int('quantity_invalid')
    .min(1, 'quantity_min')
    .max(50, 'quantity_max')
    .optional(),
  // Per-row freeform note (e.g. "Mercedes S-Class only,
  // black exterior" for a limousine row). Distinct from
  // trip_requests.special_requests; the SQL function
  // normalizes NULL/whitespace-only notes to `'{}'::jsonb`
  // (Codex iteration-7 P2 #1 fix).
  note: z.string().trim().max(500, 'note_too_long').optional(),
});

export type AdminAttachAddonInput = z.infer<typeof adminAttachAddonSchema>;

// ============================================================================
// Customer-side: remove (soft-cancel a 'pending' add-on)
// ============================================================================

/**
 * Codex iteration-3 P1 #2 fix: NO `booking_id` input. The
 * Server Action calls `verifyCheckoutToken(token)` to extract
 * the payload's `booking_id` + asserts the booking_addon
 * belongs to that booking before any UPDATE.
 *
 * Iteration-6 P1 fix: the Server Action calls
 * `customer_cancel_booking_addon(p_booking_addon_id)` (NOT
 * the unified cancel RPC). That SQL function rejects
 * `'confirmed'` rows with `addon_not_cancellable` and only
 * allows `'pending'` → `'cancelled'` — a crafted request
 * reusing a valid token AFTER `confirm_checkout_prep`
 * flipped rows to `'confirmed'` cannot cancel a confirmed
 * row.
 */
export const customerRemoveAddonSchema = z.object({
  booking_addon_id: z.string().uuid('booking_addon_id_invalid'),
  token: z.string().min(1, 'token_required'),
});

export type CustomerRemoveAddonInput = z.infer<
  typeof customerRemoveAddonSchema
>;

// ============================================================================
// Customer-side: confirm (flip every 'pending' add-on to 'confirmed')
// ============================================================================

/**
 * Same posture as remove: token only, booking_id is
 * extracted from the verified payload.
 *
 * The Server Action runs the three-layer token validation
 * (signature + payload exp via `verifyCheckoutToken`; DB
 * hash match against `bookings.checkout_token_hash`; DB
 * expiry against `bookings.checkout_token_expires_at >
 * NOW()`) before calling
 * `confirm_checkout_prep(p_booking_id)` per S5.
 */
export const customerConfirmCheckoutSchema = z.object({
  token: z.string().min(1, 'token_required'),
});

export type CustomerConfirmCheckoutInput = z.infer<
  typeof customerConfirmCheckoutSchema
>;
