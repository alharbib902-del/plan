// Server-side ONLY — same rationale as Phase 7/10 email-alert-status
// helpers. Imported from cargo notifications + founder-batch-email +
// the 6th canary card reader.

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 11 PR 3 — write + read helpers for the
 * `cargo_email_alert_status` singleton (PR 1 §3.6).
 *
 * Mirror of `lib/notifications/client-empty-leg-alert-status.ts`
 * (Phase 10 PR 1) but bound to the cargo singleton seeded in
 * PR 1. The 6th `<ChannelHealth>` card on /admin/operators/canary
 * reads from this via getCargoEmailAlertStatus(); both
 * `lib/cargo/notifications.ts` (operator dispatch emails) and
 * `lib/cargo/founder-batch-email.ts` (Decision #10 batch alert)
 * write via recordCargoEmailAlertStatus() after every Resend send.
 */

export interface CargoEmailAlertStatusRow {
  id: 1;
  status: 'healthy' | 'config_missing' | 'send_failed';
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string;
}

export interface RecordArgs {
  status: 'healthy' | 'config_missing' | 'send_failed';
  reason?: string;
}

export async function recordCargoEmailAlertStatus(
  args: RecordArgs
): Promise<void> {
  try {
    const client = createAdminClient();
    const nowIso = new Date().toISOString();
    if (args.status === 'healthy') {
      await client
        .from('cargo_email_alert_status')
        .update({ status: 'healthy', updated_at: nowIso })
        .eq('id', 1);
    } else {
      await client
        .from('cargo_email_alert_status')
        .update({
          status: args.status,
          last_failure_at: nowIso,
          last_failure_reason: args.reason ? args.reason.slice(0, 200) : null,
          updated_at: nowIso,
        })
        .eq('id', 1);
    }
  } catch (err) {
    console.error('[cargo-email-alert] update failed', err);
  }
}

export async function getCargoEmailAlertStatus(): Promise<CargoEmailAlertStatusRow | null> {
  try {
    const client = createAdminClient();
    const { data, error } = await client
      .from('cargo_email_alert_status')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      console.error('[cargo-email-alert] read failed', error);
      return null;
    }
    return (data ?? null) as CargoEmailAlertStatusRow | null;
  } catch (err) {
    console.error('[cargo-email-alert] read threw', err);
    return null;
  }
}
