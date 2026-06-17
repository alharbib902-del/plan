import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';

import {
  parseClaimResult,
  parseMarkResult,
  type ClaimResult,
  type MarkResult,
} from './delivery-parse';

/**
 * Push PR3a — client_push_deliveries claim/mark/list wrappers (service_role
 * RPCs). DB-layer ONLY: no FCM, no sending. The claim→send→mark lifecycle
 * lives in SQL (concurrency-safe + retry-aware); these are thin callers that
 * delegate envelope parsing to the (tsx-testable) delivery-parse module.
 *
 * The SQL claim/concurrency behavior (fresh/concurrent/stale/due-retry/
 * exhausted) is verified by the migration design + the audit:db gate, not the
 * no-DB tsx harness.
 */

export type PushDeliveryStatus =
  | 'claimed'
  | 'sent'
  | 'failed_transient'
  | 'failed_permanent';

export type { ClaimResult, MarkResult } from './delivery-parse';

/** Claim (or due-retry) the single push for (client, leg, event). */
export async function claimPushDelivery(
  clientId: string,
  legId: string,
  eventType: 'published' | 'price_dropped'
): Promise<ClaimResult> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin.rpc('claim_client_push_delivery', {
    p_client_id: clientId,
    p_leg_id: legId,
    p_event_type: eventType,
  });
  if (error) console.error('[push.claim] rpc error', error);
  return parseClaimResult(data, error);
}

/** Finalize a delivery: 'sent' | 'failed_transient' (with next_retry_at) |
 *  'failed_permanent'. A failed mark on an already-'sent' row is an idempotent
 *  no-op server-side (the terminal 'sent' is never downgraded). */
export async function markPushDelivery(
  deliveryId: string,
  status: 'sent' | 'failed_transient' | 'failed_permanent',
  opts?: { lastError?: string; nextRetryAt?: string }
): Promise<MarkResult> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin.rpc('mark_client_push_delivery', {
    p_delivery_id: deliveryId,
    p_status: status,
    p_last_error: opts?.lastError ?? null,
    p_next_retry_at: opts?.nextRetryAt ?? null,
  });
  if (error) console.error('[push.mark] rpc error', error);
  return parseMarkResult(data, error);
}

/** Due 'failed_transient' rows under the cap (future retry sweep). Returns []
 *  on any fault — a retry sweep must never throw. */
export async function listRetryablePushDeliveries(
  limit = 100
): Promise<unknown[]> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin.rpc('list_retryable_push_deliveries', {
    p_limit: limit,
  });
  if (error) {
    console.error('[push.list] rpc error', error);
    return [];
  }
  return Array.isArray(data) ? data : [];
}
