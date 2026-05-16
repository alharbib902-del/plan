import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { CargoRequestRow, CargoType } from '@/lib/cargo/types';

import {
  classifyCandidates,
  type CargoCandidate,
  type CargoDispatchOperator,
  type CargoDispatchSkipReason,
} from './scoring';

/**
 * Phase 11 PR 3 §3 — cargo distribution engine (DB-backed).
 *
 * Loads cargo_request + enumerates approved operators with their
 * has_capability + last_dispatched_at + rating, then delegates
 * to the pure `classifyCandidates` helper in `./scoring.ts`. The
 * pure split keeps the Layer-1 test (`distribution-scoring.test.ts`)
 * runnable under tsx outside Next.js while this file holds the
 * server-only DB I/O.
 *
 * Per Round 1 PR #72 P1 #3 — algorithm enumerates ALL approved
 * operators and classifies them into dispatched | skipped with
 * explicit reason. Probe 32 verifies the non-capable operator
 * appears in skip_reasons['no_capability'].
 *
 * Per Round 3 PR #72 P2 #2 — recency uses processed_at on
 * cargo_dispatch_events_outbox (when the operator last RECEIVED
 * a dispatch); the row is identified via the jsonb `?` operator
 * on dispatch_result.dispatched_operator_ids.
 */

export type {
  CargoDispatchSkipReason,
  CargoDispatchOperator,
} from './scoring';

export interface CargoDispatchInput {
  cargo_request_id: string;
  event_type: 'initial' | 'manual_redispatch';
}

export interface CargoDispatchResult {
  ok: true;
  cargo_request: CargoRequestRow;
  dispatched: CargoDispatchOperator[];
  skipped_operator_ids: string[];
  skip_reasons: Record<string, CargoDispatchSkipReason>;
}

/**
 * Outcome envelope (Round 1 PR #73 P1 #2 fix).
 *
 * Distinguishes two failure modes so the cron route can choose
 * between mark-processed (permanent abort) vs leave-unclaimed
 * (transient — let the next 15-min tick retry):
 *
 *   - 'request_not_actionable' = cargo_request deleted/cancelled
 *     between trigger and drain. PERMANENT — mark processed with
 *     `dispatch_result.error = 'request_not_actionable'`.
 *
 *   - 'retryable_failure' = infrastructure failure (operators
 *     read, aircraft read, capability read, or last-dispatch RPC
 *     errored). DO NOT mark processed; the row stays claimed
 *     for 5 minutes (the lease) then becomes reclaimable by the
 *     next cron run.
 */
export type CargoDispatchOutcome =
  | CargoDispatchResult
  | { ok: false; error: 'request_not_actionable' }
  | { ok: false; error: 'retryable_failure'; reason: string };

// Loose-cast pattern (PR 1 convention): cargo_dispatch_events_outbox
// + cargo_operator_last_dispatch_map RPC are added by the PR 3
// migration but not yet registered in types/database.ts.
type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: unknown
      ) => {
        maybeSingle: () => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      } & Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
    };
  };
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

// Re-export classifyCandidates for testability + admin use.
export { classifyCandidates, type CargoCandidate } from './scoring';

export async function dispatchCargoRequest(
  input: CargoDispatchInput
): Promise<CargoDispatchOutcome> {
  const admin = createAdminClient() as unknown as LooseClient;

  // 1. Load cargo_request.
  // Round 1 PR #73 P1 #2 — distinguish:
  //   - request gone / cancelled (permanent abort)
  //   - read errored (retryable)
  const { data: requestRaw, error: requestError } = await admin
    .from('cargo_requests')
    .select('*')
    .eq('id', input.cargo_request_id)
    .maybeSingle();

  if (requestError) {
    console.error('[cargo.distribution] cargo_request read failed', requestError);
    return {
      ok: false,
      error: 'retryable_failure',
      reason: `cargo_requests read: ${requestError.message ?? 'unknown'}`,
    };
  }
  if (!requestRaw) {
    return { ok: false, error: 'request_not_actionable' };
  }
  const request = requestRaw as CargoRequestRow;
  if (request.status !== 'pending' && request.status !== 'offers_received') {
    return { ok: false, error: 'request_not_actionable' };
  }

  // 2. Enumerate candidates. Returns either the list or a
  //    LoadFailure indicating which read failed.
  const candidatesOutcome = await loadCandidates(admin, request.cargo_type);
  if (!candidatesOutcome.ok) {
    return {
      ok: false,
      error: 'retryable_failure',
      reason: candidatesOutcome.reason,
    };
  }

  // 3. Classify (pure)
  const classified = classifyCandidates(candidatesOutcome.candidates);

  return {
    ok: true,
    cargo_request: request,
    dispatched: classified.dispatched,
    skipped_operator_ids: classified.skipped_operator_ids,
    skip_reasons: classified.skip_reasons,
  };
}

// ============================================================
// loadCandidates — internal DB helper
// ============================================================
//
// Two reads via the JS client (loose-cast):
//   - operators (approved)
//   - aircraft (active, with operator_id)
// + a per-cargo-type capability filter through
//   cargo_aircraft_capabilities.
// last_dispatched_at + rating: v1 returns null for both
// (recencyScore handles null → 1.0 boost; rating null →
// DEFAULT_RATING=3.0 via classifyCandidates). Real timestamps
// + ratings populate in a future iteration once we have
// real dispatch history + Phase 13 rating aggregation.

