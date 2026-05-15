import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type { CargoOfferRow, CargoRequestRow } from '@/lib/cargo/types';

/**
 * Phase 11 PR 2 — load a single cargo request + its offers
 * for the client portal detail page.
 *
 * Service-role read. The `client_id` filter on the request is
 * the actual auth gate — never trust the URL `request_id` alone.
 * If the request belongs to another client (or is a guest one),
 * returns null and the page renders notFound().
 *
 * Offers are sorted by `created_at ASC` so the order received
 * is preserved (operator who responded first appears first).
 *
 * The `acceptable` flag pre-computes whether the [قبول العرض]
 * button should render so the UI doesn't need to re-derive
 * the rule. An offer is acceptable iff:
 *   - offer.status = 'pending'
 *   - request.status IN ('pending', 'offers_received')
 *   - offer.expires_at > NOW()
 *   - request.expires_at > NOW()
 */

export interface CargoOfferWithDerived extends CargoOfferRow {
  acceptable: boolean;
}

export interface MyCargoRequestDetail {
  request: CargoRequestRow;
  offers: CargoOfferWithDerived[];
}

export async function loadMyCargoRequestDetail(
  clientId: string,
  requestId: string
): Promise<MyCargoRequestDetail | null> {
  // Round 1 PR #67 P2 #2 — UUID-shape guard.
  // Without this, /me/cargo-requests/not-a-uuid would let
  // PostgREST throw 22P02 invalid_text_representation on the
  // .eq('id', requestId) and the page renders a 500 instead
  // of notFound(). Mirrors getAdminCargoRequest discipline.
  if (!isUuid(requestId)) return null;

  const admin = createAdminClient();

  const { data: requestData, error: requestError } = await admin
    .from('cargo_requests')
    .select('*')
    .eq('id', requestId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (requestError) {
    console.error('[cargo.client-detail] request read failed', requestError);
    throw new Error(
      `loadMyCargoRequestDetail request failed: ${requestError.message}`
    );
  }
  if (!requestData) return null;
  const request = requestData as CargoRequestRow;

  const { data: offersData, error: offersError } = await admin
    .from('cargo_offers')
    .select('*')
    .eq('cargo_request_id', requestId)
    .order('created_at', { ascending: true });

  if (offersError) {
    console.error('[cargo.client-detail] offers read failed', offersError);
    throw new Error(
      `loadMyCargoRequestDetail offers failed: ${offersError.message}`
    );
  }

  const now = new Date();
  const requestOpen =
    (request.status === 'pending' || request.status === 'offers_received') &&
    new Date(request.expires_at) > now;

  const offers: CargoOfferWithDerived[] = ((offersData ?? []) as CargoOfferRow[]).map(
    (o) => ({
      ...o,
      acceptable:
        requestOpen &&
        o.status === 'pending' &&
        new Date(o.expires_at) > now,
    })
  );

  return { request, offers };
}
