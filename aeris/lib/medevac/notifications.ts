// Server-side ONLY.

import { Resend } from 'resend';

import type {
  MedevacRequestRow,
  MedevacRequestRedactedRow,
} from '@/lib/medevac/types';

import { recordMedevacEmailAlertStatus } from './email-alert-status';

/**
 * Phase 12 PR 3 §4.1 — operator-facing medevac dispatch
 * notifications.
 *
 * Mirrors `lib/cargo/notifications.ts` discipline, with D8 (b)
 * PII redaction: operators see MEV-XXXX + service_level +
 * condition_severity + route ONLY while preparing offers.
 * patient_name / patient_age are NEVER included in the email
 * subject, body, OR the wa.me message — they're only revealed
 * post-acceptance via the bookings.customer_name_snapshot copy
 * (D8 (c) transition gate).
 *
 * Two channels per spec:
 *   - wa.me click-to-chat link (no WhatsApp API)
 *   - Resend email with RTL Arabic body + CTA →
 *     /operator/medevac/[id]/offer
 *
 * `sent` flag honest signal (Phase 11 round 1 PR #73 P1 #3
 * pattern): TRUE iff Resend succeeded. wa.me URL is audit
 * metadata only.
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

const SEVERITY_AR: Record<string, string> = {
  stable: 'مستقر',
  moderate: 'متوسط',
  critical: 'حرج',
};

const SERVICE_AR: Record<string, string> = {
  BMT: 'النقل الطبي الأساسي (BMT)',
  ALS: 'دعم الحياة المتقدم (ALS)',
  CCT: 'الرعاية الحرجة (CCT)',
  repatriation: 'إعادة عبر الحدود',
};

/**
 * The redacted projection a notification ever sees. Either
 * a full MedevacRequestRow OR a redacted row works; we only
 * read the safe fields.
 */
type RequestForNotify = Pick<
  MedevacRequestRow,
  | 'id'
  | 'medevac_request_number'
  | 'service_level'
  | 'condition_severity'
  | 'from_location_freeform'
  | 'from_iata'
  | 'to_hospital_name'
  | 'to_iata'
>;

function routeLabel(req: RequestForNotify): string {
  const dep = req.from_iata ?? req.from_location_freeform ?? '—';
  const arr = req.to_iata ?? req.to_hospital_name ?? '—';
  return `${dep} → ${arr}`;
}

// ============================================================
// buildOperatorWhatsAppLink — pure
// ============================================================

export interface BuildWhatsAppArgs {
  operator_phone: string;
  medevac_request: RequestForNotify;
  offer_form_url: string;
}

