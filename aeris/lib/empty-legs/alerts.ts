import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

/**
 * Empty Legs price alerts — client-defined subscriptions.
 *
 * `client_empty_leg_alerts` + `empty_leg_alert_deliveries` are NOT in the
 * hand-maintained `types/database.ts`, so we read them through a schema-loose
 * view of the service-role client (mirrors lib/reviews/queries.ts). All client
 * mutations go through the SECURITY DEFINER RPCs (see app/actions); these reads
 * + the cron use the service-role client (RLS is deny-all on both tables).
 */
function looseDb(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type ClientEmptyLegAlertRow = {
  id: string;
  client_id: string;
  origin_iata: string;
  destination_iata: string;
  max_price_sar: number | null;
  date_from: string | null;
  date_to: string | null;
  channels: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ActiveAlertWithClient = ClientEmptyLegAlertRow & {
  clients: {
    id: string;
    full_name: string;
    auth_email: string;
    contact_phone: string;
  } | null;
};

const ALERT_COLUMNS =
  'id, client_id, origin_iata, destination_iata, max_price_sar, date_from, date_to, channels, is_active, created_at, updated_at';

/** Alerts owned by a client, newest first. */
export async function listClientAlerts(clientId: string): Promise<ClientEmptyLegAlertRow[]> {
  const { data, error } = await looseDb()
    .from('client_empty_leg_alerts')
    .select(ALERT_COLUMNS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as ClientEmptyLegAlertRow[];
}

/** Active alerts + the owning client's contact fields (cron source). */
export async function listActiveAlertsWithClient(
  limit = 500
): Promise<ActiveAlertWithClient[]> {
  const { data, error } = await looseDb()
    .from('client_empty_leg_alerts')
    .select(`${ALERT_COLUMNS}, clients(id, full_name, auth_email, contact_phone)`)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  // PostgREST types the `clients(...)` embed as an array; for the to-one
  // alerts.client_id -> clients FK it is a single object at runtime.
  return (data ?? []) as unknown as ActiveAlertWithClient[];
}

/**
 * Available legs matching an alert: same IATA route, within the optional price
 * cap and optional date window (leg departure window intersecting the range).
 */
export async function findMatchingAvailableLegs(
  alert: ClientEmptyLegAlertRow
): Promise<EmptyLegRow[]> {
  let query = looseDb()
    .from('empty_legs')
    .select('*')
    .eq('status', 'available')
    .eq('departure_airport', alert.origin_iata)
    .eq('arrival_airport', alert.destination_iata);

  if (alert.max_price_sar != null) {
    query = query.lte('current_price', alert.max_price_sar);
  }
  // Date-window overlap: leg.[start,end] intersects alert.[from,to].
  if (alert.date_from) {
    query = query.gte('departure_window_end', alert.date_from);
  }
  if (alert.date_to) {
    query = query.lte('departure_window_start', `${alert.date_to}T23:59:59Z`);
  }

  const { data, error } = await query
    .order('current_price', { ascending: true })
    .limit(50);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as EmptyLegRow[];
}

/** The set of empty_leg ids already delivered for an alert (cron dedup). */
export async function listDeliveredLegIds(alertId: string): Promise<Set<string>> {
  const { data, error } = await looseDb()
    .from('empty_leg_alert_deliveries')
    .select('empty_leg_id')
    .eq('alert_id', alertId);
  if (error) {
    throw new Error(error.message);
  }
  return new Set(((data ?? []) as { empty_leg_id: string }[]).map((r) => r.empty_leg_id));
}
