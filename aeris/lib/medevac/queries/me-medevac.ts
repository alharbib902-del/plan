import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type {
  MedevacRequestRow,
  MedevacOfferRow,
} from '@/lib/medevac/types';

/**
 * Phase 12 PR 2 — read helpers for the /me/medevac surface.
 *
 * Service-role queries scoped by `client_id` (passed in from
 * requireClientSession() at the page layer). RLS is enabled
 * on medevac_requests + medevac_offers but service-role
 * bypasses; the client_id filter is the security boundary
 * here.
 *
 * The PII columns (patient_name_snapshot + patient_age_snapshot)
 * ARE selected here — clients see their OWN patient data per
 * D8 (d). The admin PII redaction only applies to the admin
 * tier (D8 e/f).
 */

export interface MyMedevacRequestWithOffers extends MedevacRequestRow {
  offers: MedevacOfferRow[];
}

type ReadResult = Promise<{
  data: unknown;
  error: { message?: string } | null;
}>;

// PostgREST's `.order()` is both terminal (awaitable) AND
// chainable (`.limit(n)` returns ReadResult). We model that
// as an intersection.
type OrderChain = ReadResult & {
  limit: (n: number) => ReadResult;
};

type LooseSelectClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => OrderChain;
        maybeSingle: () => ReadResult;
      };
    };
  };
};

export async function listMyMedevacRequests(
  clientId: string,
  limit = 30
): Promise<MedevacRequestRow[]> {
  noStore();
  if (!isUuid(clientId)) return [];
  const loose = createAdminClient() as unknown as LooseSelectClient;
  const { data, error } = await loose
    .from('medevac_requests')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[medevac.me.list] read failed', error);
    return [];
  }
  return (data ?? []) as MedevacRequestRow[];
}

export async function getMyMedevacRequestDetail(
  clientId: string,
  requestId: string
): Promise<MyMedevacRequestWithOffers | null> {
  noStore();
  if (!isUuid(clientId)) return null;
  if (!isUuid(requestId)) return null;

  const loose = createAdminClient() as unknown as LooseSelectClient;

  const { data: requestData, error: requestError } = await loose
    .from('medevac_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (requestError) {
    console.error('[medevac.me.detail] request read failed', requestError);
    return null;
  }
  if (!requestData) return null;
  const request = requestData as MedevacRequestRow;
  if (request.client_id !== clientId) {
    // 404 semantics — never reveal that the row exists for a
    // different client (matches Phase 11 me-requests pattern).
    return null;
  }

  // Offer list scoped by request_id.
  const offersResult = await loose
    .from('medevac_offers')
    .select('*')
    .eq('medevac_request_id', requestId)
    .order('created_at', { ascending: false });
  if (offersResult.error) {
    console.error('[medevac.me.detail] offers read failed', offersResult.error);
  }

  return {
    ...request,
    offers: (offersResult.data ?? []) as MedevacOfferRow[],
  };
}
