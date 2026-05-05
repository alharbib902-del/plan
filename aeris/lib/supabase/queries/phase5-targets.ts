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
