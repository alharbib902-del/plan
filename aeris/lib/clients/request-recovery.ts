import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Abandoned trip-request recovery source queries.
 *
 * `trip_request_recovery_reminders` is NOT in the hand-maintained
 * `types/database.ts`, so we read through a schema-loose view of the
 * service-role client (mirrors lib/empty-legs/alerts.ts). RLS is deny-all on the
 * reminders table; the cron is the only caller.
 */
function looseDb(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type StaleOfferedRequest = {
  id: string;
  request_number: string;
  client_id: string;
  trip_type: string;
  departure_airport: string | null;
  arrival_airport: string | null;
  departure_date: string | null;
  status: string;
  created_at: string;
  clients: {
    id: string;
    full_name: string;
    auth_email: string;
    contact_phone: string;
  } | null;
};

/**
 * Client-owned trip_requests stuck at `offered` (operators have made offers, the
 * client has not booked) and older than `staleHours`. Guest requests (no
 * client_id) are excluded — there is no account to email.
 */
export async function listStaleOfferedRequests(
  staleHours = 24,
  limit = 500
): Promise<StaleOfferedRequest[]> {
  const cutoffIso = new Date(Date.now() - staleHours * 3600_000).toISOString();
  const { data, error } = await looseDb()
    .from('trip_requests')
    .select(
      'id, request_number, client_id, trip_type, departure_airport, arrival_airport, departure_date, status, created_at, clients(id, full_name, auth_email, contact_phone)'
    )
    .eq('status', 'offered')
    .not('client_id', 'is', null)
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  // PostgREST types the to-one `clients(...)` embed as an array; it is a single
  // object at runtime.
  return (data ?? []) as unknown as StaleOfferedRequest[];
}
