import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 14 — operator fleet reads.
 *
 * `aircraft` has RLS deny-all (no policies); all access is via SECURITY
 * DEFINER RPCs. We read the operator's own aircraft through
 * `list_operator_aircraft(p_operator_id)` — scoped by the session-derived
 * operator id at the call site. Not in `types/database.ts`, so a loose
 * accessor (Phase 8 PR 2e inference lesson).
 */

export type OperatorAircraftStatus = 'active' | 'maintenance' | 'retired';
export type OperatorAircraftCategory =
  | 'light'
  | 'mid'
  | 'super_mid'
  | 'heavy'
  | 'long_range';

export type OperatorAircraftRow = {
  id: string;
  registration: string;
  manufacturer: string;
  model: string;
  category: OperatorAircraftCategory;
  year: number | null;
  max_passengers: number;
  max_range_km: number | null;
  base_hourly_rate: number;
  is_cargo_capable: boolean;
  is_medevac_capable: boolean;
  status: OperatorAircraftStatus;
  created_at: string;
};

type RawAircraftRow = Omit<
  OperatorAircraftRow,
  'base_hourly_rate' | 'year' | 'max_range_km'
> & {
  base_hourly_rate: number | string;
  year: number | string | null;
  max_range_km: number | string | null;
};

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function listOperatorAircraft(
  operatorId: string
): Promise<OperatorAircraftRow[]> {
  const client = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await client.rpc('list_operator_aircraft', {
    p_operator_id: operatorId,
  });
  if (error) {
    throw new Error(`listOperatorAircraft failed: ${error.message}`);
  }
  const rows = (data ?? []) as RawAircraftRow[];
  return rows.map((r) => ({
    ...r,
    base_hourly_rate: Number(r.base_hourly_rate),
    year: r.year == null ? null : Number(r.year),
    max_range_km: r.max_range_km == null ? null : Number(r.max_range_km),
  }));
}
