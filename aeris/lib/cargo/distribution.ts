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

export type CargoDispatchOutcome =
  | CargoDispatchResult
  | { ok: false; error: 'request_not_actionable' };

// Loose-cast pattern (PR 1 convention): cargo_dispatch_events_outbox
// is added by the PR 3 migration but not yet registered in
// types/database.ts.
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
};

// Re-export classifyCandidates for testability + admin use.
export { classifyCandidates, type CargoCandidate } from './scoring';

export async function dispatchCargoRequest(
  input: CargoDispatchInput
): Promise<CargoDispatchOutcome> {
  const admin = createAdminClient() as unknown as LooseClient;

  // 1. Load cargo_request (skip if status no longer actionable)
  const { data: requestRaw, error: requestError } = await admin
    .from('cargo_requests')
    .select('*')
    .eq('id', input.cargo_request_id)
    .maybeSingle();

  if (requestError) {
    console.error('[cargo.distribution] cargo_request read failed', requestError);
    return { ok: false, error: 'request_not_actionable' };
  }
  if (!requestRaw) {
    return { ok: false, error: 'request_not_actionable' };
  }
  const request = requestRaw as CargoRequestRow;
  if (request.status !== 'pending' && request.status !== 'offers_received') {
    return { ok: false, error: 'request_not_actionable' };
  }

  // 2. Enumerate approved operators + per-row has_capability +
  //    last_dispatched_at + rating.
  const candidates = await loadCandidates(admin, request.cargo_type);

  // 3. Classify (pure)
  const classified = classifyCandidates(candidates);

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

async function loadCandidates(
  admin: LooseClient,
  cargoType: CargoType
): Promise<CargoCandidate[]> {
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
    return [];
  }

  interface OpRow {
    id?: string;
    company_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
  }
  const operators = (opData ?? []) as OpRow[];
  if (operators.length === 0) return [];

  // Step b — aircraft (active, with operator_id)
  const { data: aircraftData, error: aircraftError } = await adminTyped
    .from('aircraft')
    .select('id, operator_id')
    .eq('status', 'active');

  if (aircraftError) {
    console.error('[cargo.distribution] aircraft read failed', aircraftError);
    return operators.map((op) => ({
      operator_id: op.id ?? '',
      contact_email: op.contact_email ?? null,
      contact_phone: op.contact_phone ?? null,
      company_name: op.company_name ?? '',
      has_capability: false,
      last_dispatched_at: null,
      rating: null,
    }));
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
    } else {
      type CapRow = Record<string, unknown>;
      for (const c of (capData ?? []) as CapRow[]) {
        if (c[supportsCol] === true && typeof c.aircraft_id === 'string') {
          capableAircraftIds.add(c.aircraft_id);
        }
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

  return operators.map((op) => ({
    operator_id: op.id ?? '',
    contact_email: op.contact_email ?? null,
    contact_phone: op.contact_phone ?? null,
    company_name: op.company_name ?? '',
    has_capability: opHasCapability.get(op.id ?? '') === true,
    last_dispatched_at: null,
    rating: null,
  }));
}
