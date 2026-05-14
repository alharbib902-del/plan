import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

import type { ClientEmailDeliveryResult } from './client-email';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Phase 9 PR 1 — write + read helpers for the
 * `client_notification_alert_status` singleton.
 *
 * Mirror of `lib/notifications/email-alert-status.ts`
 * (Phase 8.1) but bound to the client-side singleton.
 *
 * The write helper (`recordClientEmailAlertStatus`) is
 * called by every Server Action that ships a Resend email
 * to a client. The read helper
 * (`getClientNotificationAlertStatus`) is consumed by the
 * Phase 8 PR 2e canary page extension (4th ChannelHealth
 * card). Closing the write-only-alert-table gap is the
 * round 1 P2 #1 fix on the Phase 9 spec.
 */

export interface ClientNotificationAlertStatusRow {
  id: 1;
  status: 'healthy' | 'config_missing' | 'send_failed';
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string;
}

export async function recordClientEmailAlertStatus(
  client: AdminClient,
  result: ClientEmailDeliveryResult,
  contextLabel: string
): Promise<void> {
  try {
    if (result.ok) {
      await client
        .from('client_notification_alert_status')
        .update({ status: 'healthy', updated_at: new Date().toISOString() })
        .eq('id', 1);
    } else {
      const status =
        result.reason === 'env_missing' ? 'config_missing' : 'send_failed';
      const reasonLabel = `${contextLabel}: ${result.reason} — ${result.detail}`;
      await client
        .from('client_notification_alert_status')
        .update({
          status,
          last_failure_at: new Date().toISOString(),
          last_failure_reason: reasonLabel,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
      console.error(
        `[client-notification-alert] ${contextLabel} email failed: ${result.reason} — ${result.detail}`
      );
    }
  } catch (err) {
    console.error('[client-notification-alert] update failed', err);
  }
}

export async function getClientNotificationAlertStatus(
  client: AdminClient
): Promise<ClientNotificationAlertStatusRow | null> {
  try {
    const { data, error } = await client
      .from('client_notification_alert_status')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      console.error(
        '[client-notification-alert] read failed',
        error
      );
      return null;
    }
    return (data ?? null) as ClientNotificationAlertStatusRow | null;
  } catch (err) {
    console.error('[client-notification-alert] read threw', err);
    return null;
  }
}
