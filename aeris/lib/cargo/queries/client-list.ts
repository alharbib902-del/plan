import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { CargoRequestRow } from '@/lib/cargo/types';

/**
 * Phase 11 PR 2 — list client's own cargo requests.
 *
 * Service-role read scoped explicitly to `client_id` (defense-
 * in-depth: cargo_requests has RLS but service-role bypasses,
 * so the .eq('client_id', clientId) is the actual gate).
 *
 * Sorts by `pickup_date ASC` so most-urgent surfaces first.
 * Returns at most 100 rows; the portal lists active+recent
 * requests, not full history.
 */
export async function listMyCargoRequests(
  clientId: string
): Promise<CargoRequestRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('cargo_requests')
    .select('*')
    .eq('client_id', clientId)
    .order('pickup_date', { ascending: true })
    .limit(100);

  if (error) {
    console.error('[cargo.client-list] read failed', error);
    throw new Error(`listMyCargoRequests failed: ${error.message}`);
  }

  return (data ?? []) as CargoRequestRow[];
}
