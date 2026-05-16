// Server-side ONLY — imported from cron drain loop.

import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';
import type { CargoRequestRow } from '@/lib/cargo/types';

import { recordCargoEmailAlertStatus } from './email-alert-status';

/**
 * Phase 11 PR 3 §4.2 — founder batch alert when a cargo request
 * is dispatched to the full N=5 operator quota (Decision #10).
 *
 * The helper owns the atomic `cargo_requests.founder_batch_alerted_at`
 * claim (per spec §4.2 + §2.6, Round 1 PR #72 P2 #4 + Round 5
 * PR #72 P2 #1). The drain loop calls this UNCONDITIONALLY
 * whenever 5 operators were dispatched; the helper decides via
 * a single conditional UPDATE whether to actually send.
 *
 * Returns:
 *   - { sent: true }                              on first success
 *   - { sent: false, reason: 'already_alerted' }  if another worker
 *                                                  / prior cron run
 *                                                  won the claim
 *   - { sent: false, reason: 'send_failed' }      if Resend errored
 *                                                  AFTER we won the
 *                                                  claim
 *   - { sent: false, reason: 'config_missing' }   if Resend env
 *                                                  vars unset
 *
 * On Resend failure post-claim the `founder_batch_alerted_at`
 * flag stays set so we don't spam — cargo demand patterns aren't
 * must-deliver; operator-facing notifications are the
 * business-critical channel.
 *
 * Env: RESEND_API_KEY + RESEND_FROM_EMAIL + ADMIN_NOTIFICATION_EMAIL
 * (the recipient of all founder-facing alerts; falls back to
 * RESEND_FROM_EMAIL if unset).
 */

export interface SendFounderCargoArgs {
  cargo_request: CargoRequestRow;
  dispatched_operator_ids: string[];
}

export type SendFounderCargoResult =
  | { sent: true }
  | { sent: false; reason: 'already_alerted' | 'send_failed' | 'config_missing' };

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CARGO_TYPE_AR: Record<string, string> = {
  horse: 'خيول',
  luxury_car: 'سيارات فاخرة',
  valuables: 'بضائع ثمينة',
  other: 'بضائع متخصصة',
};

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa';
}

function adminRecipient(): string | null {
  return (
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    process.env.RESEND_FROM_EMAIL ||
    null
  );
}

