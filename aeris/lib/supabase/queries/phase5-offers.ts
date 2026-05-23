import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AircraftCategoryValue } from '@/lib/validators/promote-lead';
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
 * Read-only projection of the submitted Phase 5 offer for a given
 * dispatch target. Used by the operator portal's "link already
 * used" friendly page (post-S2 enrichment): instead of a generic
 * "this link was used" message, the page can echo the offer the
 * operator already sent so it feels like a confirmation rather
 * than a dead end.
 *
 * Server-only — read through the admin client, RLS-free. The
 * caller has already proven legitimate access to the target row
 * via the HMAC-verified v=2 token (see app/operator/offer/[token]/
 * page.tsx).
 */
export interface SubmittedOfferDetails {
  total_price_sar: number;
  aircraft_category: AircraftCategoryValue | null;
  aircraft_type: string | null;
  aircraft_registration: string | null;
  departure_eta: string;
  validity_hours: number | null;
  notes: string | null;
  submitted_at: string;
}

/**
 * Fetch the single submitted offer attached to a dispatch target.
 * Phase 5 enforces `UNIQUE(dispatch_target_id)` on
 * `phase5_operator_offers`, so this is at-most-one. Returns null
 * when no offer exists for the target (defensive — should not
 * happen on the page's `targetStatus === 'submitted'` branch, but
 * the page must not crash if a race or admin cleanup made it
 * disappear between the status check and this read).
 */
export async function getSubmittedOfferByTargetId(
  targetId: string
): Promise<SubmittedOfferDetails | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select(
      'total_price_sar, aircraft_category, aircraft_type, aircraft_registration, departure_eta, validity_hours, notes, created_at'
    )
    .eq('dispatch_target_id', targetId)
    .maybeSingle();

  if (error) {
    console.error('[phase5-offers] getSubmittedOfferByTargetId failed', error);
    return null;
  }
  if (!data) return null;

  return {
    total_price_sar: Number(data.total_price_sar),
    aircraft_category: (data.aircraft_category ?? null) as AircraftCategoryValue | null,
    aircraft_type: data.aircraft_type ?? null,
    aircraft_registration: data.aircraft_registration ?? null,
    departure_eta: data.departure_eta,
    validity_hours: data.validity_hours ?? null,
    notes: data.notes ?? null,
    submitted_at: data.created_at,
  };
}

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
