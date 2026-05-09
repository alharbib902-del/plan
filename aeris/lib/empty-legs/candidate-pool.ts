// Server-side ONLY — same rationale as matching.ts.
import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 7 PR 2e — candidate-pool reader for the matching
 * engine.
 *
 * Reads `lead_inquiries` rows that are eligible for an
 * empty-legs notification. Eligibility:
 *
 *   1. `empty_legs_opt_in = TRUE` — explicit consent. The
 *      column defaults to FALSE on every new lead; the
 *      `/request` form + `/empty-legs/<>/reserve` form ship
 *      the checkbox UNCHECKED (Codex iteration-1 P1 #1).
 *
 *   2. `created_at >= NOW() − INTERVAL '90 days'` — Codex
 *      iteration-3 P2 #2 fix. Risk R3 promised a 90-day
 *      cutoff in its mitigation but the prior canonical
 *      query missed it. Without this filter, dormant leads
 *      from > 90 days ago would receive cold WhatsApp
 *      outreach and damage founder/operator credibility.
 *
 *   3. `last_empty_leg_notified_at IS NULL OR
 *       last_empty_leg_notified_at < NOW() − INTERVAL '24 hours'`
 *      — atomic 24h rate cap maintained by the AFTER INSERT
 *      trigger from PR 1 §17 (the trigger updates the
 *      column to `NEW.sent_at` whenever a row lands in
 *      `empty_leg_notifications`). The `frequency-cap.ts`
 *      reader is the second line of defense.
 *
 * The matcher then scores each candidate against the leg
 * via `lib/empty-legs/score-weights.ts`, applies
 * `frequency-cap.ts::shouldSkipCandidate` to drop
 * candidates already notified on this leg, and takes the
 * top 50.
 *
 * Selected columns mirror the spec (Codex iteration-2
 * P1 #2 fix — `customer_email` was removed because the
 * email channel was dropped; the matcher reads only
 * columns that actually exist on the table).
 */

const TABLE = 'lead_inquiries';

export interface CandidateRow {
  id: string;
  customer_name: string | null;
  customer_phone: string;
  origin: string | null;
  destination: string | null;
  origin_iata: string | null;
  destination_iata: string | null;
  departure_date: string | null;
  return_date: string | null;
  passengers: number;
  last_empty_leg_notified_at: string | null;
  empty_legs_opt_in: boolean;
}

export async function listEligibleCandidates(
  limit = 1000
): Promise<CandidateRow[]> {
  noStore();
  const client = createAdminClient();
  const cutoff90d = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000
  ).toISOString();
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from(TABLE)
    .select(
      'id, customer_name, customer_phone, origin, destination, origin_iata, destination_iata, departure_date, return_date, passengers, last_empty_leg_notified_at, empty_legs_opt_in'
    )
    .eq('empty_legs_opt_in', true)
    .gte('created_at', cutoff90d)
    .or(
      `last_empty_leg_notified_at.is.null,last_empty_leg_notified_at.lt.${cutoff24h}`
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[candidate-pool] list failed', error);
    throw new Error(`listEligibleCandidates failed: ${error.message}`);
  }

  // Defensive normalize: customer_phone is NOT NULL in the
  // schema but the row is typed loosely above. Drop any row
  // whose phone is empty — dialing an empty wa.me URL is
  // worse than skipping the candidate.
  interface RawRow {
    id?: string;
    customer_name?: string | null;
    customer_phone?: string | null;
    origin?: string | null;
    destination?: string | null;
    origin_iata?: string | null;
    destination_iata?: string | null;
    departure_date?: string | null;
    return_date?: string | null;
    passengers?: number | null;
    last_empty_leg_notified_at?: string | null;
    empty_legs_opt_in?: boolean | null;
  }
  const rows = (data ?? []) as RawRow[];
  const out: CandidateRow[] = [];
  for (const r of rows) {
    if (typeof r.id !== 'string' || r.id.length === 0) continue;
    const phone = typeof r.customer_phone === 'string' ? r.customer_phone : '';
    if (phone.trim().length === 0) continue;
    out.push({
      id: r.id,
      customer_name: r.customer_name ?? null,
      customer_phone: phone,
      origin: r.origin ?? null,
      destination: r.destination ?? null,
      origin_iata: r.origin_iata ?? null,
      destination_iata: r.destination_iata ?? null,
      departure_date: r.departure_date ?? null,
      return_date: r.return_date ?? null,
      passengers: typeof r.passengers === 'number' ? r.passengers : 1,
      last_empty_leg_notified_at: r.last_empty_leg_notified_at ?? null,
      empty_legs_opt_in: r.empty_legs_opt_in ?? false,
    });
  }
  return out;
}