export async function sendFounderCargoBatchAlert(
  args: SendFounderCargoArgs
): Promise<SendFounderCargoResult> {
  const admin = createAdminClient();
  const req = args.cargo_request;

  // Step 1 — atomic conditional claim. .is() match yields the row
  // iff founder_batch_alerted_at IS NULL; subsequent UPDATEs see
  // the flag set and the .select() returns nothing.
  //
  // Loose-cast pattern (PR 1 convention): founder_batch_alerted_at
  // was added by the Phase 11 PR 3 migration but is not yet
  // registered in the hand-maintained types/database.ts. Cast
  // the builder so the .update() literal type-checks; runtime
  // behavior is unaffected.
  type LooseUpdate = {
    from: (t: string) => {
      update: (patch: Record<string, unknown>) => {
        eq: (col: string, val: unknown) => {
          is: (col: string, val: unknown) => {
            select: (cols: string) => {
              maybeSingle: () => Promise<{
                data: { id: string } | null;
                error: { message?: string } | null;
              }>;
            };
          };
        };
      };
    };
  };
  const adminLoose = admin as unknown as LooseUpdate;
  const { data: claim, error: claimError } = await adminLoose
    .from('cargo_requests')
    .update({ founder_batch_alerted_at: new Date().toISOString() })
    .eq('id', req.id)
    .is('founder_batch_alerted_at', null)
    .select('id')
    .maybeSingle();

  if (claimError) {
    console.error('[cargo.founder-batch] claim UPDATE failed', claimError);
    return { sent: false, reason: 'send_failed' };
  }
  if (!claim) {
    // Another worker / prior cron run already alerted.
    return { sent: false, reason: 'already_alerted' };
  }

  // Step 2 — env check (after claim so we don't spam claim
  // attempts when the env is misconfigured; the claim still
  // stands so subsequent runs skip).
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = adminRecipient();
  if (!apiKey || !from || !to) {
    console.warn('[cargo.founder-batch] env missing; skipping send');
    return { sent: false, reason: 'config_missing' };
  }

  // Step 3 — send via Resend.
  const cargoType = CARGO_TYPE_AR[req.cargo_type] ?? req.cargo_type;
  const route = `${req.origin_iata ?? req.origin_freeform ?? '—'} → ${req.destination_iata ?? req.destination_freeform ?? '—'}`;
  const adminUrl = `${siteUrl()}/admin/cargo/${req.id}`;
  const subject = `[Aeris Cargo] طلب شحن جديد دُفع إلى ${args.dispatched_operator_ids.length} مشغّل — ${req.cargo_request_number}`;
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;background:#050B14;font-family:'IBM Plex Sans Arabic',sans-serif;color:#FAFAFA">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0A1628;border:1px solid rgba(201,169,97,0.25);border-radius:14px;padding:32px">
          <tr><td>
            <div style="font-family:'Playfair Display',serif;letter-spacing:0.28em;color:#E8D4A8;font-size:22px">AERIS — CARGO</div>
            <h1 style="margin:18px 0 12px;font-size:20px">طلب شحن دُفع للمشغّلين</h1>
            <ul style="padding-inline-start:18px;line-height:1.7;color:#A8B2C1">
              <li>المرجع: <strong style="color:#E8D4A8">${escapeHtml(req.cargo_request_number)}</strong></li>
              <li>الفئة: <strong>${escapeHtml(cargoType)}</strong></li>
              <li>المسار: <strong>${escapeHtml(route)}</strong></li>
              <li>تاريخ الاستلام: <strong>${escapeHtml(req.pickup_date ?? '—')}</strong></li>
              <li>القيمة التقديرية: <strong>${escapeHtml(String(req.estimated_value_sar ?? '—'))} ريال</strong></li>
              <li>عدد المشغّلين الذين تلقّوا الدفع: <strong>${args.dispatched_operator_ids.length}</strong></li>
            </ul>
            <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:24px">
              <a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding:14px 28px;background:#C9A961;color:#0A1628;text-decoration:none;font-weight:600;border-radius:10px">عرض في لوحة Admin</a>
            </td></tr></table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  const text = [
    `طلب شحن دُفع للمشغّلين على Aeris.`,
    ``,
    `المرجع: ${req.cargo_request_number}`,
    `الفئة: ${cargoType}`,
    `المسار: ${route}`,
    `تاريخ الاستلام: ${req.pickup_date ?? '—'}`,
    `القيمة التقديرية: ${req.estimated_value_sar ?? '—'} ريال`,
    `عدد المشغّلين الذين تلقّوا الدفع: ${args.dispatched_operator_ids.length}`,
    ``,
    `عرض في الـ admin: ${adminUrl}`,
  ].join('\n');

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text,
    });
    if (error) {
      console.error('[cargo.founder-batch] Resend send error', error);
      await recordCargoEmailAlertStatus({
        status: 'send_failed',
        reason: `founder-batch: ${typeof error === 'string' ? error : JSON.stringify(error).slice(0, 180)}`,
      });
      return { sent: false, reason: 'send_failed' };
    }
    await recordCargoEmailAlertStatus({ status: 'healthy' });
    return { sent: true };
  } catch (err) {
    console.error('[cargo.founder-batch] Resend threw', err);
    await recordCargoEmailAlertStatus({
      status: 'send_failed',
      reason: `founder-batch: ${err instanceof Error ? err.message.slice(0, 180) : 'unknown'}`,
    });
    return { sent: false, reason: 'send_failed' };
  }
}
