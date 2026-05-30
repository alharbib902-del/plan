import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 14 — operator crew reads.
 *
 * `crew_members` has RLS deny-all (no policies); all access is via
 * SECURITY DEFINER RPCs. We read the operator's own crew through
 * `list_operator_crew(p_operator_id)` — scoped by the session-derived
 * operator id at the call site. Not in `types/database.ts`, so a loose
 * accessor (Phase 8 PR 2e inference lesson).
 */

export type OperatorCrewRole = 'captain' | 'first_officer' | 'flight_attendant';

export type OperatorCrewRow = {
  id: string;
  full_name: string;
  role: OperatorCrewRole;
  nationality: string | null;
  languages: string[];
  specializations: string[];
  experience_hours: number;
  license_number: string | null;
  license_expiry: string | null;
  extra_fee: number;
  is_available: boolean;
  created_at: string;
};

type RawCrewRow = Omit<
  OperatorCrewRow,
  'languages' | 'specializations' | 'experience_hours' | 'extra_fee'
> & {
  languages: string[] | null;
  specializations: string[] | null;
  experience_hours: number | string | null;
  extra_fee: number | string | null;
};

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function listOperatorCrew(
  operatorId: string
): Promise<OperatorCrewRow[]> {
  const client = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await client.rpc('list_operator_crew', {
    p_operator_id: operatorId,
  });
  if (error) {
    throw new Error(`listOperatorCrew failed: ${error.message}`);
  }
  const rows = (data ?? []) as RawCrewRow[];
  return rows.map((r) => ({
    ...r,
    languages: r.languages ?? [],
    specializations: r.specializations ?? [],
    experience_hours: r.experience_hours == null ? 0 : Number(r.experience_hours),
    extra_fee: r.extra_fee == null ? 0 : Number(r.extra_fee),
  }));
}
