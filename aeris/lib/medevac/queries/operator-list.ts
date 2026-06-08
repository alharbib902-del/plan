import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type {
  MedevacRequestRow,
  MedevacOfferRow,
  MedevacRequestRedactedRow,
} from '@/lib/medevac/types';

/**
 * Phase 12 PR 2 — read helpers for the /operator/medevac
 * surface.
 *
 * D8 (b) — operators see MEV-XXXX + service_level +
 * condition_severity + route ONLY while preparing offers;
 * patient_name + patient_age are REDACTED on the queue +
 * offer-prep pages. The redacted projection mirrors the
 * admin listAdminMedevacRequests pattern.
 *
 * D8 (c) — booked operator post-acceptance sees the full
 * patient name via the bookings.customer_name_snapshot copy
 * that accept_medevac_offer wrote (§4.4 step 4). The
 * /operator/bookings page (Phase 6.2 base) renders that.
 */

type LooseSelectClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq?: (
        col: string,
        val: string
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => {
          limit?: (n: number) => Promise<{
            data: unknown;
            error: { message?: string } | null;
          }>;
        } & Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
        maybeSingle: () => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
      in: (
        col: string,
        vals: string[]
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
      order?: (
        col: string,
        opts: { ascending: boolean }
      ) => {
        limit?: (n: number) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      } & Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
    };
  };
};

const REDACTED_COLS = [
  'id',
  'medevac_request_number',
  'condition_severity',
  'service_level',
  'from_location_freeform',
  'from_iata',
  'to_hospital_name',
  'to_iata',
  'status',
  'is_covered',
  'estimated_value_sar',
  'dispatched_at',
  'sla_escalated_at',
  'created_at',
  'updated_at',
].join(',');

/**
 * List of pending + offers_received medevac requests visible
 * to operators (queue view). PII-redacted per D8 (b).
 *
 * v1: returns ALL open requests. PR 3 will filter by
 * operator-aircraft cert match + dispatched_at fanout; for
 * PR 2 we surface every open row so operators can self-select.
 */
export async function listOpenMedevacRequestsForOperator(
  limit = 50
): Promise<MedevacRequestRedactedRow[]> {
  noStore();
  const loose = createAdminClient() as unknown as LooseSelectClient;
  const select = loose.from('medevac_requests').select(REDACTED_COLS);
  if (!select.eq) return [];
  // Use .eq() for status — open requests = pending OR
  // offers_received. PostgREST .or() chains are
  // type-unfriendly inside the loose-cast shape, so we do
  // two queries + merge instead.
  const [pendingResult, offersResult] = await Promise.all([
    select.eq('status', 'pending').order('created_at', { ascending: false }),
    loose
      .from('medevac_requests')
      .select(REDACTED_COLS)
      .eq!('status', 'offers_received')
      .order('created_at', { ascending: false }),
  ]);
  const rows: MedevacRequestRedactedRow[] = [
    ...((pendingResult.data ?? []) as MedevacRequestRedactedRow[]),
    ...((offersResult.data ?? []) as MedevacRequestRedactedRow[]),
  ];
  return rows.slice(0, limit);
}

export async function getOpenMedevacRequestForOperator(
  requestId: string
): Promise<MedevacRequestRedactedRow | null> {
  noStore();
  if (!isUuid(requestId)) return null;
  const loose = createAdminClient() as unknown as LooseSelectClient;
  const built = loose.from('medevac_requests').select(REDACTED_COLS);
  if (!built.eq) return null;
  const { data, error } = await built.eq('id', requestId).maybeSingle();
  if (error) {
    console.error('[medevac.operator.detail] read failed', error);
    return null;
  }
  const row = (data as MedevacRequestRedactedRow | null) ?? null;
  // Round 1 PR #77 P2 #3 fix — defense-in-depth status filter.
  // The list page only surfaces pending/offers_received rows,
  // but a direct URL like `/operator/medevac/<uuid>/offer` to
  // an accepted/cancelled/expired request would otherwise
  // render the offer form + reveal redacted route/severity
  // metadata for closed work. Treat closed rows as not-found
  // here so the page falls through to its standard 404 branch
  // BEFORE the offer form renders. The §4.3 submit_medevac_offer
  // RPC enforces the same `request_not_open` guard server-side
  // as belt-and-suspenders.
  if (!row) return null;
  if (row.status !== 'pending' && row.status !== 'offers_received') {
    return null;
  }
  return row;
}

export async function listMyOperatorMedevacOffers(
  operatorId: string,
  limit = 50
): Promise<MedevacOfferRow[]> {
  noStore();
  if (!isUuid(operatorId)) return [];
  const loose = createAdminClient() as unknown as LooseSelectClient;
  const built = loose.from('medevac_offers').select('*');
  if (!built.eq) return [];
  const { data, error } = await built
    .eq('operator_id', operatorId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[medevac.operator.offers] read failed', error);
    return [];
  }
  return ((data ?? []) as MedevacOfferRow[]).slice(0, limit);
}

// Re-export the full row type so /operator/bookings/[id] can
// continue to use the existing Phase 6.2 shape without
// importing from this module.
export type { MedevacRequestRow };
