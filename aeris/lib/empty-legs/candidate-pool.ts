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

// ============================================================
// Phase 10 PR 1 — client candidate pool
//
// Sibling reader for the §4.2 client-loop. Reads `clients`
// rows that are eligible for a Phase 10 empty-leg notification.
// Eligibility (looser than the lead path because Phase 10
// gives authenticated clients first-class status):
//
//   1. `signup_status = 'active'` — suspended/deleted clients
//      never receive Phase 10 outreach.
//
//   2. The matcher applies the per-channel opt-in check
//      (§3.3 isClientOptedIn) AT MATCHING TIME via
//      lib/clients/notification-preferences.ts. The candidate
//      pool returns ALL active clients; the matcher filters
//      out opted-out clients into MatchOutcome.matched
//      .clients_skipped_preferences (Decision §4.2 step 3
//      + round 6 P2 #3).
//
//   3. Per-client signal sources (Decision #13) come from
//      the latest non-cancelled `trip_requests` row keyed on
//      `client_id = client.id`. NULL handling per Decision #13:
//      - origin_iata / destination_iata NULL → no geo signal
//      - passengers NULL → defaults to 2 (median family size)
//      - departure_date NULL → wide window (no time score)
//      - route_pairs derived from full trip_requests history
//        (used by route-affinity factor; not in CandidateRow
//        because the existing scorer doesn't read it directly)
//
// The matcher then scores each candidate against the leg via
// `scoreCandidateAgainstLeg` (signal substitutions per
// Decision #13), applies `frequency-cap.ts::shouldSkipClientCandidate`
// to drop clients already notified on this leg, takes the top N.
// ============================================================

const CLIENTS_TABLE = 'clients';
const TRIP_REQUESTS_TABLE = 'trip_requests';

export interface ClientCandidateRow extends CandidateRow {
  /** Client UUID — alias of `id` for caller clarity. */
  client_id: string;
  /** Per-client opt-in JSONB — read at matching time by
   *  `lib/clients/notification-preferences.ts::isClientOptedIn`. */
  notification_preferences: Record<string, unknown> | null;
  /**
   * Phase 13 PR 3 — D13 tier-boost signal. Populated from the
   * clients.privilege_tier column added by PR 1. NULL if the
   * client predates the PR 1 backfill (extremely unlikely
   * because PR 1's `applyPrivilegeBackfill` sets every existing
   * row to 'silver'). Tier-boost decision falls back to silver
   * for NULL so the gating still works.
   */
  privilege_tier:
    | 'silver'
    | 'gold'
    | 'platinum'
    | 'diamond'
    | null;
}

interface RawClientRow {
  id?: string;
  full_name?: string | null;
  contact_phone?: string | null;
  signup_status?: string | null;
  notification_preferences?: Record<string, unknown> | null;
  privilege_tier?: 'silver' | 'gold' | 'platinum' | 'diamond' | null;
}

interface RawTripRequestSignalRow {
  client_id?: string;
  departure_airport?: string | null;
  arrival_airport?: string | null;
  passengers_count?: number | null;
  departure_date?: string | null;
}

export async function listEligibleClientCandidates(
  limit = 1000
): Promise<ClientCandidateRow[]> {
  noStore();
  const client = createAdminClient();

  // 1. Pull all active clients (preferences filtered at matching time).
  // Phase 13 PR 3: include privilege_tier for D13 tier-boost gating
  // in the matching engine. Backward-compatible: the column was
  // added by Phase 13 PR 1 and backfilled to 'silver' for every
  // pre-existing client.
  const { data: clientsData, error: clientsError } = await client
    .from(CLIENTS_TABLE)
    .select(
      'id, full_name, contact_phone, signup_status, notification_preferences, privilege_tier'
    )
    .eq('signup_status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (clientsError) {
    console.error('[candidate-pool] clients list failed', clientsError);
    throw new Error(
      `listEligibleClientCandidates failed (clients): ${clientsError.message}`
    );
  }

  const rows = (clientsData ?? []) as RawClientRow[];
  if (rows.length === 0) return [];

  const clientIds: string[] = [];
  for (const r of rows) {
    if (typeof r.id === 'string' && r.id.length > 0) clientIds.push(r.id);
  }
  if (clientIds.length === 0) return [];

  // 2. For each client, pull the latest non-cancelled trip_request
  //    for signal-source projection (Decision #13). Single query
  //    with a WHERE IN over all client ids; we group + reduce in
  //    memory because the per-client "latest" requires a window
  //    function that's awkward via the query builder.
  const { data: signalData, error: signalError } = await client
    .from(TRIP_REQUESTS_TABLE)
    .select(
      'client_id, departure_airport, arrival_airport, passengers_count, departure_date, created_at'
    )
    .in('client_id', clientIds)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });

  if (signalError) {
    console.error('[candidate-pool] trip_requests read failed', signalError);
    throw new Error(
      `listEligibleClientCandidates failed (signals): ${signalError.message}`
    );
  }

  // Take FIRST occurrence per client_id (the order DESC above
  // means the first hit IS the latest non-cancelled request).
  const signalByClient = new Map<string, RawTripRequestSignalRow>();
  for (const s of (signalData ?? []) as RawTripRequestSignalRow[]) {
    if (typeof s.client_id !== 'string') continue;
    if (signalByClient.has(s.client_id)) continue;
    signalByClient.set(s.client_id, s);
  }

  // 3. Project to ClientCandidateRow shape with NULL handling
  //    per Decision #13.
  const out: ClientCandidateRow[] = [];
  for (const r of rows) {
    if (typeof r.id !== 'string' || r.id.length === 0) continue;
    const phone = typeof r.contact_phone === 'string' ? r.contact_phone : '';
    if (phone.trim().length === 0) continue;

    const signal = signalByClient.get(r.id);

    out.push({
      // CandidateRow fields (mirror of lead shape)
      id: r.id,
      customer_name: r.full_name ?? null,
      customer_phone: phone,
      origin: null, // freeform not used for client signals
      destination: null,
      origin_iata: signal?.departure_airport ?? null,
      destination_iata: signal?.arrival_airport ?? null,
      departure_date: signal?.departure_date ?? null,
      return_date: null, // empty-leg matching only uses departure
      passengers:
        typeof signal?.passengers_count === 'number'
          ? signal.passengers_count
          : 2, // Decision #13: NULL → 2 (median family size)
      last_empty_leg_notified_at: null, // tracked per-client via empty_leg_notifications.client_id
      empty_legs_opt_in: true, // explicit opt-in check happens in matching loop via prefs JSONB
      // Phase 10 ClientCandidateRow extensions
      client_id: r.id,
      notification_preferences: r.notification_preferences ?? null,
      // Phase 13 PR 3 — D13 tier-boost signal
      privilege_tier: r.privilege_tier ?? null,
    });
  }
  return out;
}
