import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type {
  MedevacRequestRow,
  MedevacServiceLevel,
} from '@/lib/medevac/types';

import {
  classifyCandidates,
  type MedevacCandidate,
  type MedevacDispatchOperator,
  type MedevacDispatchSkipReason,
} from './scoring';

/**
 * Phase 12 PR 3 §3 — medevac distribution engine (DB-backed).
 *
 * Loads medevac_request + enumerates approved operators with
 * their has_capability (medical-cert match for the requested
 * service_level + cert-expiry > NOW()) + last_dispatched_at +
 * rating, then delegates to the pure `classifyCandidates`
 * helper in `./scoring.ts`. Mirrors Phase 11 cargo
 * `lib/cargo/distribution.ts` exactly; only the capability
 * source changes (cargo_aircraft_capabilities →
 * aircraft_medical_certifications + cert expiry filter).
 *
 * Per spec D7 + D11: distribution filters by cert AND
 * `certification_expires_at > NOW()` as a belt-and-suspenders
 * check on top of the §4.3 RPC cert-expiry gate.
 */

export type {
  MedevacDispatchSkipReason,
  MedevacDispatchOperator,
} from './scoring';

export interface MedevacDispatchInput {
  medevac_request_id: string;
  event_type: 'initial' | 'manual_redispatch';
}

export interface MedevacDispatchResult {
  ok: true;
  medevac_request: MedevacRequestRow;
  dispatched: MedevacDispatchOperator[];
  skipped_operator_ids: string[];
  skip_reasons: Record<string, MedevacDispatchSkipReason>;
}

export type MedevacDispatchOutcome =
  | MedevacDispatchResult
  | { ok: false; error: 'request_not_actionable' }
  | { ok: false; error: 'retryable_failure'; reason: string };

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
      in: (
        col: string,
        vals: string[]
      ) => Promise<{
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

export { classifyCandidates, type MedevacCandidate } from './scoring';

export async function dispatchMedevacRequest(
  input: MedevacDispatchInput
): Promise<MedevacDispatchOutcome> {
  const admin = createAdminClient() as unknown as LooseClient;

  // 1. Load medevac_request.
  const { data: requestRaw, error: requestError } = await admin
    .from('medevac_requests')
    .select('*')
    .eq('id', input.medevac_request_id)
    .maybeSingle();

  if (requestError) {
    console.error(
      '[medevac.distribution] medevac_requests read failed',
      requestError
    );
    return {
      ok: false,
      error: 'retryable_failure',
      reason: `medevac_requests read: ${requestError.message ?? 'unknown'}`,
    };
  }
  if (!requestRaw) {
    return { ok: false, error: 'request_not_actionable' };
  }
  const request = requestRaw as MedevacRequestRow;
  if (
    request.status !== 'pending' &&
    request.status !== 'offers_received'
  ) {
    return { ok: false, error: 'request_not_actionable' };
  }
  // Covered events skip distribution entirely (the trigger
  // already filters them out; this is belt-and-suspenders
  // for manual_redispatch on a covered row).
  if (request.is_covered) {
    return { ok: false, error: 'request_not_actionable' };
  }

  // 2. Enumerate candidates.
  const candidatesOutcome = await loadCandidates(
    admin,
    request.service_level
  );
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
    medevac_request: request,
    dispatched: classified.dispatched,
    skipped_operator_ids: classified.skipped_operator_ids,
    skip_reasons: classified.skip_reasons,
  };
}

// ============================================================
// loadCandidates — internal DB helper
// ============================================================

type LoadCandidatesOutcome =
  | { ok: true; candidates: MedevacCandidate[] }
  | { ok: false; reason: string };

async function loadCandidates(
  admin: LooseClient,
  serviceLevel: MedevacServiceLevel
): Promise<LoadCandidatesOutcome> {
  // Step a — all approved operators
  const { data: opData, error: opError } = await admin
    .from('operators')
    .select('id, company_name, contact_email, contact_phone')
    .eq('signup_status', 'approved');

  if (opError) {
    console.error('[medevac.distribution] operators read failed', opError);
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
    return { ok: true, candidates: [] };
  }

  // Step b — aircraft (active, with operator_id)
  const { data: aircraftData, error: aircraftError } = await admin
    .from('aircraft')
    .select('id, operator_id')
    .eq('status', 'active');

  if (aircraftError) {
    console.error(
      '[medevac.distribution] aircraft read failed',
      aircraftError
    );
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

  // Step c — medical cert filter for the requested service_level.
  // Cert column is lowercase (Round 3 PR #76 P1 #1 fix): supports_bmt etc.
  // ALSO filter by certification_expires_at > NOW() per D11.
  const supportsCol =
    serviceLevel === 'BMT'
      ? 'supports_bmt'
      : serviceLevel === 'ALS'
        ? 'supports_als'
        : serviceLevel === 'CCT'
          ? 'supports_cct'
          : 'supports_repatriation';

  const capableAircraftIds = new Set<string>();
  if (aircraftIds.length > 0) {
    const { data: capData, error: capError } = await admin
      .from('aircraft_medical_certifications')
      .select(`aircraft_id, ${supportsCol}, certification_expires_at`)
      .in('aircraft_id', aircraftIds);
    if (capError) {
      console.error(
        '[medevac.distribution] medical certs read failed',
        capError
      );
      return {
        ok: false,
        reason: `aircraft_medical_certifications read: ${capError.message ?? 'unknown'}`,
      };
    }
    type CapRow = Record<string, unknown>;
    const nowMs = Date.now();
    for (const c of (capData ?? []) as CapRow[]) {
      if (typeof c.aircraft_id !== 'string') continue;
      if (c[supportsCol] !== true) continue;
      const expiry =
        typeof c.certification_expires_at === 'string'
          ? Date.parse(c.certification_expires_at)
          : NaN;
      if (!Number.isFinite(expiry) || expiry <= nowMs) continue;
      capableAircraftIds.add(c.aircraft_id);
    }
  }

  // Map operator → has_capability
  const opHasCapability = new Map<string, boolean>();
  for (const a of aircraft) {
    if (a.operator_id && a.id && capableAircraftIds.has(a.id)) {
      opHasCapability.set(a.operator_id, true);
    }
  }

  // Step d — per-operator last_dispatched_at via the RPC.
  const operatorIds = operators
    .map((op) => op.id)
    .filter((id): id is string => typeof id === 'string');
  const lastDispatchedMap = new Map<string, string | null>();
  if (operatorIds.length > 0) {
    const { data: lastData, error: lastError } = await admin.rpc(
      'medevac_operator_last_dispatch_map',
      { p_operator_ids: operatorIds }
    );
    if (lastError) {
      console.error(
        '[medevac.distribution] last_dispatched_at RPC failed',
        lastError
      );
      return {
        ok: false,
        reason: `medevac_operator_last_dispatch_map: ${lastError.message ?? 'unknown'}`,
      };
    }
    interface LastDispatchRow {
      operator_id?: string;
      last_dispatched_at?: string | null;
    }
    for (const row of (lastData ?? []) as LastDispatchRow[]) {
      if (row.operator_id) {
        lastDispatchedMap.set(
          row.operator_id,
          row.last_dispatched_at ?? null
        );
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
