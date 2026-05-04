import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  Phase4OperatorOfferRow,
  SubmitPhase4OperatorOfferArgs,
  SubmitPhase4OperatorOfferResult,
} from '@/types/database';

const TABLE = 'phase4_operator_offers';

export async function listOffersByTrip(
  tripRequestId: string
): Promise<Phase4OperatorOfferRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('trip_request_id', tripRequestId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[phase4-offers] listOffersByTrip failed', error);
    throw new Error(`listOffersByTrip failed: ${error.message}`);
  }
  return (data ?? []) as Phase4OperatorOfferRow[];
}

/**
 * Phase 4 RPC wrapper: operator submits an offer via signed URL.
 * The RPC wraps the trip lock + dispatch_nonce/expiry re-check +
 * offer insert + trip status promotion in a single transaction.
 */
export async function submitOperatorOfferRpc(
  args: SubmitPhase4OperatorOfferArgs
): Promise<SubmitPhase4OperatorOfferResult> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client.rpc(
    'submit_phase4_operator_offer',
    args
  );

  if (error) {
    console.error(
      '[phase4-offers] submit_phase4_operator_offer RPC failed',
      error
    );
    throw new Error(`submit offer RPC failed: ${error.message}`);
  }
  return data as SubmitPhase4OperatorOfferResult;
}
