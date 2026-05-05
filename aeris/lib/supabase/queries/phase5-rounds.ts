import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TripDispatchRoundRow } from '@/types/database';

const TABLE = 'trip_dispatch_rounds';

/**
 * List every dispatch round on a trip, newest first.
 *
 * Phase 5 dispatch may happen multiple times on the same trip
 * (re-dispatch). Each call to `open_phase5_dispatch_round` opens a
 * new row here and closes the prior one in the same transaction.
 * Used by the (future) admin trip detail page to label offers by
 * which round they came from.
 */
export async function listRoundsByTrip(
  tripRequestId: string
): Promise<TripDispatchRoundRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('trip_request_id', tripRequestId)
    .order('opened_at', { ascending: false });

  if (error) {
    console.error('[phase5-rounds] listRoundsByTrip failed', error);
    throw new Error(`listRoundsByTrip failed: ${error.message}`);
  }
  return (data ?? []) as TripDispatchRoundRow[];
}

export async function getRoundById(
  roundId: string
): Promise<TripDispatchRoundRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('id', roundId)
    .maybeSingle();

  if (error) {
    console.error('[phase5-rounds] getRoundById failed', error);
    throw new Error(`getRoundById failed: ${error.message}`);
  }
  return (data as TripDispatchRoundRow | null) ?? null;
}
