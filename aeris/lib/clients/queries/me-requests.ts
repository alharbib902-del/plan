import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type { TripRequestRow } from '@/types/database';

/**
 * Phase 9 PR 3 — read helpers for the client `/me/requests` +
 * `/me/requests/[id]` surfaces.
 *
 * Service-role queries scoped to the calling client_id —
 * callers MUST pass `session.client_id` from
 * `requireClientSession()` so the RLS bypass via service role
 * stays gated by the application-level ownership check.
 *
 * Why service role here: Phase 1 RLS for trip_requests is
 * deny-all-by-default (no client-side policies were ever
 * landed). Adding policies in PR 3 would touch every existing
 * surface; instead we keep the existing admin-bypass pattern
 * and enforce ownership in the where-clause of the queries
 * below — the same shape every other Phase 9 client read
 * uses.
 */

export type ClientTripStatusFilter =
  | 'all'
  | 'pending'
  | 'distributed'
  | 'offered'
  | 'booked'
  | 'cancelled';

export const CLIENT_TRIP_STATUS_FILTERS: readonly ClientTripStatusFilter[] = [
  'all',
  'pending',
  'distributed',
  'offered',
  'booked',
  'cancelled',
] as const;

export function isClientTripStatusFilter(
  value: string | null | undefined
): value is ClientTripStatusFilter {
  return (
    typeof value === 'string' &&
    (CLIENT_TRIP_STATUS_FILTERS as readonly string[]).includes(value)
  );
}

export async function listTripRequestsForClient(
  clientId: string,
  filter: ClientTripStatusFilter
): Promise<TripRequestRow[]> {
  noStore();
  const admin = createAdminClient();

  let query = admin
    .from('trip_requests')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    // Bound the wire payload — the client's own list renders without
    // pagination, so cap to the most-recent rows (matches admin libs).
    .limit(200);

  if (filter !== 'all') {
    query = query.eq('status', filter);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[me-requests.list] read failed', error);
    throw new Error(
      `listTripRequestsForClient failed: ${error.message}`
    );
  }
  return (data ?? []) as TripRequestRow[];
}

export async function getTripRequestForClient(
  clientId: string,
  tripRequestId: string
): Promise<TripRequestRow | null> {
  noStore();

  // Codex round 1 PR #57 P2 #1 fix — short-circuit when the
  // route param is not a UUID. Without this, PostgREST
  // rejects the .eq('id', tripRequestId) comparison with
  // 22P02 invalid_text_representation and the page renders
  // a 500. NULL collapses naturally into the not-found UX
  // the page already handles.
  if (!isUuid(tripRequestId)) return null;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('trip_requests')
    .select('*')
    .eq('id', tripRequestId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (error) {
    console.error('[me-requests.detail] read failed', error);
    throw new Error(
      `getTripRequestForClient failed: ${error.message}`
    );
  }
  return (data ?? null) as TripRequestRow | null;
}
