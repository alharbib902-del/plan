/**
 * Phase 7 PR 2d — public-side queries for the Empty Legs
 * marketplace.
 *
 * Server-side ONLY (uses the admin Supabase client). The
 * public marketplace pages run as server components on
 * Vercel; they read through this module rather than
 * exposing a direct anon REST query so we keep
 * sort/filter/pagination behavior consistent with the
 * spec (most-urgent-first by `auction_window_end_at ASC`).
 *
 * Even though `createAdminClient()` would let us see every
 * row, every public query here scopes to
 * `status = 'available'` so the page output mirrors what
 * an anon REST call would see (the RLS policy
 * `empty_legs_public_available` permits SELECT only when
 * `status = 'available'` — Probe 8 verified that already).
 */

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { sanitizeDepartureFilter } from '@/lib/empty-legs/sanitize-departure';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

const TABLE = 'empty_legs';

export interface PublicListFilters {
  /** ISO IATA code or freeform departure label (case-sensitive prefix match). */
  departure?: string | null;
  /** Inclusive minimum capacity. */
  minPassengers?: number | null;
  /** Inclusive maximum price (current_price). */
  maxPrice?: number | null;
}

// No noStore() here on purpose: the home page renders this via ISR
// (revalidate = 60). Every other caller is force-dynamic, so it still
// reads fresh rows on each request there.
export async function listPublicAvailableLegs(
  params: PublicListFilters & { limit?: number } = {}
): Promise<EmptyLegRow[]> {
  const { departure, minPassengers, maxPrice, limit = 50 } = params;
  const client = createAdminClient();

  // Explicit columns (= today's EmptyLegRow, which consumers are typed
  // against) so a column added later never rides this hot public path
  // by default; audit:db validates the list against the live schema.
  let query = client
    .from(TABLE)
    .select(
      'id, leg_number, parent_booking_id, operator_id, operator_name_snapshot, operator_phone_snapshot, operator_email_snapshot, operator_stub_id, aircraft_id, aircraft_snapshot, departure_airport, arrival_airport, departure_airport_freeform_snapshot, arrival_airport_freeform_snapshot, departure_window_start, departure_window_end, flexibility_hours, original_price, current_discount_pct, current_price, max_passengers, status, views_count, notifications_sent, reservation_token_hash, reservation_expires_at, reservation_customer_name_snapshot, reservation_customer_phone_snapshot, reservation_client_id, customer_booking_id, auction_initial_discount_pct, auction_floor_discount_pct, auction_curve, auction_window_start_at, auction_window_end_at, last_price_drop_at, suppress_notifications, created_at, expires_at, updated_at'
    )
    .eq('status', 'available')
    // Most-urgent-first per §7.5 — auctions closing soonest
    // surface at the top.
    .order('auction_window_end_at', { ascending: true })
    .limit(limit);

  if (typeof minPassengers === 'number' && Number.isFinite(minPassengers)) {
    query = query.gte('max_passengers', minPassengers);
  }
  if (typeof maxPrice === 'number' && Number.isFinite(maxPrice)) {
    query = query.lte('current_price', maxPrice);
  }
  if (departure) {
    // Strip PostgREST `.or()` metacharacters before interpolation — the
    // value is caller-supplied from public surfaces and supabase-js does
    // not escape `.or(...)` (filter-injection guard). See sanitize-departure.
    const sanitized = sanitizeDepartureFilter(departure);
    if (sanitized.length > 0) {
      const needle = sanitized.toUpperCase();
      // Match either IATA exact or freeform prefix.
      query = query.or(
        `departure_airport.eq.${needle},departure_airport_freeform_snapshot.ilike.${needle}%`
      );
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error('[empty-legs.public] listPublicAvailableLegs failed', error);
    throw new Error(`listPublicAvailableLegs failed: ${error.message}`);
  }
  return (data ?? []) as EmptyLegRow[];
}

/**
 * Reads a leg by its human-readable `EL-XXXX` number, but
 * ONLY when the row is in a public-visible state. Mirrors
 * the RLS policy `empty_legs_public_available` (status =
 * 'available') AND additionally surfaces 'reserved' rows
 * to the post-reservation page (the customer's own row,
 * looked up via leg_number + still within the 10-min hold)
 * AND surfaces terminal states ('sold', 'expired') so a
 * stale shareable link still renders a meaningful page
 * instead of a 404 (Codex round-1 P2 #1 fix on PR 2d).
 *
 * The caller decides which states are acceptable; the
 * default keeps anon-equivalent behavior.
 */
export async function getPublicLegByNumber(
  legNumber: string,
  opts: {
    allowedStatuses?: ('available' | 'reserved' | 'sold' | 'expired')[];
  } = {}
): Promise<EmptyLegRow | null> {
  noStore();
  const allowed = opts.allowedStatuses ?? ['available'];
  if (!legNumber || legNumber.trim().length === 0) return null;

  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select(
      'id, leg_number, parent_booking_id, operator_id, operator_name_snapshot, operator_phone_snapshot, operator_email_snapshot, operator_stub_id, aircraft_id, aircraft_snapshot, departure_airport, arrival_airport, departure_airport_freeform_snapshot, arrival_airport_freeform_snapshot, departure_window_start, departure_window_end, flexibility_hours, original_price, current_discount_pct, current_price, max_passengers, status, views_count, notifications_sent, reservation_token_hash, reservation_expires_at, reservation_customer_name_snapshot, reservation_customer_phone_snapshot, reservation_client_id, customer_booking_id, auction_initial_discount_pct, auction_floor_discount_pct, auction_curve, auction_window_start_at, auction_window_end_at, last_price_drop_at, suppress_notifications, created_at, expires_at, updated_at'
    )
    .eq('leg_number', legNumber.trim())
    .in('status', allowed)
    .maybeSingle();

  if (error) {
    console.error('[empty-legs.public] getPublicLegByNumber failed', error);
    throw new Error(`getPublicLegByNumber failed: ${error.message}`);
  }
  return (data as EmptyLegRow | null) ?? null;
}

/**
 * Distinct departure airports (IATA + freeform snapshot)
 * across `available` rows. Used to build the filter chips
 * on the list page.
 */
export async function listDistinctDepartures(): Promise<string[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select(
      'departure_airport, departure_airport_freeform_snapshot'
    )
    .eq('status', 'available')
    .order('auction_window_end_at', { ascending: true })
    .limit(200);

  if (error) {
    console.error('[empty-legs.public] listDistinctDepartures failed', error);
    throw new Error(`listDistinctDepartures failed: ${error.message}`);
  }

  const out = new Set<string>();
  for (const row of (data ?? []) as {
    departure_airport: string | null;
    departure_airport_freeform_snapshot: string | null;
  }[]) {
    const label =
      row.departure_airport ??
      row.departure_airport_freeform_snapshot ??
      null;
    if (label && label.trim().length > 0) out.add(label.trim());
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b, 'ar'));
}
