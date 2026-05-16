// Server-side ONLY — same rationale as Phase 7/10 notification
// helpers: this module is imported from the cargo dispatch-drain
// cron route + (future) tests; the 'server-only' shim isn't
// resolvable in tsx Layer-1 tests.

import { Resend } from 'resend';

import { whatsappLink } from '@/lib/utils/format';
import type { CargoRequestRow } from '@/lib/cargo/types';

import { recordCargoEmailAlertStatus } from './email-alert-status';

/**
 * Phase 11 PR 3 §4.1 — operator-facing cargo dispatch notifications.
 *
 * Two channels per spec:
 *   - WhatsApp wa.me link (click-to-chat; NO WhatsApp API).
 *     Aeris pattern is "click-to-chat" links that pre-fill the
 *     operator's message; operator taps and the WA client opens.
 *   - Resend email with RTL Arabic body + CTA button linking to
 *     /operator/cargo/[id]/offer.
 *
 * The combined sender `notifyOperatorOfCargo()` attempts both
 * channels independently:
 *   - Email failure → recordCargoEmailAlertStatus('send_failed')
 *     + return { sent: true, channel: 'whatsapp_link' } if the
 *     wa.me link was buildable
 *   - Email success → recordCargoEmailAlertStatus('healthy') +
 *     return { sent: true, channel: 'email' }
 *
 * The cron drain loop calls this once per dispatched operator
 * and treats `sent: false` as a 'notify_failed' skip_reason
 * (per spec §5.3).
 *
 * Env: RESEND_API_KEY + RESEND_FROM_EMAIL (shared with the
 * Phase 7/9/10 pipelines — same Resend account; per-surface
 * health tracked via cargo_email_alert_status singleton).
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function envCredentials(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa';
}

const CARGO_TYPE_AR: Record<string, string> = {
  horse: 'خيول',
  luxury_car: 'سيارات فاخرة',
  valuables: 'بضائع ثمينة',
  other: 'بضائع متخصصة',
};

function routeLabel(req: CargoRequestRow): string {
  const dep = req.origin_iata ?? req.origin_freeform ?? '—';
  const arr = req.destination_iata ?? req.destination_freeform ?? '—';
  return `${dep} → ${arr}`;
}

// ============================================================
// buildOperatorWhatsAppLink — pure
// ============================================================

export interface BuildWhatsAppArgs {
  operator_phone: string;
  cargo_request: CargoRequestRow;
  offer_form_url: string;
}

export function buildOperatorWhatsAppLink(args: BuildWhatsAppArgs): string {
  const { cargo_request: req, offer_form_url } = args;
  const cargoType = CARGO_TYPE_AR[req.cargo_type] ?? req.cargo_type;
  const message = [
    `طلب شحن جديد على Aeris:`,
    `• الفئة: ${cargoType}`,
    `• المسار: ${routeLabel(req)}`,
    `• تاريخ الاستلام: ${req.pickup_date ?? '—'}`,
    `• القيمة التقديرية: ${req.estimated_value_sar ?? '—'} ريال`,
    ``,
    `قدّم عرضك: ${offer_form_url}`,
  ].join('\n');
  // whatsappLink ignores the operator_phone arg in favor of the
  // default support phone in lib/utils/format.ts. We build the
  // URL manually so the link routes to the operator's WhatsApp,
  // not Aeris support.
  const digits = args.operator_phone.replace(/\D+/g, '');
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${digits}?text=${encoded}`;
}

// ============================================================
// buildOperatorCargoEmail — pure
// ============================================================

export interface BuildCargoEmailArgs {
  cargo_request: CargoRequestRow;
  offer_form_url: string;
}

export interface CargoEmailContent {
  subject: string;
  html: string;
  text: string;
}

function shellHtml(opts: {
  preheader: string;
  heading: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
}): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;background:#050B14;font-family:'IBM Plex Sans Arabic','Inter',sans-serif;color:#FAFAFA">
    <span style="display:none;visibility:hidden;opacity:0;height:0;width:0">${escapeHtml(opts.preheader)}</span>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#050B14;padding:24px 0">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0A1628;border:1px solid rgba(201,169,97,0.25);border-radius:14px;padding:32px">
          <tr><td>
            <div style="font-family:'Playfair Display',serif;letter-spacing:0.28em;color:#E8D4A8;font-size:22px">AERIS</div>
            <h1 style="margin:18px 0 12px;font-size:22px;color:#FAFAFA;font-weight:600">${escapeHtml(opts.heading)}</h1>
            <div style="margin-top:16px;color:#A8B2C1;font-size:15px;line-height:1.7">${opts.body}</div>
            <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:24px">
              <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;padding:14px 28px;background:#C9A961;color:#0A1628;text-decoration:none;font-weight:600;border-radius:10px;font-size:15px">${escapeHtml(opts.ctaLabel)}</a>
            </td></tr></table>
            <p style="margin:32px 0 0;color:#6B7A8F;font-size:12px;text-align:center">
              فريق Aeris · aeris.sa
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function buildOperatorCargoEmail(
  args: BuildCargoEmailArgs
): CargoEmailContent {
  const { cargo_request: req, offer_form_url } = args;
  const cargoType = CARGO_TYPE_AR[req.cargo_type] ?? req.cargo_type;
  const subject = `طلب شحن جديد على Aeris — ${cargoType} | ${req.cargo_request_number}`;
  const bodyHtml = `
    <p>وصلك طلب شحن جديد على شبكة Aeris للشحن المتخصص:</p>
    <ul style="padding-inline-start:18px;margin:12px 0">
      <li>الفئة: <strong style="color:#E8D4A8">${escapeHtml(cargoType)}</strong></li>
      <li>المسار: <strong>${escapeHtml(routeLabel(req))}</strong></li>
      <li>تاريخ الاستلام المطلوب: <strong>${escapeHtml(req.pickup_date ?? '—')}</strong></li>
      <li>القيمة التقديرية للشحنة: <strong>${escapeHtml(String(req.estimated_value_sar ?? '—'))} ريال</strong></li>
    </ul>
    <p>اضغط الزر أدناه لتقديم عرضك (السعر + التواريخ + الطائرة المقترحة).</p>`;
  const html = shellHtml({
    preheader: `طلب شحن ${cargoType} — ${routeLabel(req)}`,
    heading: 'طلب شحن جديد',
    body: bodyHtml,
    ctaUrl: offer_form_url,
    ctaLabel: 'تقديم عرض الشحن',
  });
  const text = [
    'طلب شحن جديد على Aeris:',
    `• الفئة: ${cargoType}`,
    `• المسار: ${routeLabel(req)}`,
    `• تاريخ الاستلام: ${req.pickup_date ?? '—'}`,
    `• القيمة التقديرية: ${req.estimated_value_sar ?? '—'} ريال`,
    '',
    `قدّم عرضك: ${offer_form_url}`,
    '',
    'فريق Aeris',
  ].join('\n');
  return { subject, html, text };
}

// ============================================================
// notifyOperatorOfCargo — combined sender
// ============================================================

export interface NotifyOperatorArgs {
  operator_id: string;
  operator_email: string | null;
  operator_phone: string | null;
  cargo_request: CargoRequestRow;
}

/**
 * Round 1 PR #73 P1 #3 fix — `sent` is now an honest signal: it
 * is TRUE iff we actively delivered the notification through a
 * channel that pushes to the operator (currently: Resend email).
 * The wa.me URL is surfaced separately as `whatsapp_link_url`
 * for the cron route to record in `dispatch_result.whatsapp_links`
 * as audit metadata; the operator only sees it if they ALSO
 * received the email (which embeds the same link via the CTA).
 *
 * Earlier behavior counted a built-but-unsent wa.me URL as a
 * successful channel, which let cron mark an operator
 * "dispatched" even when Resend was misconfigured / the operator
 * had no email — in practice the operator received nothing.
 */
