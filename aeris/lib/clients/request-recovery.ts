import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Abandoned trip-request recovery — candidate source.
 *
 * Candidate selection lives in the `list_recoverable_trip_requests` SECURITY
 * DEFINER RPC, which anti-joins `trip_request_recovery_reminders` so
 * already-reminded requests are excluded BEFORE the limit (no starvation), and
 * filters on `updated_at` (no activity for the stale window). RLS is deny-all on
 * the reminders table; the cron is the only caller, through the service-role
 * client.
 */
function looseDb(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type RecoverableRequest = {
  trip_request_id: string;
  request_number: string;
  departure_airport: string | null;
  arrival_airport: string | null;
  client_id: string;
  client_full_name: string;
  client_auth_email: string;
  client_contact_phone: string;
};

/**
 * Client-owned trip_requests stuck at `offered` with no activity for
 * `staleHours` that have NOT already been reminded. Oldest-inactive first.
 */
export async function listRecoverableRequests(
  staleHours = 24,
  limit = 500
): Promise<RecoverableRequest[]> {
  const staleBefore = new Date(Date.now() - staleHours * 3600_000).toISOString();
  const { data, error } = await looseDb().rpc('list_recoverable_trip_requests', {
    p_stale_before: staleBefore,
    p_limit: limit,
  });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as RecoverableRequest[];
}
