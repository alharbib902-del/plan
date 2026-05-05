import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  Phase4OperatorOfferRow,
  Phase5OperatorOfferRow,
  TripDispatchTargetRow,
  UnifiedOfferRow,
} from '@/types/database';

/**
 * Read every offer on a trip across BOTH the Phase 4 and Phase 5
 * tables, returning a unified shape tagged with `source` so the
 * (future) admin comparison UI can route accept clicks to the
 * unified accept_offer RPC with the correct source argument.
 *
 * Each row also carries `is_current_round` for Phase 5 offers so
 * the UI can label "fresh offer in active round" vs "offer from a
 * prior round we re-dispatched against".
 *
 * Sorted by created_at DESC across both sources.
 *
 * Why two queries + an in-memory merge instead of a Postgres
 * VIEW: a VIEW would require a new migration, which is out of
 * scope for this PR. The two queries are both indexed on
 * trip_request_id and run in parallel via Promise.all.
 */
export async function listOffersByTripUnified(
  tripRequestId: string
): Promise<UnifiedOfferRow[]> {
  noStore();
  const client = createAdminClient();

  // Read trip's current_dispatch_round_id once so we can tag each
  // Phase 5 offer with is_current_round without re-querying per row.
  const tripPromise = client
    .from('trip_requests')
    .select('current_dispatch_round_id')
    .eq('id', tripRequestId)
    .maybeSingle();

  const phase4Promise = client
    .from('phase4_operator_offers')
    .select('*')
    .eq('trip_request_id', tripRequestId);

  const phase5Promise = client
    .from('phase5_operator_offers')
    .select('*')
    .eq('trip_request_id', tripRequestId);

  // Phase 5 needs a target lookup for target_phone + dispatch_round_id.
  // One round-trip pulls every target on the trip; we then look up
  // by id in memory. Indexed on (trip_request_id, sent_at DESC).
  const targetsPromise = client
    .from('trip_dispatch_targets')
    .select('id, target_phone, dispatch_round_id')
    .eq('trip_request_id', tripRequestId);

  const [tripResult, phase4Result, phase5Result, targetsResult] = await Promise.all([
    tripPromise,
    phase4Promise,
    phase5Promise,
    targetsPromise,
  ]);

  if (tripResult.error) {
    console.error('[unified-offers] trip lookup failed', tripResult.error);
    throw new Error(
      `listOffersByTripUnified trip lookup failed: ${tripResult.error.message}`
    );
  }
  if (phase4Result.error) {
    console.error('[unified-offers] phase4 read failed', phase4Result.error);
    throw new Error(
      `listOffersByTripUnified phase4 read failed: ${phase4Result.error.message}`
    );
  }
  if (phase5Result.error) {
    console.error('[unified-offers] phase5 read failed', phase5Result.error);
    throw new Error(
      `listOffersByTripUnified phase5 read failed: ${phase5Result.error.message}`
    );
  }
  if (targetsResult.error) {
    console.error('[unified-offers] targets read failed', targetsResult.error);
    throw new Error(
      `listOffersByTripUnified targets read failed: ${targetsResult.error.message}`
    );
  }

  const currentRoundId =
    tripResult.data?.current_dispatch_round_id ?? null;

  // Build target_id → {target_phone, dispatch_round_id} index.
  const targetIndex = new Map<
    string,
    Pick<TripDispatchTargetRow, 'target_phone' | 'dispatch_round_id'>
  >();
  for (const t of (targetsResult.data ?? []) as Array<
    Pick<TripDispatchTargetRow, 'id' | 'target_phone' | 'dispatch_round_id'>
  >) {
    targetIndex.set(t.id, {
      target_phone: t.target_phone,
      dispatch_round_id: t.dispatch_round_id,
    });
  }

  const phase4Rows = (phase4Result.data ?? []) as Phase4OperatorOfferRow[];
  const phase5Rows = (phase5Result.data ?? []) as Phase5OperatorOfferRow[];

  const unified: UnifiedOfferRow[] = [
    ...phase4Rows.map((row): UnifiedOfferRow => ({
      source: 'phase4',
      id: row.id,
      trip_request_id: row.trip_request_id,
      operator_name: row.operator_name,
      operator_phone: row.operator_phone,
      operator_email: row.operator_email,
      aircraft_category: row.aircraft_category,
      aircraft_type: row.aircraft_type,
      aircraft_registration: row.aircraft_registration,
      total_price_sar: Number(row.total_price_sar),
      departure_eta: row.departure_eta,
      validity_hours: row.validity_hours,
      expires_at: row.expires_at,
      notes: row.notes,
      status: row.status,
      decided_at: row.decided_at,
      created_at: row.created_at,
      dispatch_target_id: null,
      target_phone: null,
      dispatch_round_id: null,
      is_current_round: null,
    })),
    ...phase5Rows.map((row): UnifiedOfferRow => {
      const target = targetIndex.get(row.dispatch_target_id);
      return {
        source: 'phase5',
        id: row.id,
        trip_request_id: row.trip_request_id,
        operator_name: row.operator_name,
        operator_phone: row.operator_phone,
        operator_email: row.operator_email,
        aircraft_category: row.aircraft_category,
        aircraft_type: row.aircraft_type,
        aircraft_registration: row.aircraft_registration,
        total_price_sar: Number(row.total_price_sar),
        departure_eta: row.departure_eta,
        validity_hours: row.validity_hours,
        expires_at: row.expires_at,
        notes: row.notes,
        status: row.status,
        decided_at: row.decided_at,
        created_at: row.created_at,
        dispatch_target_id: row.dispatch_target_id,
        target_phone: target?.target_phone ?? null,
        dispatch_round_id: target?.dispatch_round_id ?? null,
        is_current_round:
          target?.dispatch_round_id !== undefined &&
          target.dispatch_round_id === currentRoundId,
      };
    }),
  ];

  // Sort newest first across both sources.
  unified.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return unified;
}
