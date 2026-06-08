import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  OperatorSessionRow,
  OperatorRow,
  EmptyLegStatus,
} from '@/types/database';

/**
 * Phase 8 PR 2c — DB helpers for operator sessions + the
 * operator's own profile row. Used by:
 *   - Authed page modules (dashboard, profile, legs list)
 *     to fetch operator info that the RPC's session_validate
 *     doesn't return inline.
 *   - The "active sessions" surface (future PR).
 *
 * Mutations (insert / revoke) go through PR 2a RPCs — never
 * direct table writes — so this module is read-only EXCEPT
 * for an admin "force logout" which can land later.
 */

export async function getOperatorRowById(
  operatorId: string
): Promise<OperatorRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from('operators')
    .select('*')
    .eq('id', operatorId)
    .maybeSingle();
  if (error) {
    console.error('[operators.session-store] getOperatorRowById', error);
    throw new Error(`getOperatorRowById failed: ${error.message}`);
  }
  return (data ?? null) as OperatorRow | null;
}

export async function listActiveSessionsForOperator(
  operatorId: string
): Promise<OperatorSessionRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from('operator_sessions')
    .select('*')
    .eq('operator_id', operatorId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('issued_at', { ascending: false });
  if (error) {
    console.error('[operators.session-store] listActiveSessionsForOperator', error);
    throw new Error(`listActiveSessionsForOperator failed: ${error.message}`);
  }
  return (data ?? []) as OperatorSessionRow[];
}

export interface OperatorDashboardStats {
  active_legs: number;
  reserved_legs: number;
  sold_legs: number;
}

/**
 * Aggregate counts for the operator's dashboard cards.
 * Operator-scoped: only counts legs whose `operator_id`
 * matches. Phase 7 stub-mode legs (with `operator_stub_id`)
 * are intentionally excluded — they belong to the legacy
 * URL-token portal.
 */
export async function getOperatorDashboardStats(
  operatorId: string
): Promise<OperatorDashboardStats> {
  noStore();
  const client = createAdminClient();
  // Count-only head queries: the DB returns the count per status
  // instead of shipping every matching row to be tallied in JS.
  const countByStatus = async (
    status: NonNullable<EmptyLegStatus>
  ): Promise<number> => {
    const { count, error } = await client
      .from('empty_legs')
      .select('*', { count: 'exact', head: true })
      .eq('operator_id', operatorId)
      .eq('status', status);
    if (error) {
      console.error('[operators.session-store] getOperatorDashboardStats', error);
      throw new Error(`getOperatorDashboardStats failed: ${error.message}`);
    }
    return count ?? 0;
  };
  const [active_legs, reserved_legs, sold_legs] = await Promise.all([
    countByStatus('available'),
    countByStatus('reserved'),
    countByStatus('sold'),
  ]);
  return { active_legs, reserved_legs, sold_legs };
}
