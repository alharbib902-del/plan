'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  hashCheckoutToken,
  verifyCheckoutToken,
} from '@/lib/checkout/customer-token';
import {
  customerConfirmCheckoutSchema,
  customerRemoveAddonSchema,
} from '@/lib/validators/booking-addons';
import type {
  BookingAddonRow,
  ConfirmCheckoutPrepResult,
  CustomerCancelBookingAddonResult,
} from '@/types/database';

/**
 * Phase 6.2 PR 2b: customer Server Actions on the
 * checkout-prep page.
 *
 * Two actions, both behind the **three-layer token
 * validation** (Codex iteration-4 P2 #3 fix):
 *
 *   1. **Signature + payload exp** via
 *      `verifyCheckoutToken(token)`. HMAC against
 *      `CUSTOMER_CHECKOUT_SECRET`; asserts
 *      `payload.exp > NOW()`. Returns `null` on any
 *      failure including missing secret (fail-closed
 *      posture; Codex iteration-3 P1 #3).
 *
 *   2. **DB hash match**: `bookings.checkout_token_hash =
 *      sha256(token)`. Catches token rotation — re-issuing
 *      via the admin button writes a new hash; the old
 *      token's signature still verifies but the hash check
 *      fails.
 *
 *   3. **DB expiry**: `bookings.checkout_token_expires_at >
 *      NOW()`. Founder soft-revoke lever — shorten the
 *      validity window without re-issuing.
 *
 * **All three failures render the same surface upward**
 * (the `'invalid_token'` opaque error code). The customer
 * page maps `'invalid_token'` to the same "expired or
 * not-issued" surface regardless of which check fired.
 * Defense in depth — the customer cannot tell which check
 * failed.
 *
 * **Codex iteration-3 P1 #2 fix**: neither action accepts a
 * `booking_id` input. The action calls `verifyCheckoutToken`
 * to extract `payload.booking_id` and uses THAT as the
 * UPDATE target.
 */

// ============================================================================
// Shared three-layer validation
// ============================================================================

type ValidationResult =
  | { ok: true; booking_id: string }
  | { ok: false; error: 'invalid_token' };

async function validateCustomerToken(
  rawToken: string
): Promise<ValidationResult> {
  // Layer 1: signature + payload exp.
  const payload = verifyCheckoutToken(rawToken);
  if (!payload) {
    return { ok: false, error: 'invalid_token' };
  }

  // Layer 2 + 3: DB hash + DB expiry. Single SELECT.
  const client = createAdminClient();
  const { data: booking, error } = await client
    .from('bookings')
    .select('id, checkout_token_hash, checkout_token_expires_at')
    .eq('id', payload.booking_id)
    .maybeSingle();

  if (error) {
    console.error('[checkout-prep.validate] DB error', error);
    return { ok: false, error: 'invalid_token' };
  }
  if (!booking) {
    return { ok: false, error: 'invalid_token' };
  }

  // Layer 2: hash compare.
  const expectedHash = hashCheckoutToken(rawToken);
  if (
    !booking.checkout_token_hash ||
    booking.checkout_token_hash !== expectedHash
  ) {
    return { ok: false, error: 'invalid_token' };
  }

  // Layer 3: DB expiry (founder's soft-revoke lever).
  if (
    !booking.checkout_token_expires_at ||
    new Date(booking.checkout_token_expires_at).getTime() <= Date.now()
  ) {
    return { ok: false, error: 'invalid_token' };
  }

  return { ok: true, booking_id: payload.booking_id };
}

// ============================================================================
// removeCustomerAddon — soft-cancel a 'pending' addon
// ============================================================================
//
// Calls `customer_cancel_booking_addon(p_booking_addon_id)`
// — the SQL function ONLY allows 'pending' → 'cancelled'.
// Confirmed / cancelled / delivered all return
// `addon_not_cancellable` (Codex iteration-6 P1 fix).
//
// Server Action additionally asserts that the
// `booking_addon` belongs to the booking the token
// authorizes (`booking_addon.booking_id ===
// payload.booking_id`). A leaked token cannot cancel
// add-ons on a different booking.

