import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type { CargoOfferRow, CargoRequestRow } from '@/lib/cargo/types';

/**
 * Phase 11 PR 2 — operator-side cargo queries.
 *
 * PR 2 ships SELF-DISCOVERY only: the operator sees ALL active
 * cargo requests (status pending/offers_received). PR 3 will
 * add the dispatch engine + per-operator filtering by capability
 * + last-dispatched recency.
 *
 * Why expose all active requests in PR 2: the cargo flow needs
 * operators to actually quote so the founder can validate the
 * accept-flow end-to-end before distribution wiring lands. The
 * §4.3 RPC still enforces capability matching at submit time
 * (aircraft_not_capable error if the operator picks a non-capable
 * aircraft), so the visibility is harmless.
 */

interface LooseCount {
  count: number;
}

export interface OperatorCargoRequestRow extends CargoRequestRow {
  pending_offer_from_me: boolean;
}

export async function listOperatorAvailableCargoRequests(
  operatorId: string
): Promise<OperatorCargoRequestRow[]> {
  const admin = createAdminClient();

  const { data: requestsData, error: requestsError } = await admin
    .from('cargo_requests')
    .select('*')
    .in('status', ['pending', 'offers_received'])
    .order('pickup_date', { ascending: true })
    .limit(100);

  if (requestsError) {
    console.error('[cargo.operator-list] requests read failed', requestsError);
    throw new Error(
      `listOperatorAvailableCargoRequests failed: ${requestsError.message}`
    );
  }

  const requests = (requestsData ?? []) as CargoRequestRow[];
  if (requests.length === 0) return [];

  // Compute "already submitted" flag per request for this operator
  // so the UI can disable the [تقديم عرض] button on requests where
  // the operator already has a pending/accepted offer (the §4.3
  // RPC will reject 'operator_already_submitted' anyway, but this
  // saves a round-trip).
  const requestIds = requests.map((r) => r.id);
  const { data: myOffersData, error: myOffersError } = await admin
    .from('cargo_offers')
    .select('cargo_request_id, status')
    .eq('operator_id', operatorId)
    .in('cargo_request_id', requestIds);

  if (myOffersError) {
    console.error('[cargo.operator-list] my-offers read failed', myOffersError);
    // Soft-fail: still return requests; the [تقديم عرض] page will
    // handle the duplicate-submission rejection.
    return requests.map((r) => ({ ...r, pending_offer_from_me: false }));
  }

  const submitted = new Set<string>();
  for (const o of (myOffersData ?? []) as Pick<
    CargoOfferRow,
    'cargo_request_id' | 'status'
  >[]) {
    if (o.status === 'pending' || o.status === 'accepted') {
      submitted.add(o.cargo_request_id);
    }
  }

  return requests.map((r) => ({
    ...r,
    pending_offer_from_me: submitted.has(r.id),
  }));
}

export async function listOperatorMyCargoOffers(
  operatorId: string
): Promise<CargoOfferRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('cargo_offers')
    .select('*')
    .eq('operator_id', operatorId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[cargo.operator-list] my offers read failed', error);
    throw new Error(`listOperatorMyCargoOffers failed: ${error.message}`);
  }

  return (data ?? []) as CargoOfferRow[];
}

/**
 * Read a single cargo request by id (operator path — NO scoping
 * filter; any operator may view any active request to decide
 * whether to bid). Returns null if request is not active.
 */
export async function loadOperatorCargoRequestForOffer(
  requestId: string
): Promise<CargoRequestRow | null> {
  // Round 1 PR #67 P2 #2 — UUID-shape guard (mirror client-detail).
  // Without this, /operator/cargo/not-a-uuid/offer would let PostgREST
  // throw 22P02 and the page renders a 500 instead of notFound().
  if (!isUuid(requestId)) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('cargo_requests')
    .select('*')
    .eq('id', requestId)
    .in('status', ['pending', 'offers_received'])
    .maybeSingle();

  if (error) {
    console.error('[cargo.operator-list] request read failed', error);
    throw new Error(
      `loadOperatorCargoRequestForOffer failed: ${error.message}`
    );
  }
  return (data ?? null) as CargoRequestRow | null;
}

/**
 * Aircraft picker source: list operator's aircraft that are
 * capability-matched to the cargo_type. The form filters
 * server-side so the operator never sees an aircraft they
 * cannot use for this request.
 *
 * Empty array → form shows operatorOfferAircraftEmpty message.
 */
export async function listCapableAircraftForOperator(
  operatorId: string,
  cargoType: 'horse' | 'luxury_car' | 'valuables' | 'other'
): Promise<{ id: string; label: string }[]> {
  const admin = createAdminClient() as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: unknown
        ) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };

  // Step 1: operator's aircraft.
  const { data: acData, error: acError } = await admin
    .from('aircraft')
    .select('id, registration, type')
    .eq('operator_id', operatorId);

  if (acError) {
    console.error('[cargo.operator-list] aircraft read failed', acError);
    return [];
  }

  interface RawAircraft {
    id?: string;
    registration?: string | null;
    type?: string | null;
  }
  const aircraft = (acData ?? []) as RawAircraft[];
  if (aircraft.length === 0) return [];

  // Step 2: capability rows that include the cargo_type column.
  const aircraftIds = aircraft.map((a) => a.id).filter(Boolean) as string[];
  if (aircraftIds.length === 0) return [];

  const supportsCol =
    cargoType === 'horse'
      ? 'supports_horse'
      : cargoType === 'luxury_car'
        ? 'supports_luxury_car'
        : cargoType === 'valuables'
          ? 'supports_valuables'
          : 'supports_other';

  // Use a typed select via the adminClient (loose-cast removed
  // here — supabase-js can do .from('cargo_aircraft_capabilities')
  // because PR 1 added it to types/database.ts).
  const supabase = createAdminClient();
  const { data: capData, error: capError } = await supabase
    .from('cargo_aircraft_capabilities')
    .select('aircraft_id, supports_horse, supports_luxury_car, supports_valuables, supports_other')
    .in('aircraft_id', aircraftIds);

  if (capError) {
    console.error('[cargo.operator-list] caps read failed', capError);
    return [];
  }

  type CapRow = {
    aircraft_id: string;
    supports_horse: boolean;
    supports_luxury_car: boolean;
    supports_valuables: boolean;
    supports_other: boolean;
  };
  const capable = new Set<string>();
  for (const c of (capData ?? []) as CapRow[]) {
    if (c[supportsCol as keyof CapRow]) capable.add(c.aircraft_id);
  }

  return aircraft
    .filter((a) => a.id && capable.has(a.id))
    .map((a) => ({
      id: a.id!,
      label: a.type ? `${a.registration ?? ''} (${a.type})`.trim() : (a.registration ?? '—'),
    }));
}

// Helper for table rendering shared between list pages.
export function formatCargoRoute(row: CargoRequestRow): string {
  const dep = row.origin_iata ?? row.origin_freeform ?? '—';
  const arr = row.destination_iata ?? row.destination_freeform ?? '—';
  return `${dep} → ${arr}`;
}

// Compatibility shim: re-export count util if a future caller needs it.
export type { LooseCount };
