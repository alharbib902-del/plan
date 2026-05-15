import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type { CargoRequestRow, CargoOfferRow } from '@/lib/cargo/types';

/**
 * Phase 11 PR 1 — read helpers for the admin cargo surface.
 *
 * Two surfaces:
 *   - listAdminCargoQueue: /admin/cargo list page; returns
 *     pending + offers_received requests sorted by pickup
 *     date (urgency proxy).
 *   - getAdminCargoRequest: /admin/cargo/[id] detail page;
 *     returns the request + all its offers (read-only in
 *     PR 1; PR 2 adds accept/decline buttons).
 *
 * Service-role queries; admin auth is the Server Action
 * boundary (Phase 8 ADMIN_INBOX_PASSWORD cookie).
 */

export interface CargoRequestWithOffers extends CargoRequestRow {
  offers: CargoOfferRow[];
}

export async function listAdminCargoQueue(
  limit = 50
): Promise<CargoRequestRow[]> {
  noStore();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('cargo_requests')
    .select('*')
    .in('status', ['pending', 'offers_received'])
    .order('pickup_date', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[cargo.admin-queue.list] read failed', error);
    throw new Error(`listAdminCargoQueue failed: ${error.message}`);
  }
  return (data ?? []) as CargoRequestRow[];
}

export async function getAdminCargoRequest(
  requestId: string
): Promise<CargoRequestWithOffers | null> {
  noStore();
  // Phase 9 PR 1 convention #19 — UUID guard short-circuit.
  // Without this the PostgREST UUID comparison throws a 500.
  if (!isUuid(requestId)) return null;

  const admin = createAdminClient();
  const { data: requestData, error: requestError } = await admin
    .from('cargo_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  if (requestError) {
    console.error('[cargo.admin-queue.detail] request read failed', requestError);
    throw new Error(`getAdminCargoRequest failed: ${requestError.message}`);
  }
  if (!requestData) return null;

  const { data: offersData, error: offersError } = await admin
    .from('cargo_offers')
    .select('*')
    .eq('cargo_request_id', requestId)
    .order('created_at', { ascending: false });

  if (offersError) {
    console.error('[cargo.admin-queue.detail] offers read failed', offersError);
    throw new Error(
      `getAdminCargoRequest offers failed: ${offersError.message}`
    );
  }

  return {
    ...(requestData as CargoRequestRow),
    offers: (offersData ?? []) as CargoOfferRow[],
  };
}
