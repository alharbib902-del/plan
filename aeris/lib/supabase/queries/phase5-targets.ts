import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TripDispatchTargetRow } from '@/types/database';

const TABLE = 'trip_dispatch_targets';

/**
 * Read every still-pending target on a trip's CURRENT dispatch
 * round. The (future) admin trip detail page uses this to rebuild
 * the operator URL cards from the persisted target rows on every
 * render — a successful dispatch RPC commits N target rows, and
 * this helper plus issueOperatorTokenFromTarget reproduce the same
 * URLs even if the original Server Action's response was lost
 * (browser closed, refresh, etc.). See spec acceptance #14a.
 *
 * Returns rows ordered by sent_at ASC so cards render in dispatch
 * order. Returns an empty array if the trip has no current round
 * or every target has reached a terminal state (submitted /
 * expired / cancelled).
 */
export async function listCurrentRoundTargets(
  tripRequestId: string
): Promise<TripDispatchTargetRow[]> {
  noStore();
  const client = createAdminClient();

  // Discover the trip's current round id.
  const { data: tripRow, error: tripErr } = await client
    .from('trip_requests')
    .select('current_dispatch_round_id')
    .eq('id', tripRequestId)
    .maybeSingle();

  if (tripErr) {
    console.error('[phase5-targets] read trip failed', tripErr);
    throw new Error(`listCurrentRoundTargets trip lookup failed: ${tripErr.message}`);
  }

  const roundId = tripRow?.current_dispatch_round_id ?? null;
  if (!roundId) return [];

  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('dispatch_round_id', roundId)
    .eq('status', 'pending')
    .order('sent_at', { ascending: true });

  if (error) {
    console.error('[phase5-targets] listCurrentRoundTargets failed', error);
    throw new Error(`listCurrentRoundTargets failed: ${error.message}`);
  }
  return (data ?? []) as TripDispatchTargetRow[];
}

/**
 * Read a single target row by id. Used by the operator portal
 * v=2 path: after `verifyOperatorToken` returns version=2, the
 * page reads the target row referenced by the token's
 * `dispatch_target_id` to re-verify state at request time
 * (nonce match, expiry, status='pending', and that the target
 * still belongs to the trip's current round). The Phase 5
 * submit RPC re-checks the same fields under FOR UPDATE on
 * submit, so this server-side read is necessary but never
 * sufficient — it just lets the page show ExpiredLink quickly
 * instead of rendering a form for a stale token.
 */
export async function getTargetById(
  id: string
): Promise<TripDispatchTargetRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[phase5-targets] getTargetById failed', error);
    throw new Error(`getTargetById failed: ${error.message}`);
  }
  return (data as TripDispatchTargetRow | null) ?? null;
}

/**
 * Read every target on a trip across ALL rounds (current + closed).
 * Used by the (future) audit / history view. NOT used by the live
 * dispatch panel — that one only shows current-round pending
 * targets via listCurrentRoundTargets.
 */
export async function listTargetsByTrip(
  tripRequestId: string
): Promise<TripDispatchTargetRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('trip_request_id', tripRequestId)
    .order('sent_at', { ascending: false });

  if (error) {
    console.error('[phase5-targets] listTargetsByTrip failed', error);
    throw new Error(`listTargetsByTrip failed: ${error.message}`);
  }
  return (data ?? []) as TripDispatchTargetRow[];
}