export function buildOperatorWhatsAppLink(args: BuildWhatsAppArgs): string {
  const { medevac_request: req, offer_form_url } = args;
  const severity = SEVERITY_AR[req.condition_severity] ?? req.condition_severity;
  const message = [
    `طلب إخلاء طبي جديد على Aeris:`,
    `• المرجع: ${req.medevac_request_number}`,
    `• الحالة: ${severity}`,
    `• مستوى الخدمة: ${req.service_level}`,
    `• المسار: ${routeLabel(req)}`,
    ``,
    `قدّم عرضك: ${offer_form_url}`,
  ].join('\n');
  const digits = args.operator_phone.replace(/\D+/g, '');
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${digits}?text=${encoded}`;
}

// ============================================================
// buildOperatorMedevacEmail — pure
// ============================================================

export interface BuildEmailArgs {
  medevac_request: RequestForNotify;
  offer_form_url: string;
}

export interface MedevacEmailContent {
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
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0A1628;border:1px solid rgba(244,63,94,0.25);border-radius:14px;padding:32px">
          <tr><td>
            <div style="font-family:'Playfair Display',serif;letter-spacing:0.28em;color:#FCA5A5;font-size:22px">AERIS MEDEVAC</div>
            <h1 style="margin:18px 0 12px;font-size:22px;color:#FAFAFA;font-weight:600">${escapeHtml(opts.heading)}</h1>
            <div style="margin-top:16px;color:#A8B2C1;font-size:15px;line-height:1.7">${opts.body}</div>
            <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:24px">
              <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;padding:14px 28px;background:#F43F5E;color:#FFFFFF;text-decoration:none;font-weight:600;border-radius:10px;font-size:15px">${escapeHtml(opts.ctaLabel)}</a>
            </td></tr></table>
            <p style="margin:32px 0 0;color:#6B7A8F;font-size:12px;text-align:center">
              فريق Aeris MedEvac · aeris.sa
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function buildOperatorMedevacEmail(
  args: BuildEmailArgs
): MedevacEmailContent {
  const { medevac_request: req, offer_form_url } = args;
  const severity = SEVERITY_AR[req.condition_severity] ?? req.condition_severity;
  const serviceLabel = SERVICE_AR[req.service_level] ?? req.service_level;
  const subject = `طلب إخلاء طبي جديد — ${severity} | ${req.medevac_request_number}`;
  // D8 (b): no patient_name / age / contact in the body.
  const bodyHtml = `
    <p>وصلك طلب إخلاء طبي جديد على شبكة Aeris MedEvac:</p>
    <ul style="padding-inline-start:18px;margin:12px 0">
      <li>المرجع: <strong style="color:#FCA5A5">${escapeHtml(req.medevac_request_number)}</strong></li>
      <li>الحالة: <strong>${escapeHtml(severity)}</strong></li>
      <li>مستوى الخدمة المطلوب: <strong>${escapeHtml(serviceLabel)}</strong></li>
      <li>المسار: <strong>${escapeHtml(routeLabel(req))}</strong></li>
    </ul>
    <p>اضغط الزر أدناه لتقديم عرضك (السعر + التواريخ + الطائرة المعتمدة طبياً).</p>
    <p style="margin-top:16px;color:#6B7A8F;font-size:13px">
      بيانات المريض (الاسم والعمر) لا تظهر في هذا الإشعار — تتاح فقط
      بعد قبول العميل لعرضك (D8 PII minimization policy).
    </p>`;
  const html = shellHtml({
    preheader: `طلب إخلاء طبي — ${severity} — ${routeLabel(req)}`,
    heading: 'طلب إخلاء طبي جديد',
    body: bodyHtml,
    ctaUrl: offer_form_url,
    ctaLabel: 'تقديم العرض الطبي',
  });
  const text = [
    'طلب إخلاء طبي جديد على Aeris MedEvac:',
    `• المرجع: ${req.medevac_request_number}`,
    `• الحالة: ${severity}`,
    `• مستوى الخدمة: ${serviceLabel}`,
    `• المسار: ${routeLabel(req)}`,
    '',
    `قدّم عرضك: ${offer_form_url}`,
    '',
    'بيانات المريض مُخفَّاة حتى قبول العميل لعرضك (D8).',
    '',
    'فريق Aeris MedEvac',
  ].join('\n');
  return { subject, html, text };
}

// ============================================================
// notifyOperatorOfMedevac — combined sender
// ============================================================

export interface NotifyOperatorArgs {
  operator_id: string;
  operator_email: string | null;
  operator_phone: string | null;
  /**
   * Either a full MedevacRequestRow or a redacted projection
   * — only safe fields are read (per D8 (b)). PII fields
   * (patient_name_snapshot, patient_age_snapshot, etc.) are
   * NEVER referenced here even if present on the input.
   */
  medevac_request: RequestForNotify | MedevacRequestRedactedRow;
}

export interface NotifyOperatorResult {
  sent: boolean;
  channels_attempted: Array<'email'>;
  channels_succeeded: Array<'email'>;
  whatsapp_link_url: string | null;
}

export async function notifyOperatorOfMedevac(
  args: NotifyOperatorArgs
): Promise<NotifyOperatorResult> {
  const req = args.medevac_request as RequestForNotify;
  const offerUrl = `${siteUrl()}/operator/medevac/${req.id}/offer`;
  const result: NotifyOperatorResult = {
    sent: false,
    channels_attempted: [],
    channels_succeeded: [],
    whatsapp_link_url: null,
  };

  if (args.operator_phone) {
    result.whatsapp_link_url = buildOperatorWhatsAppLink({
      operator_phone: args.operator_phone,
      medevac_request: req,
      offer_form_url: offerUrl,
    });
  }

  const creds = envCredentials();
  if (!creds) {
    await recordMedevacEmailAlertStatus({
      status: 'config_missing',
      reason: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set',
    });
    return result;
  }
  if (!args.operator_email) {
    return result;
  }

  result.channels_attempted.push('email');
  try {
    const resend = new Resend(creds.apiKey);
    const content = buildOperatorMedevacEmail({
      medevac_request: req,
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
      console.error('[medevac.notifications] Resend send error', error);
      await recordMedevacEmailAlertStatus({
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
    await recordMedevacEmailAlertStatus({ status: 'healthy' });
  } catch (err) {
    console.error('[medevac.notifications] Resend threw', err);
    await recordMedevacEmailAlertStatus({
      status: 'send_failed',
      reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
  }
  return result;
}