export interface NotifyOperatorResult {
  sent: boolean;
  channels_attempted: Array<'email'>;
  channels_succeeded: Array<'email'>;
  whatsapp_link_url: string | null;
}

export async function notifyOperatorOfCargo(
  args: NotifyOperatorArgs
): Promise<NotifyOperatorResult> {
  const offerUrl = `${siteUrl()}/operator/cargo/${args.cargo_request.id}/offer`;
  const result: NotifyOperatorResult = {
    sent: false,
    channels_attempted: [],
    channels_succeeded: [],
    whatsapp_link_url: null,
  };

  // Build the wa.me URL as audit metadata if we have a phone.
  // This is NOT a delivery — operator only follows the link if
  // they ALSO get the email (which embeds it via the CTA) OR if
  // a founder/admin manually shares it from the dispatch log.
  if (args.operator_phone) {
    result.whatsapp_link_url = buildOperatorWhatsAppLink({
      operator_phone: args.operator_phone,
      cargo_request: args.cargo_request,
      offer_form_url: offerUrl,
    });
  }

  // Email — the ONLY active delivery channel today. If creds or
  // target email are missing, return sent=false; the cron route
  // will record the operator under skip_reasons['notify_failed']
  // and the wa.me link remains in dispatch_result.whatsapp_links
  // for audit / manual outreach.
  const creds = envCredentials();
  if (!creds) {
    await recordCargoEmailAlertStatus({
      status: 'config_missing',
      reason: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set',
    });
    return result;
  }
  if (!args.operator_email) {
    // Operator has no email on file → email cannot be sent.
    // We don't flip the singleton (that would mislabel a missing
    // operator email as a Resend-side issue), but the operator
    // does count as notify_failed.
    return result;
  }

  result.channels_attempted.push('email');
  try {
    const resend = new Resend(creds.apiKey);
    const content = buildOperatorCargoEmail({
      cargo_request: args.cargo_request,
      offer_form_url: offerUrl,
    });
    const { error } = await resend.emails.send({
      from: creds.from,
      to: args.operator_email,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    if (error) {
      console.error('[cargo.notifications] Resend send error', error);
      await recordCargoEmailAlertStatus({
        status: 'send_failed',
        reason:
          typeof error === 'string'
            ? error
            : JSON.stringify(error).slice(0, 200),
      });
      return result;
    }
    result.channels_succeeded.push('email');
    result.sent = true;
    await recordCargoEmailAlertStatus({ status: 'healthy' });
  } catch (err) {
    console.error('[cargo.notifications] Resend threw', err);
    await recordCargoEmailAlertStatus({
      status: 'send_failed',
      reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
  }
  return result;
}
