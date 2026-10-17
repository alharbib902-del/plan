import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type {
  BookingFlightStatus,
  BookingPaymentStatus,
} from '@/types/database';

import { BOOKINGS_PAGE_SIZE, bookingNetDue } from './constants';

/**
 * Admin bookings read helpers. Service-role reads (the admin layout +
 * page already ran requireAdminSession). The hand-maintained Database
 * type lags the live schema (paid_at, cashback_*, is_covered, payments
 * ledger columns), so these use the loose-client pattern with explicit
 * column lists — the DB-compat checker (`npm run audit:db`) covers them.
 */

function loose(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export interface AdminBookingListRow {
  id: string;
  booking_number: string;
  client_id: string | null;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
  route_origin_iata: string | null;
  route_destination_iata: string | null;
  route_origin_freeform_snapshot: string | null;
  route_destination_freeform_snapshot: string | null;
  departure_scheduled: string;
  total_amount: number;
  payment_status: BookingPaymentStatus;
  flight_status: BookingFlightStatus;
  source_discriminator: string;
  created_at: string;
  /** Resolved from `clients` when client_id is set (else the snapshot). */
  client_name: string | null;
  client_phone: string | null;
}

export interface AdminBookingListResult {
  rows: AdminBookingListRow[];
  /** null when the requested page is past the end (PostgREST 416). */
  total: number | null;
}

interface ClientContact {
  id: string;
  full_name: string | null;
  contact_phone: string | null;
}

async function loadClientContacts(
  client: SupabaseClient,
  ids: string[]
): Promise<Map<string, ClientContact>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await client
    .from('clients')
    .select('id, full_name, contact_phone')
    .in('id', unique);
  if (error) {
    // Names are display sugar; the snapshot columns are the fallback.
    console.error('[admin/bookings] client contacts read failed', error);
    return new Map();
  }
  return new Map(
    ((data ?? []) as ClientContact[]).map((c) => [c.id, c])
  );
}

export async function listAdminBookings(params: {
  payment: BookingPaymentStatus | 'all';
  flight: BookingFlightStatus | 'all';
  page: number;
}): Promise<AdminBookingListResult> {
  noStore();
  const client = loose();
  const offset = (params.page - 1) * BOOKINGS_PAGE_SIZE;

  let query = client
    .from('bookings')
    .select(
      'id, booking_number, client_id, customer_name_snapshot, customer_phone_snapshot, route_origin_iata, route_destination_iata, route_origin_freeform_snapshot, route_destination_freeform_snapshot, departure_scheduled, total_amount, payment_status, flight_status, source_discriminator, created_at',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + BOOKINGS_PAGE_SIZE - 1);

  if (params.payment !== 'all') query = query.eq('payment_status', params.payment);
  if (params.flight !== 'all') query = query.eq('flight_status', params.flight);

  const { data, error, count } = await query;
  if (error) {
    // PGRST103 = requested range not satisfiable (page past the end).
    if (error.code === 'PGRST103') return { rows: [], total: null };
    console.error('[admin/bookings] listAdminBookings failed', error);
    throw new Error(`listAdminBookings failed: ${error.message}`);
  }

  const base = (data ?? []) as Omit<
    AdminBookingListRow,
    'client_name' | 'client_phone'
  >[];
  const contacts = await loadClientContacts(
    client,
    base.map((r) => r.client_id).filter((id): id is string => id !== null)
  );

  const rows = base.map((r) => {
    const c = r.client_id ? contacts.get(r.client_id) : undefined;
    return {
      ...r,
      total_amount: Number(r.total_amount),
      client_name: c?.full_name ?? r.customer_name_snapshot,
      client_phone: c?.contact_phone ?? r.customer_phone_snapshot,
    };
  });
  return { rows, total: count ?? rows.length };
}

