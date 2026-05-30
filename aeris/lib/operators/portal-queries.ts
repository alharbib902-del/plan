import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type { EmptyLegRow } from '@/types/database';

/**
 * Phase 8 PR 2c — operator-scoped read queries for the
 * portal pages (legs list, leg detail, bookings list).
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

export interface OperatorBookingPreview {
  id: string;
  booking_number: string;
  status: string;
  total_price_sar: number;
  created_at: string;
  customer_name: string | null;
  customer_phone: string | null;
}

export async function listOperatorBookings(
  operatorId: string
): Promise<OperatorBookingPreview[]> {
  noStore();
  const client = createAdminClient();
  // Bookings link to operators via the offer that produced
  // them. Phase 6.2 + Phase 7 booking schemas vary, so we
  // do a defensive select that picks fields likely to exist
  // and tolerates schema drift via Promise-of-empty fallback.
  try {
    const { data, error } = await client
      .from('bookings')
      .select('id, booking_number, status:flight_status, total_price_sar:total_amount, created_at, customer_name:customer_name_snapshot, customer_phone:customer_phone_snapshot, operator_id')
      .eq('operator_id', operatorId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      // Schema-drift fallback: log + return empty.
      console.warn('[operators.portal-queries] listOperatorBookings (operator_id filter not available)', error.message);
      return [];
    }
    return ((data ?? []) as unknown) as OperatorBookingPreview[];
  } catch (err) {
    console.warn('[operators.portal-queries] listOperatorBookings caught', err);
    return [];
  }
}

export async function getOperatorBookingById(
  operatorId: string,
  bookingId: string
): Promise<OperatorBookingPreview | null> {
  noStore();
  const client = createAdminClient();
  try {
    const { data, error } = await client
      .from('bookings')
      .select('id, booking_number, status:flight_status, total_price_sar:total_amount, created_at, customer_name:customer_name_snapshot, customer_phone:customer_phone_snapshot, operator_id')
      .eq('id', bookingId)
      .eq('operator_id', operatorId)
      .maybeSingle();
    if (error) {
      console.warn('[operators.portal-queries] getOperatorBookingById', error.message);
      return null;
    }
    return ((data ?? null) as unknown) as OperatorBookingPreview | null;
  } catch (err) {
    console.warn('[operators.portal-queries] getOperatorBookingById caught', err);
    return null;
  }
}
