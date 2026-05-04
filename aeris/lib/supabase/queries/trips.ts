import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  AcceptPhase4OfferArgs,
  AcceptPhase4OfferResult,
  PromoteLeadArgs,
  PromoteLeadResult,
  TripRequestRow,
  TripRequestStatus,
} from '@/types/database';

const TABLE = 'trip_requests';

export const TRIP_STATUSES: readonly TripRequestStatus[] = [
  'pending',
  'distributed',
  'offered',
  'booked',
  'cancelled',
] as const;

export interface ListTripsParams {
  status?: TripRequestStatus | 'all';
  limit?: number;
  offset?: number;
}

export interface TripStatusCounts {
  total: number;
  pending: number;
  distributed: number;
  offered: number;
  booked: number;
  cancelled: number;
}

export async function listTrips(
  params: ListTripsParams = {}
): Promise<TripRequestRow[]> {
  noStore();
  const { status, limit = 200, offset = 0 } = params;
  const client = createAdminClient();

  let query = client
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[trips] listTrips failed', error);
    throw new Error(`listTrips failed: ${error.message}`);
  }
  return (data ?? []) as TripRequestRow[];
}

export async function countTripsByStatus(): Promise<TripStatusCounts> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('status', { count: 'exact', head: false });

  if (error) {
    console.error('[trips] countTripsByStatus failed', error);
    throw new Error(`countTripsByStatus failed: ${error.message}`);
  }

  const counts: TripStatusCounts = {
    total: 0,
    pending: 0,
    distributed: 0,
    offered: 0,
    booked: 0,
    cancelled: 0,
  };
  for (const row of data ?? []) {
    counts.total += 1;
    const s = (row as { status: TripRequestStatus }).status;
    if ((TRIP_STATUSES as readonly string[]).includes(s)) counts[s] += 1;
  }
  return counts;
}

export async function getTripById(id: string): Promise<TripRequestRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[trips] getTripById failed', error);
    throw new Error(`getTripById failed: ${error.message}`);
  }
  return (data as TripRequestRow | null) ?? null;
}

/**
 * Phase 4 RPC wrapper: promote a lead inquiry into a trip request.
 * The RPC wraps the lead lock + status check + trip insert + lead
 * update in a single transaction.
 */
export async function promoteLeadToTripRequest(
  args: PromoteLeadArgs
): Promise<PromoteLeadResult> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client.rpc(
    'promote_lead_to_trip_request',
    args
  );

  if (error) {
    console.error('[trips] promote_lead_to_trip_request RPC failed', error);
    throw new Error(`promote RPC failed: ${error.message}`);
  }
  return data as PromoteLeadResult;
}

/**
 * Phase 4 dispatch state writer. Updates trip_requests with the new
 * dispatch_nonce, dispatch_expires_at, dispatch_target_phone,
 * dispatched_at, distributed_at, and status (pending → distributed).
 *
 * Called from the dispatchTripRequest Server Action AFTER the token
 * has been issued. The token's nonce must equal the persisted nonce
 * for /operator/offer/<token> to validate.
 *
 * Codex PR #2 fix #1 (P1, blocking): the predicate
 * `.in('status', ['pending', 'distributed'])` ensures dispatch is
 * a no-op when the trip is `'booked'` or `'cancelled'` — without it,
 * a stale admin tab could rewrite a booked trip back to `distributed`
 * and persist a fresh nonce that an operator could submit against.
 * The `.select('id')` returns the affected rows so the caller can
 * distinguish `trip_closed` from `trip_not_found` via a follow-up
 * SELECT, and surface a clean error to the UI.
 */
export class DispatchStateError extends Error {
  readonly code: 'trip_closed' | 'trip_not_found';
  constructor(code: 'trip_closed' | 'trip_not_found') {
    super(`Dispatch state error: ${code}`);
    this.name = 'DispatchStateError';
    this.code = code;
  }
}

export async function persistDispatchState(args: {
  tripRequestId: string;
  nonce: string;
  expiresAt: string;
  targetPhone: string;
}): Promise<void> {
  noStore();
  const client = createAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await client
    .from(TABLE)
    .update({
      status: 'distributed',
      dispatch_nonce: args.nonce,
      dispatch_expires_at: args.expiresAt,
      dispatch_target_phone: args.targetPhone,
      dispatched_at: now,
      distributed_at: now,
    })
    .eq('id', args.tripRequestId)
    .in('status', ['pending', 'distributed'])
    .select('id');

  if (error) {
    console.error('[trips] persistDispatchState failed', error);
    throw new Error(`persistDispatchState failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    // Predicate matched nothing. Either the trip does not exist or
    // its status is no longer in ('pending', 'distributed'). A
    // follow-up SELECT disambiguates so the UI can show a useful
    // Arabic-RTL error.
    const { data: existing, error: lookupErr } = await client
      .from(TABLE)
      .select('status')
      .eq('id', args.tripRequestId)
      .maybeSingle();

    if (lookupErr) {
      console.error(
        '[trips] persistDispatchState disambiguation lookup failed',
        lookupErr
      );
      throw new Error(`persistDispatchState lookup failed: ${lookupErr.message}`);
    }

    if (!existing) {
      throw new DispatchStateError('trip_not_found');
    }
    throw new DispatchStateError('trip_closed');
  }

  if (data.length > 1) {
    // id is the primary key; affected count > 1 is impossible. Guard
    // against a future migration that broke that invariant.
    throw new Error(
      `persistDispatchState: unexpected affected row count ${data.length}`
    );
  }
}

/**
 * Phase 4 RPC wrapper: accept an operator offer. The RPC wraps the
 * accept flip + sibling reject + trip booking in a single
 * transaction with row locks and an expiry guard.
 */
export async function acceptOperatorOffer(
  args: AcceptPhase4OfferArgs
): Promise<AcceptPhase4OfferResult> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client.rpc('accept_phase4_offer', args);

  if (error) {
    console.error('[trips] accept_phase4_offer RPC failed', error);
    throw new Error(`accept RPC failed: ${error.message}`);
  }
  return data as AcceptPhase4OfferResult;
}
