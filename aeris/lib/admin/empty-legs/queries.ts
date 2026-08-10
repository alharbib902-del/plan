import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  EmptyLegRow,
  EmptyLegStatus,
  EmptyLegNotificationRow,
  EmptyLegOutreachAlertStatusRow,
  Phase7OperatorStubRow,
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
  // Count-only head queries (one per chip, in parallel) — the DB
  // returns counts instead of shipping every row to tally in JS.
  // `open` is the derived available+reserved bucket (not a stored status).
  const countFor = async (status: EmptyLegStatus | null): Promise<number> => {
    let query = client.from(TABLE).select('*', { count: 'exact', head: true });
    if (status) query = query.eq('status', status);
    const { count, error } = await query;
    if (error) {
      console.error('[empty-legs] countEmptyLegsByStatus failed', error);
      throw new Error(`countEmptyLegsByStatus failed: ${error.message}`);
    }
    return count ?? 0;
  };

  const [total, available, reserved, sold, expired, cancelled] =
    await Promise.all([
      countFor(null),
      countFor('available'),
      countFor('reserved'),
      countFor('sold'),
      countFor('expired'),
      countFor('cancelled'),
    ]);

  return {
    total,
    available,
    reserved,
    sold,
    expired,
    cancelled,
    open: available + reserved,
  };
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

// ============================================================
// PR 2c — phase7_operator_stubs
// ============================================================

const STUBS_TABLE = 'phase7_operator_stubs';

export async function listActiveOperatorStubs(): Promise<
  Phase7OperatorStubRow[]
> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(STUBS_TABLE)
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[empty-legs] listActiveOperatorStubs failed', error);
    throw new Error(`listActiveOperatorStubs failed: ${error.message}`);
  }
  return (data ?? []) as Phase7OperatorStubRow[];
}

export async function getOperatorStubById(
  id: string
): Promise<Phase7OperatorStubRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(STUBS_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[empty-legs] getOperatorStubById failed', error);
    throw new Error(`getOperatorStubById failed: ${error.message}`);
  }
  return (data as Phase7OperatorStubRow | null) ?? null;
}

// ============================================================
// PR 2c — empty_legs scoped to a single operator_stub_id
// ============================================================

export async function listEmptyLegsForStub(
  stubId: string,
  limit = 200
): Promise<EmptyLegRow[]> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('operator_stub_id', stubId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[empty-legs] listEmptyLegsForStub failed', error);
    throw new Error(`listEmptyLegsForStub failed: ${error.message}`);
  }
  return (data ?? []) as EmptyLegRow[];
}

export async function getEmptyLegByIdAndStub(
  legId: string,
  stubId: string
): Promise<EmptyLegRow | null> {
  noStore();
  const client = createAdminClient();
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('id', legId)
    .eq('operator_stub_id', stubId)
    .maybeSingle();

  if (error) {
    console.error('[empty-legs] getEmptyLegByIdAndStub failed', error);
    throw new Error(`getEmptyLegByIdAndStub failed: ${error.message}`);
  }
  return (data as EmptyLegRow | null) ?? null;
}
