// Server-side ONLY — same rationale as matching.ts.
import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';
import { resolveSiteUrl } from '@/lib/checkout/site-url';

import {
  buildFounderBatchEmailHtml,
  buildFounderBatchEmailSubject,
} from './notification-templates/founder-batch-email';

/**
 * Phase 7 PR 2e — founder batch alert email + visible
 * degraded state on missing config (Codex iteration-4
 * P1 #1 + iteration-5 P2 #2 fixes).
 *
 * Called by `lib/empty-legs/notifications.ts` after a
 * matching cycle writes rows to `empty_leg_notifications`.
 * The module:
 *
 *   1. Resolves the recipient from
 *      `EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO` (preferred) or
 *      `LEAD_NOTIFICATION_TO` (fallback) per spec.
 *   2. Sends ONE Resend email summarizing the new pending
 *      outreach rows for the cycle's leg id.
 *   3. UPDATEs `empty_leg_outreach_alert_status` (singleton
 *      row id = 1) on every attempt:
 *        - missing config → status = 'config_missing'
 *        - send failure   → status = 'send_failed'
 *        - success        → status = 'healthy'
 *   4. Emits a structured `console.error` (captured by
 *      Sentry) on either failure path.
 *
 * Visible degraded state surfaces on the admin
 * `/admin/empty-legs/outreach-queue` page (red banner)
 * via the alert-status singleton. Founder Probe 18
 * gates PR 2e smoke pass on a real Resend email being
 * received.
 */

const ALERT_STATUS_TABLE = 'empty_leg_outreach_alert_status';
const SINGLETON_ID = 1;

export interface SendFounderBatchAlertOptions {
  legId: string;
  legNumber: string;
  rowCount: number;
}

function resolveBatchRecipient(): string | null {
  const primary = process.env.EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO;
  if (primary && primary.trim().length > 0) return primary.trim();

  const fallback = process.env.LEAD_NOTIFICATION_TO;
  if (fallback && fallback.trim().length > 0) return fallback.trim();

  return null;
}

function resolveResendFrom(): string {
  const fromEnv = process.env.RESEND_FROM_EMAIL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return 'noreply@aeris.sa';
}

async function updateAlertStatus(
  status: 'healthy' | 'config_missing' | 'send_failed',
  failureReason: string | null
): Promise<void> {
  const client = createAdminClient();
  const update =
    status === 'healthy'
      ? {
          status,
          last_failure_at: null as string | null,
          last_failure_reason: null as string | null,
        }
      : {
          status,
          last_failure_at: new Date().toISOString(),
          last_failure_reason: failureReason,
        };
  const { error } = await client
    .from(ALERT_STATUS_TABLE)
    .update(update)
    .eq('id', SINGLETON_ID);
  if (error) {
    console.error(
      '[empty-legs.founder-batch] alert-status update failed',
      error
    );
  }
}

export async function sendFounderBatchAlert(
  input: SendFounderBatchAlertOptions
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const recipient = resolveBatchRecipient();

  if (!apiKey || !recipient) {
    // Codex iteration-5 P2 #2: visible degraded state.
    // Structured error → Sentry. Singleton update →
    // admin queue red banner.
    console.error('[empty-legs.founder-batch] config missing', {
      resend_api_key: Boolean(apiKey),
      batch_to: Boolean(recipient),
    });
    await updateAlertStatus(
      'config_missing',
      !apiKey
        ? 'RESEND_API_KEY is missing or empty'
        : 'EMPTY_LEGS_FOUNDER_BATCH_EMAIL_TO and LEAD_NOTIFICATION_TO are both missing'
    );
    return;
  }

  const siteUrl = resolveSiteUrl();
  const queueUrl = `${siteUrl}/admin/empty-legs/outreach-queue`;
  const html = buildFounderBatchEmailHtml({
    legId: input.legId,
    legNumber: input.legNumber,
    rowCount: input.rowCount,
    outreachQueueUrl: queueUrl,
  });
  const subject = buildFounderBatchEmailSubject({
    legId: input.legId,
    legNumber: input.legNumber,
    rowCount: input.rowCount,
    outreachQueueUrl: queueUrl,
  });

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: resolveResendFrom(),
      to: recipient,
      subject,
      html,
    });
    if (error) {
      console.error('[empty-legs.founder-batch] Resend error', error);
      await updateAlertStatus('send_failed', String(error.message ?? error));
      return;
    }
    await updateAlertStatus('healthy', null);
  } catch (err) {
    console.error('[empty-legs.founder-batch] send threw', err);
    await updateAlertStatus(
      'send_failed',
      err instanceof Error ? err.message : String(err)
    );
  }
}
