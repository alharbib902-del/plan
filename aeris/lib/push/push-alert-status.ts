// Server-side ONLY (same rationale as lib/notifications/*-alert-status.ts):
// imported from the PR3b sender; the test passes a fake admin client.
import type { SupabaseClient } from '@supabase/supabase-js';

import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

// client_push_alert_status is new (not yet in the hand-maintained
// types/database.ts), so reach it via the house loose-client cast; the
// DB-compat checker is the compensating control.
function loose(client: AdminClient): SupabaseClient {
  return client as unknown as SupabaseClient;
}

/**
 * Push PR3a — write + read helpers for the `client_push_alert_status`
 * singleton. A SEPARATE ops-health channel from
 * client_empty_leg_alert_status (Resend) — this card represents FCM push
 * health. Mirrors the existing singleton pattern: a single row (id=1) updated
 * via the service-role admin client (RLS deny-all is bypassed by service_role).
 *
 * Caller pattern (fire-and-forget after a push send, PR3b):
 *   await recordClientPushAlertStatus(admin, { ok: false, reason: 'send_failed',
 *     detail: 'FCM 503' }, 'empty-leg-push:price_dropped');
 */

export type PushAlertResult =
  | { ok: true }
  | { ok: false; reason: 'config_missing' | 'send_failed'; detail: string };

export interface ClientPushAlertStatusRow {
  id: 1;
  status: 'healthy' | 'config_missing' | 'send_failed';
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string;
}

export async function recordClientPushAlertStatus(
  client: AdminClient,
  result: PushAlertResult,
  contextLabel: string
): Promise<void> {
  try {
    const db = loose(client);
    if (result.ok) {
      await db
        .from('client_push_alert_status')
        .update({ status: 'healthy', updated_at: new Date().toISOString() })
        .eq('id', 1);
    } else {
      const status =
        result.reason === 'config_missing' ? 'config_missing' : 'send_failed';
      const reasonLabel = `${contextLabel}: ${result.reason} — ${result.detail}`;
      await db
        .from('client_push_alert_status')
        .update({
          status,
          last_failure_at: new Date().toISOString(),
          last_failure_reason: reasonLabel,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
      console.error(
        `[client-push-alert] ${contextLabel} push failed: ${result.reason} — ${result.detail}`
      );
    }
  } catch (err) {
    console.error('[client-push-alert] update failed', err);
  }
}

export async function getClientPushAlertStatus(
  client: AdminClient
): Promise<ClientPushAlertStatusRow | null> {
  try {
    const { data, error } = await loose(client)
      .from('client_push_alert_status')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      console.error('[client-push-alert] read failed', error);
      return null;
    }
    return (data ?? null) as ClientPushAlertStatusRow | null;
  } catch (err) {
    console.error('[client-push-alert] read threw', err);
    return null;
  }
}