export interface AdminBookingDetail {
  id: string;
  booking_number: string;
  client_id: string | null;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
  operator_id: string | null;
  operator_name_snapshot: string | null;
  operator_phone_snapshot: string | null;
  aircraft_snapshot: string | null;
  trip_request_id: string | null;
  source_offer_table: string | null;
  source_offer_id: string | null;
  source_discriminator: string;
  route_origin_iata: string | null;
  route_destination_iata: string | null;
  route_origin_freeform_snapshot: string | null;
  route_destination_freeform_snapshot: string | null;
  passengers_count_snapshot: number | null;
  departure_scheduled: string;
  return_scheduled: string | null;
  base_amount: number;
  addons_amount: number | null;
  vat_amount: number | null;
  total_amount: number;
  cashback_redemption_sar: number | null;
  cashback_earned_sar: number | null;
  payment_status: BookingPaymentStatus;
  paid_at: string | null;
  flight_status: BookingFlightStatus;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface AdminBookingAddon {
  id: string;
  addon_subtype: string;
  quantity: number;
  total_price: number;
  status: string;
}

export interface AdminBookingPayment {
  id: string;
  provider: string;
  status: string;
  amount: number;
  gateway_transaction_id: string | null;
  created_at: string;
}

export interface AdminBookingDetailBundle {
  booking: AdminBookingDetail;
  netDue: number;
  client: { name: string | null; phone: string | null };
  operatorName: string | null;
  /** /admin/... path of the originating request, when one is resolvable. */
  sourceHref: string | null;
  addons: AdminBookingAddon[];
  payments: AdminBookingPayment[];
  hasActivePaymentAttempt: boolean;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function resolveSourceHref(
  client: SupabaseClient,
  b: AdminBookingDetail
): Promise<string | null> {
  if (b.trip_request_id) return `/admin/trips/${b.trip_request_id}`;
  if (!b.source_offer_id) return null;

  if (
    b.source_offer_table === 'phase7_empty_leg' &&
    process.env.ENABLE_EMPTY_LEGS_ADMIN_UI !== 'false'
  ) {
    return `/admin/empty-legs/${b.source_offer_id}`;
  }
  if (b.source_offer_table === 'cargo_offers' && process.env.ENABLE_CARGO === 'true') {
    const { data } = await client
      .from('cargo_offers')
      .select('cargo_request_id')
      .eq('id', b.source_offer_id)
      .maybeSingle();
    const id = (data as { cargo_request_id: string | null } | null)?.cargo_request_id;
    return id ? `/admin/cargo/${id}` : null;
  }
  if (
    b.source_offer_table === 'medevac_offers' &&
    process.env.ENABLE_MEDEVAC === 'true'
  ) {
    const { data } = await client
      .from('medevac_offers')
      .select('medevac_request_id')
      .eq('id', b.source_offer_id)
      .maybeSingle();
    const id = (data as { medevac_request_id: string | null } | null)
      ?.medevac_request_id;
    return id ? `/admin/medevac/${id}` : null;
  }
  return null;
}

export async function getAdminBookingDetail(
  bookingId: string
): Promise<AdminBookingDetailBundle | null> {
  noStore();
  if (!isUuid(bookingId)) return null;
  const client = loose();

  const { data, error } = await client
    .from('bookings')
    .select(
      'id, booking_number, client_id, customer_name_snapshot, customer_phone_snapshot, operator_id, operator_name_snapshot, operator_phone_snapshot, aircraft_snapshot, trip_request_id, source_offer_table, source_offer_id, source_discriminator, route_origin_iata, route_destination_iata, route_origin_freeform_snapshot, route_destination_freeform_snapshot, passengers_count_snapshot, departure_scheduled, return_scheduled, base_amount, addons_amount, vat_amount, total_amount, cashback_redemption_sar, cashback_earned_sar, payment_status, paid_at, flight_status, cancellation_reason, cancelled_at, created_at'
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (error) {
    console.error('[admin/bookings] getAdminBookingDetail failed', error);
    throw new Error(`getAdminBookingDetail failed: ${error.message}`);
  }
  if (!data) return null;

  const raw = data as AdminBookingDetail;
  const booking: AdminBookingDetail = {
    ...raw,
    base_amount: toNum(raw.base_amount) ?? 0,
    addons_amount: toNum(raw.addons_amount),
    vat_amount: toNum(raw.vat_amount),
    total_amount: toNum(raw.total_amount) ?? 0,
    cashback_redemption_sar: toNum(raw.cashback_redemption_sar),
    cashback_earned_sar: toNum(raw.cashback_earned_sar),
  };

  const [contacts, operatorRes, addonsRes, paymentsRes, sourceHref] =
    await Promise.all([
      loadClientContacts(client, booking.client_id ? [booking.client_id] : []),
      booking.operator_id
        ? client
            .from('operators')
            .select('company_name, company_name_ar')
            .eq('id', booking.operator_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      client
        .from('booking_addons')
        .select('id, addon_subtype, quantity, total_price, status')
        .eq('booking_id', booking.id)
        .order('created_at', { ascending: true }),
      client
        .from('payments')
        .select('id, provider, status, amount, gateway_transaction_id, created_at')
        .eq('booking_id', booking.id)
        .order('created_at', { ascending: false }),
      resolveSourceHref(client, booking),
    ]);

  if (addonsRes.error) {
    console.error('[admin/bookings] addons read failed', addonsRes.error);
  }
  if (paymentsRes.error) {
    console.error('[admin/bookings] payments read failed', paymentsRes.error);
  }

  const contact = booking.client_id ? contacts.get(booking.client_id) : undefined;
  const operatorRow = operatorRes.data as
    | { company_name: string | null; company_name_ar: string | null }
    | null;

  const addons = ((addonsRes.data ?? []) as AdminBookingAddon[]).map((a) => ({
    ...a,
    total_price: toNum(a.total_price) ?? 0,
  }));
  const payments = ((paymentsRes.data ?? []) as AdminBookingPayment[]).map(
    (p) => ({ ...p, amount: toNum(p.amount) ?? 0 })
  );

  return {
    booking,
    netDue: bookingNetDue(booking.total_amount, booking.cashback_redemption_sar),
    client: {
      name: contact?.full_name ?? booking.customer_name_snapshot,
      phone: contact?.contact_phone ?? booking.customer_phone_snapshot,
    },
    operatorName:
      operatorRow?.company_name_ar ??
      operatorRow?.company_name ??
      booking.operator_name_snapshot,
    sourceHref,
    addons,
    payments,
    // A payments read failure fails CLOSED here (hides the confirm form);
    // the RPC re-checks this under the booking lock regardless.
    hasActivePaymentAttempt:
      paymentsRes.error !== null || payments.some((p) => p.status === 'initiated'),
  };
}

/**
 * Outstanding offline receivables right now (point-in-time, not ranged):
 * unpaid, not-cancelled bookings, summed at their net due. Shown next to
 * paid revenue on the analytics dashboard so manual-settlement mode is not
 * a silent zero. Fail-soft: null on read failure.
 */
export async function getPendingOfflineTotals(): Promise<{
  count: number;
  totalSar: number;
} | null> {
  noStore();
  const { data, error } = await loose()
    .from('bookings')
    .select('total_amount, cashback_redemption_sar')
    .in('payment_status', ['pending_offline', 'pending'])
    .neq('flight_status', 'cancelled')
    .limit(5000);
  if (error) {
    console.error('[admin/bookings] getPendingOfflineTotals failed', error);
    return null;
  }
  const rows = (data ?? []) as {
    total_amount: number | string;
    cashback_redemption_sar: number | string | null;
  }[];
  let total = 0;
  for (const r of rows) {
    total += bookingNetDue(
      toNum(r.total_amount) ?? 0,
      toNum(r.cashback_redemption_sar)
    );
  }
  return { count: rows.length, totalSar: Math.round(total * 100) / 100 };
}

/** The booking created from a charter trip request, if any (unique). */
export async function getBookingRefForTrip(
  tripRequestId: string
): Promise<{ id: string; booking_number: string } | null> {
  noStore();
  if (!isUuid(tripRequestId)) return null;
  const { data, error } = await loose()
    .from('bookings')
    .select('id, booking_number')
    .eq('trip_request_id', tripRequestId)
    .maybeSingle();
  if (error) {
    console.error('[admin/bookings] getBookingRefForTrip failed', error);
    return null;
  }
  return (data as { id: string; booking_number: string } | null) ?? null;
}