/**
 * Round 1 PR #73 P1 #2 fix — loadCandidates returns a tagged
 * outcome. Any infrastructure failure surfaces as
 * `{ ok: false, reason }` so the caller propagates it as
 * `retryable_failure` and the cron route LEAVES THE ROW
 * UNPROCESSED (so the next 15-min tick retries). The previous
 * "log + return empty" behavior silently consumed outbox rows
 * on transient DB outages.
 */
type LoadCandidatesOutcome =
  | { ok: true; candidates: CargoCandidate[] }
  | { ok: false; reason: string };

async function loadCandidates(
  admin: LooseClient,
  cargoType: CargoType
): Promise<LoadCandidatesOutcome> {
  const adminTyped = admin as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: unknown
        ) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
        in: (
          col: string,
          vals: string[]
        ) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
  };

  // Step a — all approved operators
  const { data: opData, error: opError } = await adminTyped
    .from('operators')
    .select('id, company_name, contact_email, contact_phone')
    .eq('signup_status', 'approved');

  if (opError) {
    console.error('[cargo.distribution] operators read failed', opError);
    return {
      ok: false,
      reason: `operators read: ${opError.message ?? 'unknown'}`,
    };
  }

  interface OpRow {
    id?: string;
    company_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
  }
  const operators = (opData ?? []) as OpRow[];
  if (operators.length === 0) {
    // Genuinely empty operator pool → success with no candidates.
    // Cron marks processed; the request is "dispatched to 0",
    // which is recoverable via manual_redispatch once operators
    // sign up.
    return { ok: true, candidates: [] };
  }

  // Step b — aircraft (active, with operator_id)
  const { data: aircraftData, error: aircraftError } = await adminTyped
    .from('aircraft')
    .select('id, operator_id')
    .eq('status', 'active');

  if (aircraftError) {
    console.error('[cargo.distribution] aircraft read failed', aircraftError);
    return {
      ok: false,
      reason: `aircraft read: ${aircraftError.message ?? 'unknown'}`,
    };
  }

  interface AircraftRow {
    id?: string;
    operator_id?: string | null;
  }
  const aircraft = (aircraftData ?? []) as AircraftRow[];
  const aircraftIds = aircraft.map((a) => a.id).filter(Boolean) as string[];

  // Step c — capability filter for the cargo_type
  const supportsCol =
    cargoType === 'horse'
      ? 'supports_horse'
      : cargoType === 'luxury_car'
        ? 'supports_luxury_car'
        : cargoType === 'valuables'
          ? 'supports_valuables'
          : 'supports_other';

  const capableAircraftIds = new Set<string>();
  if (aircraftIds.length > 0) {
    const { data: capData, error: capError } = await adminTyped
      .from('cargo_aircraft_capabilities')
      .select(`aircraft_id, ${supportsCol}`)
      .in('aircraft_id', aircraftIds);
    if (capError) {
      console.error('[cargo.distribution] capabilities read failed', capError);
      return {
        ok: false,
        reason: `cargo_aircraft_capabilities read: ${capError.message ?? 'unknown'}`,
      };
    }
    type CapRow = Record<string, unknown>;
    for (const c of (capData ?? []) as CapRow[]) {
      if (c[supportsCol] === true && typeof c.aircraft_id === 'string') {
        capableAircraftIds.add(c.aircraft_id);
      }
    }
  }

  // Map operator → has_capability
  const opHasCapability = new Map<string, boolean>();
  for (const a of aircraft) {
    if (a.operator_id && a.id && capableAircraftIds.has(a.id)) {
      opHasCapability.set(a.operator_id, true);
    }
  }

  // Step d — per-operator last_dispatched_at via the RPC
  // (Round 1 PR #73 P1 #1 fix). Without this, every operator
  // is treated as first-time forever → recently_dispatched
  // never short-circuits → same operators receive every cargo
  // request.
  const operatorIds = operators
    .map((op) => op.id)
    .filter((id): id is string => typeof id === 'string');
  const lastDispatchedMap = new Map<string, string | null>();
  if (operatorIds.length > 0) {
    const { data: lastData, error: lastError } = await admin.rpc(
      'cargo_operator_last_dispatch_map',
      { p_operator_ids: operatorIds }
    );
    if (lastError) {
      console.error(
        '[cargo.distribution] last_dispatched_at RPC failed',
        lastError
      );
      return {
        ok: false,
        reason: `cargo_operator_last_dispatch_map: ${lastError.message ?? 'unknown'}`,
      };
    }
    interface LastDispatchRow {
      operator_id?: string;
      last_dispatched_at?: string | null;
    }
    for (const row of (lastData ?? []) as LastDispatchRow[]) {
      if (row.operator_id) {
        lastDispatchedMap.set(row.operator_id, row.last_dispatched_at ?? null);
      }
    }
  }

  return {
    ok: true,
    candidates: operators.map((op) => ({
      operator_id: op.id ?? '',
      contact_email: op.contact_email ?? null,
      contact_phone: op.contact_phone ?? null,
      company_name: op.company_name ?? '',
      has_capability: opHasCapability.get(op.id ?? '') === true,
      last_dispatched_at: lastDispatchedMap.get(op.id ?? '') ?? null,
      rating: null,
    })),
  };
}
