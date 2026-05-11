import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

import type { EmailDeliveryResult } from './operator-email';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Phase 8.1 — extracted from operators-public.ts so that BOTH
 * the public signup/reset Server Actions AND the admin
 * approve/reset Server Actions in operators.ts can update the
 * singleton alert row using the same shape.
 *
 * Phase 8 PR 2c chunk 2 introduced this updater inline inside
 * operators-public.ts (the only caller at that time). PR 2b's
 * adminApproveOperator + adminResetOperatorPassword paths in
 * operators.ts SEND emails but never touched the alert table —
 * a real gap that left the admin banner silent for admin-side
 * delivery failures. Lifting the helper out makes both surfaces
 * uniform without behaviour change for existing callers.
 *
 * The function:
 *   - UPDATEs the singleton row at id=1 (seeded by the §3.10
 *     migration, never INSERTs).
 *   - Restores 'healthy' on success so the banner clears once
 *     the env var lands or Resend recovers.
 *   - Maps EmailDeliveryResult.reason to the CHECK-constrained
 *     enum: 'env_missing' → 'config_missing', everything else →
 *     'send_failed'.
 *   - Logs + swallows DB errors so an alert-update failure
 *     never breaks the parent Server Action.
 */
export async function recordEmailAlertStatus(
  client: AdminClient,
  result: EmailDeliveryResult,
  contextLabel: string
): Promise<void> {
  try {
    if (result.ok) {
      await client
        .from('operator_notification_alert_status')
        .update({ status: 'healthy', updated_at: new Date().toISOString() })
        .eq('id', 1);
    } else {
      const status =
        result.reason === 'env_missing' ? 'config_missing' : 'send_failed';
      const reasonLabel = `${contextLabel}: ${result.reason}`;
      await client
        .from('operator_notification_alert_status')
        .update({
          status,
          last_failure_at: new Date().toISOString(),
          last_failure_reason: reasonLabel,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
      console.error(
        `[operator-notification-alert] ${contextLabel} email failed: ${result.reason}`
      );
    }
  } catch (err) {
    console.error('[operator-notification-alert] email update failed', err);
  }
}
