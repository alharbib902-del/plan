import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  AcceptOfferArgs,
  AcceptOfferResult,
  OpenPhase5DispatchRoundArgs,
  OpenPhase5DispatchRoundResult,
  Phase5OperatorOfferRow,
  SubmitPhase5OperatorOfferArgs,
  SubmitPhase5OperatorOfferResult,
} from '@/types/database';

const TABLE = 'phase5_operator_offers';

/**
 * List Phase 5 offers for a trip (all rounds), newest first.
 * Used by the (future) admin comparison view alongside Phase 4
 * offers via the unified read in lib/supabase/queries/unified-offers.ts.
 */
export async function listPhase5OffersByTrip(
  tripRequestId: string
): Promise<Phase5OperatorOfferRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('trip_request_id', tripRequestId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[phase5-offers] listPhase5OffersByTrip failed', error);
    throw new Error(`listPhase5OffersByTrip failed: ${error.message}`);
  }
  return (data ?? []) as Phase5OperatorOfferRow[];
}

// ============================================================================
// RPC wrappers (one per Phase 5 SECURITY DEFINER function)
// ============================================================================

/**
 * Phase 5 RPC wrapper: atomically open a multi-operator dispatch
 * round on a trip. The Server Action MUST pre-build target_id +
 * nonce + sent_at + expires_at locally for each phone BEFORE
 * calling this — see spec §"User journeys" J1 step 4 for the
 * pre-build-then-commit atomicity contract (iteration-1 P1 fix).
 *
 * The RPC closes any prior round (cancels its still-pending
 * targets), inserts the new round + N target rows using the
 * supplied id/target_phone/nonce/sent_at/expires_at AS-IS, and
 * sets trip.current_dispatch_round_id. Trip status moves forward
 * only (pending → distributed; distributed/offered stay).
 */
export async function openPhase5DispatchRoundRpc(
  args: OpenPhase5DispatchRoundArgs
): Promise<OpenPhase5DispatchRoundResult> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client.rpc(
    'open_phase5_dispatch_round',
    args
  );

  if (error) {
    console.error('[phase5-offers] open_phase5_dispatch_round RPC failed', error);
    throw new Error(`open_phase5_dispatch_round RPC failed: ${error.message}`);
  }
  return data as OpenPhase5DispatchRoundResult;
}

/**
 * Phase 5 RPC wrapper: operator submits an offer through a v=2
 * signed token URL. The wrapper itself is reachable from app code
 * but is NOT wired to the operator portal page in this PR — the
 * portal v=2 path is a later PR per spec implementation order.
 * Declared here so the RPC has a typed entry point ready for that
 * PR; importing it from Phase 4 paths is a no-op.
 */
export async function submitPhase5OperatorOfferRpc(
  args: SubmitPhase5OperatorOfferArgs
): Promise<SubmitPhase5OperatorOfferResult> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client.rpc(
    'submit_phase5_operator_offer',
    args
  );

  if (error) {
    console.error(
      '[phase5-offers] submit_phase5_operator_offer RPC failed',
      error
    );
    throw new Error(`submit_phase5_operator_offer RPC failed: ${error.message}`);
  }
  return data as SubmitPhase5OperatorOfferResult;
}

/**
 * Phase 5 RPC wrapper: UNIFIED accept. Routes to either the
 * Phase 4 or Phase 5 offer table by p_source ('phase4' | 'phase5')
 * and atomically rejects every sibling on the trip across BOTH
 * tables, cancels every pending Phase 5 target, closes every open
 * round, books the trip. See spec §"User journeys" J3 + iteration-1
 * P1 fix.
 *
 * The legacy accept_phase4_offer RPC stays in the DB for the
 * deprecation window but is no longer called by the application.
 */
export async function acceptOfferRpc(
  args: AcceptOfferArgs
): Promise<AcceptOfferResult> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client.rpc('accept_offer', args);

  if (error) {
    console.error('[phase5-offers] accept_offer RPC failed', error);
    throw new Error(`accept_offer RPC failed: ${error.message}`);
  }
  return data as AcceptOfferResult;
}
