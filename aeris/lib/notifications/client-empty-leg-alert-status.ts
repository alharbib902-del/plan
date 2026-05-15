// Server-side ONLY — same rationale as lib/empty-legs/notifications.ts:
// the test:empty-legs-matching Layer-1 test runs under tsx outside
// Next.js where the 'server-only' shim is not resolvable. Surface
// contract is enforced at the call site (only imported from Server
// Actions + the matcher's client-loop email helpers).

import type { createAdminClient } from '@/lib/supabase/admin';

import type { ClientEmailDeliveryResult } from './client-email';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Phase 10 PR 1 — write + read helpers for the
 * `client_empty_leg_alert_status` singleton (§3.6).
 *
 * Mirror of `lib/notifications/client-email-alert-status.ts`
 * (Phase 9 PR 1) but bound to the empty-leg-specific singleton.
 * Round 5 P2 #4 + round 7 P1 #2: this surface covers BOTH
 * client empty-leg match emails AND client empty-leg
 * reservation-confirmation emails. The single canary card
 * "بريد العملاء — عرض رحلة فارغة (Resend)" represents Resend
 * health for all client empty-leg emails (mirrors the Phase 7
 * `empty_leg_outreach_alert_status` pattern that covers all
 * guest empty-leg outreach emails through one card).
 *
 * Caller pattern (fire-and-forget after every Resend send):
 *
 *   const result = await sendViaResend(...);
 *   await recordClientEmptyLegAlertStatus(
 *     getServiceRoleClient(),
 *     result,
 *     'empty-leg-match:new_leg'  // or 'empty-leg-reservation:confirm'
 *   );
 *   return result;
 *
 * The contextLabel identifies the surface for last_failure_reason
 * so admins can tell at a glance whether match dispatch or
 * reservation confirmation is the broken channel.
 */

export interface ClientEmptyLegAlertStatusRow {
  id: 1;
  status: 'healthy' | 'config_missing' | 'send_failed';
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string;
}

export async function recordClientEmptyLegAlertStatus(
  client: AdminClient,
  result: ClientEmailDeliveryResult,
  contextLabel: string
): Promise<void> {
  try {
    if (result.ok) {
      await client
        .from('client_empty_leg_alert_status')
        .update({ status: 'healthy', updated_at: new Date().toISOString() })
        .eq('id', 1);
    } else {
      const status =
        result.reason === 'env_missing' ? 'config_missing' : 'send_failed';
      const reasonLabel = `${contextLabel}: ${result.reason} — ${result.detail}`;
      await client
        .from('client_empty_leg_alert_status')
        .update({
          status,
          last_failure_at: new Date().toISOString(),
          last_failure_reason: reasonLabel,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
      console.error(
        `[client-empty-leg-alert] ${contextLabel} email failed: ${result.reason} — ${result.detail}`
      );
    }
  } catch (err) {
    console.error('[client-empty-leg-alert] update failed', err);
  }
}

export async function getClientEmptyLegAlertStatus(
  client: AdminClient
): Promise<ClientEmptyLegAlertStatusRow | null> {
  try {
    const { data, error } = await client
      .from('client_empty_leg_alert_status')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      console.error('[client-empty-leg-alert] read failed', error);
      return null;
    }
    return (data ?? null) as ClientEmptyLegAlertStatusRow | null;
  } catch (err) {
    console.error('[client-empty-leg-alert] read threw', err);
    return null;
  }
}
