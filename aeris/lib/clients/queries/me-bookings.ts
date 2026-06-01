import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type { BookingRow } from '@/types/database';

/**
 * Phase 9 PR 3 — read helpers for the client `/me/bookings` +
 * `/me/bookings/[id]` surfaces.
 *
 * Same service-role + application-level ownership discipline
 * as me-requests.ts: callers MUST pass `session.client_id` from
 * `requireClientSession()`. The `client_id IS NULL` rows
 * (legacy bookings whose pointer was cleared in PR 2's
 * inline backfill) are intentionally excluded — those rows
 * still survive for ZATCA / admin audit but should never
 * appear on a client's own list.
 */

export async function listBookingsForClient(
  clientId: string
): Promise<BookingRow[]> {
  noStore();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('bookings')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[me-bookings.list] read failed', error);
    throw new Error(`listBookingsForClient failed: ${error.message}`);
  }
  return (data ?? []) as BookingRow[];
}

export async function getBookingForClient(
  clientId: string,
  bookingId: string
): Promise<BookingRow | null> {
  noStore();

  // Codex round 1 PR #57 P2 #1 fix — same short-circuit as
  // me-requests.getTripRequestForClient. A malformed
  // /me/bookings/<id> route would otherwise 500 because
  // PostgREST throws on the UUID comparison.
  if (!isUuid(bookingId)) return null;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (error) {
    console.error('[me-bookings.detail] read failed', error);
    throw new Error(`getBookingForClient failed: ${error.message}`);
  }
  return (data ?? null) as BookingRow | null;
}

/**
 * Phase payments PR #120 — the checkout id of the single ACTIVE (initiated)
 * payment attempt for a booking, if one exists. Used to offer a "refresh
 * payment status" re-confirm on the booking page when a client paid but
 * abandoned before the gateway redirect (the webhook verifier is deferred, so
 * the server-side status lookup is the only confirmation path). At most one row
 * exists per booking (uq_payments_one_initiated_per_booking). `payments` is not
 * in the hand-maintained Database type → loose service-role read; the caller
 * has already asserted booking ownership, and confirmCheckout re-checks it.
 */
export async function getActiveCheckoutForBooking(
  bookingId: string
): Promise<string | null> {
  noStore();
  if (!isUuid(bookingId)) return null;

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from('payments')
    .select('checkout_id')
    .eq('booking_id', bookingId)
    .eq('status', 'initiated')
    .not('checkout_id', 'is', null)
    .maybeSingle();

  if (error) {
    console.error('[me-bookings.activeCheckout] read failed', error);
    return null;
  }
  return (data as { checkout_id: string | null } | null)?.checkout_id ?? null;
}

/**
 * Phase payments PR #121 — does an ACTIVE (initiated) payment attempt exist for
 * this booking? Once one does, the booking's cashback redemption is frozen
 * (redeem_cashback_for_booking rejects with booking_has_active_payment and
 * create_payment_attempt reuses the existing attempt), so the checkout page
 * must lock the redeem input rather than preview a net that won't apply. At
 * most one such row exists (uq_payments_one_initiated_per_booking).
 */
export async function bookingHasActivePaymentAttempt(
  bookingId: string
): Promise<boolean> {
  noStore();
  if (!isUuid(bookingId)) return false;

  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from('payments')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('status', 'initiated')
    .maybeSingle();

  if (error) {
    console.error('[me-bookings.hasActiveAttempt] read failed', error);
    return false;
  }
  return data != null;
}
