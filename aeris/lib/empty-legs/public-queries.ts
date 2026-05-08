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

export async function listPublicAvailableLegs(
  params: PublicListFilters & { limit?: number } = {}
): Promise<EmptyLegRow[]> {
  noStore();
  const { departure, minPassengers, maxPrice, limit = 50 } = params;
  const client = createAdminClient();

  let query = client
    .from(TABLE)
    .select('*')
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
  if (departure && departure.trim().length > 0) {
    const trimmed = departure.trim().toUpperCase();
    // Match either IATA exact or freeform prefix.
    query = query.or(
      `departure_airport.eq.${trimmed},departure_airport_freeform_snapshot.ilike.${trimmed}%`
    );
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
 * looked up via leg_number + still within the 10-min hold).
 *
 * The caller decides which states are acceptable; the
 * default keeps anon-equivalent behavior.
 */
export async function getPublicLegByNumber(
  legNumber: string,
  opts: { allowedStatuses?: ('available' | 'reserved' | 'sold')[] } = {}
): Promise<EmptyLegRow | null> {
  noStore();
  const allowed = opts.allowedStatuses ?? ['available'];
  if (!legNumber || legNumber.trim().length === 0) return null;

  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
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
