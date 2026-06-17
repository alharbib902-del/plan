import 'server-only';

import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Push PR1 — device-token registration core (service_role RPCs).
 *
 * Registration ONLY: no sending here. The token identifies a DEVICE; register
 * UPSERTs by the token HASH (re-points it to the current client); unregister
 * removes only the caller's own token (by hash). Uniqueness is on the hash —
 * NOT the raw token — because a btree UNIQUE index can't carry an arbitrarily
 * long token; the hash is hashed in the app (mirroring the session
 * convention), the plaintext token is stored for sending (PR3). The
 * loose-client cast is the house pattern for tables not yet in
 * types/database.ts (the DB-compat checker is the compensating control).
 */

export type DeviceTokenResult = { ok: true } | { ok: false; error: string };

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function envelopeResult(
  data: unknown,
  error: unknown,
  label: string
): DeviceTokenResult {
  if (error) {
    console.error(`[push.${label}] rpc error`, error);
    return { ok: false, error: 'rpc_failed' };
  }
  const env = data as { ok?: boolean; error?: string } | null;
  if (!env?.ok) return { ok: false, error: env?.error ?? 'rpc_failed' };
  return { ok: true };
}

export async function registerDeviceToken(
  clientId: string,
  token: string,
  platform: 'ios' | 'android'
): Promise<DeviceTokenResult> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin.rpc('register_client_device_token', {
    p_client_id: clientId,
    p_token: token,
    p_token_sha256: sha256Hex(token),
    p_platform: platform,
  });
  return envelopeResult(data, error, 'register');
}

export async function unregisterDeviceToken(
  clientId: string,
  token: string
): Promise<DeviceTokenResult> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin.rpc('unregister_client_device_token', {
    p_client_id: clientId,
    p_token_sha256: sha256Hex(token),
  });
  return envelopeResult(data, error, 'unregister');
}
