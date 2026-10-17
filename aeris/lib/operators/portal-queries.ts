import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  AddonStatusValue,
  AddonTypeValue,
  BookingFlightStatus,
  BookingPaymentStatus,
  EmptyLegRow,
} from '@/types/database';

/**
 * Phase 8 PR 2c — operator-scoped read queries for the
 * portal pages (legs list, leg detail, bookings list + detail,
 * dashboard booking counts).
 *
 * Operator-scoped means the WHERE clause always pins to the
 * session's operator_id — never relies on RLS, since the
 * service-role client bypasses it.
 */

export async function listOperatorLegs(operatorId: string): Promise<EmptyLegRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from('empty_legs')
    .select('*')
    .eq('operator_id', operatorId)
    .order('departure_window_start', { ascending: true })
    .limit(200);
  if (error) {
    console.error('[operators.portal-queries] listOperatorLegs', error);
    throw new Error(`listOperatorLegs failed: ${error.message}`);
  }
  return (data ?? []) as EmptyLegRow[];
}

export async function getOperatorLegById(
  operatorId: string,
  legId: string
): Promise<EmptyLegRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from('empty_legs')
    .select('*')
    .eq('id', legId)
    .eq('operator_id', operatorId)
    .maybeSingle();
  if (error) {
    console.error('[operators.portal-queries] getOperatorLegById', error);
    throw new Error(`getOperatorLegById failed: ${error.message}`);
  }
  return (data ?? null) as EmptyLegRow | null;
}

export type OperatorBookingView = 'all' | 'upcoming' | 'unpaid';

const UPCOMING_FLIGHT_STATUSES: BookingFlightStatus[] = ['confirmed', 'boarding'];
const UNPAID_PAYMENT_STATUSES: BookingPaymentStatus[] = ['pending', 'pending_offline'];

export interface OperatorBookingPreview {
  id: string;
  booking_number: string;
  flight_status: BookingFlightStatus;
  payment_status: BookingPaymentStatus;
  total_amount: number;
  departure_scheduled: string | null;
  route_origin_iata: string | null;
  route_destination_iata: string | null;
  route_origin_freeform_snapshot: string | null;
  route_destination_freeform_snapshot: string | null;
  passengers_count_snapshot: number | null;
  aircraft_snapshot: string | null;
  created_at: string;
  customer_name_snapshot: string | null;
}

export interface OperatorBookingDetail extends OperatorBookingPreview {
  return_scheduled: string | null;
  customer_phone_snapshot: string | null;
}

export interface OperatorBookingAddon {
  id: string;
  addon_type: AddonTypeValue;
  addon_subtype: string;
  quantity: number;
  status: AddonStatusValue;
}

type Numericish = number | string | null;

