import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

import type { WhatsAppDeliveryResult } from './whatsapp-provider';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Phase 8.1 — mirror of recordEmailAlertStatus for the
 * wasenderapi.com WhatsApp channel.
 *
 * Updates three new columns added by the
 * 20260514000023_phase_8_1_whatsapp_alert_status migration:
 *   - whatsapp_status            ('healthy' | 'config_missing'
 *                                 | 'send_failed' | 'rate_limited')
 *   - whatsapp_last_failure_at   TIMESTAMPTZ
 *   - whatsapp_last_failure_reason TEXT
 *
 * The reason enum is wider than the email enum: it carries a
 * dedicated 'rate_limited' bucket so the founder can distinguish
 * "we throttled ourselves to protect the trial" from "wasender
 * rejected our request". The provider's in-memory guard fires
 * 'rate_limited' without a network call; the API can also fire
 * it via HTTP 429.
 *
 * Same DB-error handling as the email helper: log + swallow so
 * an alert-update failure never breaks the parent action.
 */
export async function recordWhatsAppAlertStatus(
  client: AdminClient,
  result: WhatsAppDeliveryResult,
  contextLabel: string
): Promise<void> {
  try {
    if (result.ok) {
      await client
        .from('operator_notification_alert_status')
        .update({
          whatsapp_status: 'healthy',
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
    } else {
      const status = mapReasonToStatus(result.reason);
      const reasonLabel = `${contextLabel}: ${result.reason} — ${result.detail}`;
      await client
        .from('operator_notification_alert_status')
        .update({
          whatsapp_status: status,
          whatsapp_last_failure_at: new Date().toISOString(),
          whatsapp_last_failure_reason: reasonLabel,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
      console.error(
        `[operator-notification-alert] ${contextLabel} whatsapp failed: ${result.reason} — ${result.detail}`
      );
    }
  } catch (err) {
    console.error('[operator-notification-alert] whatsapp update failed', err);
  }
}

function mapReasonToStatus(
  reason: 'config_missing' | 'invalid_phone' | 'rate_limited' | 'send_failed'
): 'config_missing' | 'send_failed' | 'rate_limited' {
  // 'invalid_phone' is a per-recipient data-quality issue, not
  // a system-wide degradation. Surface it as 'send_failed' so
  // the banner draws attention but it does not get a dedicated
  // bucket — the founder fixes the operators row, not the
  // wasender config.
  if (reason === 'config_missing') return 'config_missing';
  if (reason === 'rate_limited') return 'rate_limited';
  return 'send_failed';
}
