import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type { BookingAddonRow, BookingRow } from '@/types/database';

const BOOKINGS_TABLE = 'bookings';
const BOOKING_ADDONS_TABLE = 'booking_addons';

/**
 * Phase 6.2 PR 2b: read helpers for bookings + booking_addons.
 *
 * Every booking-state mutation goes through PR 2a's SECURITY
 * DEFINER RPCs (attach / customer_cancel / admin_cancel /
 * update_quantity / confirm / backfill / accept_offer). This
 * module is read-only — no INSERT / UPDATE / DELETE.
 *
 * RLS on `bookings` and `booking_addons` is deny-all from
 * the initial schema. Reads go through `createAdminClient()`
 * (service role) — same pattern as every other Phase 4/5/6
 * read helper.
 */

// ============================================================================
// Booking lookups
// ============================================================================

/**
 * Look up a single bookings row by its trip_request_id. The
 * partial unique index `bookings_trip_request_unique` (PR 1
 * File A step 11) guarantees at most one row per trip; this
 * function returns `null` when no row exists.
 *
 * The admin add-ons page (S4 / S4.1) uses this to detect
 * Case B vs Case C for a given trip:
 *   - Returns a row → Case B (post-PR-2a accept).
 *   - Returns null  → Case C (legacy booked, needs backfill).
 */
export async function getBookingByTripId(
  tripId: string
): Promise<BookingRow | null> {
  noStore();
  const client = createAdminClient();

  const { data, error } = await client
    .from(BOOKINGS_TABLE)
    .select('*')
    .eq('trip_request_id', tripId)
    .maybeSingle();

  if (error) {
    console.error('[bookings.getBookingByTripId]', error);
    throw new Error(`getBookingByTripId failed: ${error.message}`);
  }

  return data ?? null;
}

/**
 * Look up a single bookings row by its UUID. Used by the
 * customer checkout-prep page after the v=2 token's
 * payload.booking_id has been verified.
 */
export async function getBookingById(
  bookingId: string
): Promise<BookingRow | null> {
  noStore();
  const client = createAdminClient();

  const { data, error } = await client
    .from(BOOKINGS_TABLE)
    .select('*')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) {
    console.error('[bookings.getBookingById]', error);
    throw new Error(`getBookingById failed: ${error.message}`);
  }

  return data ?? null;
}

// ============================================================================
// Booking add-ons lookups
// ============================================================================

/**
 * List every booking_addons row attached to a booking,
 * ordered by created_at ascending so the UI renders them
 * in attach order. Includes cancelled rows (the customer
 * checkout-prep + admin trip page both display them, just
 * styled differently); the caller filters by status if
 * they want only active rows.
 */
export async function listBookingAddons(
  bookingId: string
): Promise<BookingAddonRow[]> {
  noStore();
  const client = createAdminClient();

  const { data, error } = await client
    .from(BOOKING_ADDONS_TABLE)
    .select('*')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[bookings.listBookingAddons]', error);
    throw new Error(`listBookingAddons failed: ${error.message}`);
  }

  return data ?? [];
}

// ============================================================================
// Trip + booking state for the admin add-ons gate
// ============================================================================

/**
 * Spec S4.1 — 3-case gate. Resolves the (trip status,
 * bookings row presence) pair into a single discriminator
 * the admin add-ons page can switch on without further
 * logic in the JSX:
 *
 *   - 'pre_accept'      → Case A: trip is pending /
 *                         distributed / offered. No add-ons
 *                         possible. Page renders disabled
 *                         tab with the "بعد قبول العرض..."
 *                         copy.
 *
 *   - 'booked_no_record'→ Case C: trip status is 'booked'
 *                         but no bookings row exists (legacy
 *                         pre-PR-2a accept). Page renders
 *                         the "إنشاء سجل الحجز" button.
 *
 *   - 'booked_with_record' → Case B: trip status is 'booked'
 *                         AND a bookings row exists. Page
 *                         renders the catalog + attached
 *                         rows + suggestion banner.
 *
 *   - 'closed'          → trip is cancelled. Read-only.
 *
 * The discriminator name is also used by the admin Server
 * Action (`attachAddon` etc.) to short-circuit when the
 * trip is not in Case B.
 */
export type AddonsGateCase =
  | 'pre_accept'
  | 'booked_no_record'
  | 'booked_with_record'
  | 'closed';

export function resolveAddonsGate(
  tripStatus: string,
  booking: BookingRow | null
): AddonsGateCase {
  if (tripStatus === 'cancelled') return 'closed';
  if (tripStatus === 'booked') {
    return booking ? 'booked_with_record' : 'booked_no_record';
  }
  // pending / distributed / offered → pre-accept.
  return 'pre_accept';
}