function toNumberOrNull(value: Numericish | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeBooking<
  T extends { total_amount: Numericish; passengers_count_snapshot: Numericish },
>(raw: T): Omit<T, 'total_amount' | 'passengers_count_snapshot'> & {
  total_amount: number;
  passengers_count_snapshot: number | null;
} {
  return {
    ...raw,
    total_amount: toNumberOrNull(raw.total_amount) ?? 0,
    passengers_count_snapshot: toNumberOrNull(raw.passengers_count_snapshot),
  };
}

type RawPreview = Omit<OperatorBookingPreview, 'total_amount' | 'passengers_count_snapshot'> & {
  total_amount: Numericish;
  passengers_count_snapshot: Numericish;
};

type RawDetail = Omit<OperatorBookingDetail, 'total_amount' | 'passengers_count_snapshot'> & {
  total_amount: Numericish;
  passengers_count_snapshot: Numericish;
};

export async function listOperatorBookings(
  operatorId: string,
  view: OperatorBookingView = 'all'
): Promise<OperatorBookingPreview[]> {
  noStore();
  const client = createAdminClient();
  try {
    let query = client
      .from('bookings')
      .select('id, booking_number, flight_status, payment_status, total_amount, departure_scheduled, route_origin_iata, route_destination_iata, route_origin_freeform_snapshot, route_destination_freeform_snapshot, passengers_count_snapshot, aircraft_snapshot, created_at, customer_name_snapshot')
      .eq('operator_id', operatorId);
    if (view === 'upcoming') {
      query = query
        .in('flight_status', UPCOMING_FLIGHT_STATUSES)
        .gte('departure_scheduled', new Date().toISOString())
        .order('departure_scheduled', { ascending: true });
    } else if (view === 'unpaid') {
      query = query
        .in('payment_status', UNPAID_PAYMENT_STATUSES)
        .neq('flight_status', 'cancelled')
        .order('departure_scheduled', { ascending: true });
    } else {
      query = query.order('created_at', { ascending: false });
    }
    const { data, error } = await query.limit(200);
    if (error) {
      // Degraded fallback: stay fail-safe (empty list) but make
      // the failure observable — same console.error convention
      // as listOperatorLegs above.
      console.error('[operators.portal-queries] listOperatorBookings', error);
      return [];
    }
    return ((data ?? []) as unknown as RawPreview[]).map(normalizeBooking);
  } catch (err) {
    console.error('[operators.portal-queries] listOperatorBookings caught', err);
    return [];
  }
}

export async function getOperatorBookingById(
  operatorId: string,
  bookingId: string
): Promise<OperatorBookingDetail | null> {
  noStore();
  const client = createAdminClient();
  try {
    const { data, error } = await client
      .from('bookings')
      .select('id, booking_number, flight_status, payment_status, total_amount, departure_scheduled, return_scheduled, route_origin_iata, route_destination_iata, route_origin_freeform_snapshot, route_destination_freeform_snapshot, passengers_count_snapshot, aircraft_snapshot, created_at, customer_name_snapshot, customer_phone_snapshot')
      .eq('id', bookingId)
      .eq('operator_id', operatorId)
      .maybeSingle();
    if (error) {
      console.warn('[operators.portal-queries] getOperatorBookingById', error.message);
      return null;
    }
    if (!data) return null;
    return normalizeBooking(data as unknown as RawDetail);
  } catch (err) {
    console.warn('[operators.portal-queries] getOperatorBookingById caught', err);
    return null;
  }
}

/**
 * Add-ons of a booking. Callers MUST first prove ownership via
 * getOperatorBookingById — this read is keyed by booking id only.
 * `details` (free text that may carry passenger notes) is
 * deliberately not selected.
 */
export async function listOperatorBookingAddons(
  bookingId: string
): Promise<OperatorBookingAddon[]> {
  noStore();
  const client = createAdminClient();
  try {
    const { data, error } = await client
      .from('booking_addons')
      .select('id, addon_type, addon_subtype, quantity, status')
      .eq('booking_id', bookingId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('[operators.portal-queries] listOperatorBookingAddons', error.message);
      return [];
    }
    type RawAddon = Omit<OperatorBookingAddon, 'quantity'> & { quantity: Numericish };
    return ((data ?? []) as unknown as RawAddon[]).map((a) => ({
      ...a,
      quantity: toNumberOrNull(a.quantity) ?? 1,
    }));
  } catch (err) {
    console.warn('[operators.portal-queries] listOperatorBookingAddons caught', err);
    return [];
  }
}

export interface OperatorBookingCounts {
  upcoming: number | null;
  unpaid: number | null;
}

/**
 * Head-only counts for the dashboard, using the same predicates as
 * the `upcoming` / `unpaid` list views. null = that count failed
 * (fail-soft: the dashboard still renders).
 */
export async function getOperatorBookingCounts(
  operatorId: string
): Promise<OperatorBookingCounts> {
  noStore();
  const client = createAdminClient();
  try {
    const [upcoming, unpaid] = await Promise.all([
      client
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('operator_id', operatorId)
        .in('flight_status', UPCOMING_FLIGHT_STATUSES)
        .gte('departure_scheduled', new Date().toISOString()),
      client
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('operator_id', operatorId)
        .in('payment_status', UNPAID_PAYMENT_STATUSES)
        .neq('flight_status', 'cancelled'),
    ]);
    if (upcoming.error) {
      console.error('[operators.portal-queries] getOperatorBookingCounts upcoming', upcoming.error);
    }
    if (unpaid.error) {
      console.error('[operators.portal-queries] getOperatorBookingCounts unpaid', unpaid.error);
    }
    return {
      upcoming: upcoming.error ? null : (upcoming.count ?? 0),
      unpaid: unpaid.error ? null : (unpaid.count ?? 0),
    };
  } catch (err) {
    console.error('[operators.portal-queries] getOperatorBookingCounts caught', err);
    return { upcoming: null, unpaid: null };
  }
}
