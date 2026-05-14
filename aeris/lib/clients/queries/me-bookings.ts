import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type { BookingRow } from '@/types/database';

/**
 * Phase 9 PR 3 — read helpers for the client `/me/bookings` +
 * `/me/bookings/[id]` surfaces.
 *
 * Same service-role + application-level ownership discipline
 * as me-requests.ts: callers MUST pass `session.client_id` from
 * `requireClientSession()`. The `client_id IS NULL` rows
 * (legacy bookings whose pointer was cleared in PR 2's
 * inline backfill) are intentionally excluded — those rows
 * still survive for ZATCA / admin audit but should never
 * appear on a client's own list.
 */

export async function listBookingsForClient(
  clientId: string
): Promise<BookingRow[]> {
  noStore();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('bookings')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[me-bookings.list] read failed', error);
    throw new Error(`listBookingsForClient failed: ${error.message}`);
  }
  return (data ?? []) as BookingRow[];
}

export async function getBookingForClient(
  clientId: string,
  bookingId: string
): Promise<BookingRow | null> {
  noStore();

  // Codex round 1 PR #57 P2 #1 fix — same short-circuit as
  // me-requests.getTripRequestForClient. A malformed
  // /me/bookings/<id> route would otherwise 500 because
  // PostgREST throws on the UUID comparison.
  if (!isUuid(bookingId)) return null;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (error) {
    console.error('[me-bookings.detail] read failed', error);
    throw new Error(`getBookingForClient failed: ${error.message}`);
  }
  return (data ?? null) as BookingRow | null;
}