export type RemoveCustomerAddonResult =
  | {
      ok: true;
      addon: BookingAddonRow;
    }
  | {
      ok: false;
      error:
        | 'invalid_token'
        | 'invalid_input'
        | 'addon_not_in_booking'
        | 'addon_not_found'
        | 'addon_not_cancellable'
        | 'rpc_failed';
    };

export async function removeCustomerAddon(input: {
  token: string;
  booking_addon_id: string;
}): Promise<RemoveCustomerAddonResult> {
  const parsed = customerRemoveAddonSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  // Three-layer validation.
  const validation = await validateCustomerToken(parsed.data.token);
  if (!validation.ok) {
    return { ok: false, error: 'invalid_token' };
  }

  // Look up the booking_addon to assert booking match
  // BEFORE calling the cancel RPC. A crafted request with
  // a valid token + an addon UUID from a different booking
  // gets rejected here.
  const client = createAdminClient();
  const { data: addonRow, error: lookupError } = await client
    .from('booking_addons')
    .select('id, booking_id')
    .eq('id', parsed.data.booking_addon_id)
    .maybeSingle();

  if (lookupError) {
    console.error('[checkout-prep.removeCustomerAddon] lookup error', lookupError);
    return { ok: false, error: 'rpc_failed' };
  }
  if (!addonRow) {
    return { ok: false, error: 'addon_not_found' };
  }
  if (addonRow.booking_id !== validation.booking_id) {
    return { ok: false, error: 'addon_not_in_booking' };
  }

  // Call the customer-only cancel RPC. Returns
  // `addon_not_cancellable` if the addon is not 'pending'.
  const { data, error } = await client.rpc('customer_cancel_booking_addon', {
    p_booking_addon_id: parsed.data.booking_addon_id,
  });

  if (error) {
    console.error('[checkout-prep.removeCustomerAddon] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as CustomerCancelBookingAddonResult;
  // Revalidate the public checkout-prep page so the
  // remove-button state + totals re-render. The token
  // path is dynamic (`[token]`); revalidate by tag would
  // be cleaner but the simpler revalidate-path approach
  // works because Next.js wildcards segment params.
  revalidatePath('/booking/[token]/checkout-prep', 'page');
  if (result.ok) {
    return { ok: true, addon: result.addon };
  }
  return { ok: false, error: result.error };
}

// ============================================================================
// confirmCheckoutPrep — flip every 'pending' addon to 'confirmed'
// ============================================================================
//
// Calls `confirm_checkout_prep(p_booking_id)`. Idempotent;
// already-confirmed rows are not touched. Does NOT touch
// `payment_status` (stays 'pending_offline') — Phase 11
// handles payment.

export type ConfirmCheckoutPrepActionResult =
  | {
      ok: true;
      confirmed_count: number;
      confirmed_addon_ids: string[];
      confirmed_at: string;
    }
  | {
      ok: false;
      error: 'invalid_token' | 'invalid_input' | 'booking_not_found' | 'rpc_failed';
    };

export async function confirmCheckoutPrep(input: {
  token: string;
}): Promise<ConfirmCheckoutPrepActionResult> {
  const parsed = customerConfirmCheckoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  const validation = await validateCustomerToken(parsed.data.token);
  if (!validation.ok) {
    return { ok: false, error: 'invalid_token' };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('confirm_checkout_prep', {
    p_booking_id: validation.booking_id,
  });

  if (error) {
    console.error('[checkout-prep.confirmCheckoutPrep] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as ConfirmCheckoutPrepResult;
  revalidatePath('/booking/[token]/checkout-prep', 'page');
  if (result.ok) {
    return {
      ok: true,
      confirmed_count: result.confirmed_count,
      confirmed_addon_ids: result.confirmed_addon_ids,
      confirmed_at: result.confirmed_at,
    };
  }
  return { ok: false, error: result.error };
}
