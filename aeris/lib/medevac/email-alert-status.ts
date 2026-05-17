import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 12 PR 3 — write + read helpers for the
 * `medevac_email_alert_status` singleton (PR 1 §3.9).
 *
 * Mirror of `lib/cargo/email-alert-status.ts`. The 7th
 * `<ChannelHealth>` card on /admin/operators/canary reads
 * via `getMedevacEmailAlertStatus()`; both
 * `lib/medevac/notifications.ts` (operator dispatch emails)
 * and `lib/medevac/founder-sla-escalation-email.ts` write
 * via `recordMedevacEmailAlertStatus()` after every Resend
 * send. RLS-enabled with no public policies, so direct REST
 * reads are blocked — only the service-role helpers below
 * can touch the row.
 */

export interface MedevacEmailAlertStatusRow {
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

export async function recordMedevacEmailAlertStatus(
  args: RecordArgs
): Promise<void> {
  try {
    type LooseUpdate = {
      from: (table: string) => {
        update: (payload: Record<string, unknown>) => {
          eq: (
            col: string,
            val: number
          ) => Promise<{
            data: unknown;
            error: { message?: string } | null;
          }>;
        };
      };
    };
    const loose = createAdminClient() as unknown as LooseUpdate;
    const nowIso = new Date().toISOString();
    if (args.status === 'healthy') {
      await loose
        .from('medevac_email_alert_status')
        .update({ status: 'healthy', updated_at: nowIso })
        .eq('id', 1);
    } else {
      await loose
        .from('medevac_email_alert_status')
        .update({
          status: args.status,
          last_failure_at: nowIso,
          last_failure_reason: args.reason
            ? args.reason.slice(0, 200)
            : null,
          updated_at: nowIso,
        })
        .eq('id', 1);
    }
  } catch (err) {
    console.error('[medevac-email-alert] update failed', err);
  }
}

export async function getMedevacEmailAlertStatus(): Promise<MedevacEmailAlertStatusRow | null> {
  try {
    type LooseSelect = {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (
            col: string,
            val: number
          ) => {
            maybeSingle: () => Promise<{
              data: unknown;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
    const loose = createAdminClient() as unknown as LooseSelect;
    const { data, error } = await loose
      .from('medevac_email_alert_status')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      console.error('[medevac-email-alert] read failed', error);
      return null;
    }
    return (data ?? null) as MedevacEmailAlertStatusRow | null;
  } catch (err) {
    console.error('[medevac-email-alert] read threw', err);
    return null;
  }
}
