import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  EmptyLegRow,
  EmptyLegStatus,
  EmptyLegNotificationRow,
  EmptyLegOutreachAlertStatusRow,
} from '@/lib/empty-legs/types';

const TABLE = 'empty_legs';
const NOTIFICATIONS_TABLE = 'empty_leg_notifications';
const ALERT_STATUS_TABLE = 'empty_leg_outreach_alert_status';

export const EMPTY_LEG_STATUSES: readonly EmptyLegStatus[] = [
  'available',
  'reserved',
  'sold',
  'expired',
  'cancelled',
] as const;

export type EmptyLegListFilter = EmptyLegStatus | 'all' | 'open';

export interface ListEmptyLegsParams {
  filter?: EmptyLegListFilter;
  limit?: number;
}

export interface EmptyLegStatusCounts {
  total: number;
  available: number;
  reserved: number;
  sold: number;
  expired: number;
  cancelled: number;
  open: number;
}

export async function listEmptyLegs(
  params: ListEmptyLegsParams = {}
): Promise<EmptyLegRow[]> {
  noStore();
  const { filter = 'open', limit = 200 } = params;
  const client = createAdminClient();

  let query = client
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filter === 'open') {
    query = query.in('status', ['available', 'reserved']);
  } else if (filter !== 'all') {
    query = query.eq('status', filter);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[empty-legs] listEmptyLegs failed', error);
    throw new Error(`listEmptyLegs failed: ${error.message}`);
  }
  return (data ?? []) as EmptyLegRow[];
}

export async function countEmptyLegsByStatus(): Promise<EmptyLegStatusCounts> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('status', { count: 'exact', head: false });

  if (error) {
    console.error('[empty-legs] countEmptyLegsByStatus failed', error);
    throw new Error(`countEmptyLegsByStatus failed: ${error.message}`);
  }

  const counts: EmptyLegStatusCounts = {
    total: 0,
    available: 0,
    reserved: 0,
    sold: 0,
    expired: 0,
    cancelled: 0,
    open: 0,
  };
  for (const row of data ?? []) {
    counts.total += 1;
    const s = (row as { status: EmptyLegStatus }).status;
    if ((EMPTY_LEG_STATUSES as readonly string[]).includes(s)) counts[s] += 1;
    if (s === 'available' || s === 'reserved') counts.open += 1;
  }
  return counts;
}

export async function getEmptyLegById(
  id: string
): Promise<EmptyLegRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[empty-legs] getEmptyLegById failed', error);
    throw new Error(`getEmptyLegById failed: ${error.message}`);
  }
  return (data as EmptyLegRow | null) ?? null;
}

// ============================================================
// Outreach queue
// ============================================================

export interface OutreachQueueRow extends EmptyLegNotificationRow {
  lead_customer_name: string | null;
  lead_customer_phone: string | null;
  leg_number: string | null;
  leg_route_origin: string | null;
  leg_route_destination: string | null;
  leg_current_price: number | null;
}

interface RawOutreachJoinRow extends EmptyLegNotificationRow {
  lead_inquiries: {
    customer_name: string | null;
    customer_phone: string | null;
  } | null;
  empty_legs: {
    leg_number: string;
    departure_airport: string | null;
    departure_airport_freeform_snapshot: string | null;
    arrival_airport: string | null;
    arrival_airport_freeform_snapshot: string | null;
    current_price: number | null;
  } | null;
}

export async function listPendingOutreach(
  limit = 200
): Promise<OutreachQueueRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(NOTIFICATIONS_TABLE)
    .select(
      `
        *,
        lead_inquiries:lead_inquiry_id ( customer_name, customer_phone ),
        empty_legs:leg_id ( leg_number, departure_airport, departure_airport_freeform_snapshot, arrival_airport, arrival_airport_freeform_snapshot, current_price )
      `
    )
    .is('outreach_sent_at', null)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[empty-legs] listPendingOutreach failed', error);
    throw new Error(`listPendingOutreach failed: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as RawOutreachJoinRow[];
  return rows.map((row) => ({
    ...(row as EmptyLegNotificationRow),
    lead_customer_name: row.lead_inquiries?.customer_name ?? null,
    lead_customer_phone: row.lead_inquiries?.customer_phone ?? null,
    leg_number: row.empty_legs?.leg_number ?? null,
    leg_route_origin:
      row.empty_legs?.departure_airport ??
      row.empty_legs?.departure_airport_freeform_snapshot ??
      null,
    leg_route_destination:
      row.empty_legs?.arrival_airport ??
      row.empty_legs?.arrival_airport_freeform_snapshot ??
      null,
    leg_current_price: row.empty_legs?.current_price ?? null,
  }));
}

export async function countPendingOutreachOlderThan24h(): Promise<number> {
  noStore();
  const client = createAdminClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from(NOTIFICATIONS_TABLE)
    .select('id', { count: 'exact', head: true })
    .is('outreach_sent_at', null)
    .lt('sent_at', cutoff);

  if (error) {
    console.error('[empty-legs] countPendingOutreachOlderThan24h failed', error);
    throw new Error(`countPendingOutreachOlderThan24h failed: ${error.message}`);
  }
  return count ?? 0;
}

export async function getOutreachAlertStatus(): Promise<EmptyLegOutreachAlertStatusRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(ALERT_STATUS_TABLE)
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.error('[empty-legs] getOutreachAlertStatus failed', error);
    throw new Error(`getOutreachAlertStatus failed: ${error.message}`);
  }
  return (data as EmptyLegOutreachAlertStatusRow | null) ?? null;
}
