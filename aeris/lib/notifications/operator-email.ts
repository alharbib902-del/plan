import 'server-only';

import { Resend } from 'resend';

/**
 * Phase 8 PR 2b — operator-facing emails sent by the admin
 * Server Actions in `app/actions/operators.ts`. Three flavours:
 *
 *   1. sendOperatorWelcomeEmail — fires after admin approves
 *      a pending operator. Body contains the magic-link URL
 *      bound to the welcome token.
 *   2. sendOperatorRejectionEmail — fires after admin rejects
 *      a pending operator with a reason.
 *   3. sendOperatorPasswordResetEmail — fires after admin
 *      directly resets an operator's password (force-change
 *      on next login).
 *
 * Mirror of `lib/notifications/lead-email.ts`: each function
 * is best-effort (logs on failure, never throws), uses the
 * same Resend env vars (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`),
 * and renders an Arabic-RTL HTML body matching the brand
 * palette.
 */

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa';
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function envCredentials(): { apiKey: string; from: string; to: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return null;
  return { apiKey, from, to: '' };
}

// ============================================================
// Layout helpers
// ============================================================

function shellHtml(opts: {
  preheader: string;
  heading: string;
  body: string;
  ctaUrl?: string;
  ctaLabel?: string;
}): string {
  const cta =
    opts.ctaUrl && opts.ctaLabel
      ? `<tr><td align="center" style="padding-top:24px">
            <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;padding:14px 28px;background:#C9A961;color:#0A1628;text-decoration:none;font-weight:600;border-radius:10px;font-size:15px">${escapeHtml(opts.ctaLabel)}</a>
         </td></tr>`
      : '';

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
            ${cta}
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

// ============================================================
// 1. sendOperatorWelcomeEmail
// ============================================================

export interface SendOperatorWelcomeEmailInput {
  to: string;
  company_name: string;
  welcome_url: string;
  expires_at: Date;
}

export async function sendOperatorWelcomeEmail(
  input: SendOperatorWelcomeEmailInput
): Promise<void> {
  const env = envCredentials();
  if (!env) {
    console.warn('[operator-email] welcome: missing RESEND_API_KEY / RESEND_FROM_EMAIL — skipping send');
    return;
  }

  const expiresLabel = input.expires_at.toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const body = `
    <p style="margin:0 0 12px">مرحباً <strong>${escapeHtml(input.company_name)}</strong>،</p>
    <p style="margin:0 0 12px">تمّ قبول طلب تسجيلكم في منصّة Aeris للطيران الخاص.</p>
    <p style="margin:0 0 12px">اضغط الزر أدناه لتفعيل حسابكم وإكمال أوّل تسجيل دخول. الرابط صالح حتى <strong>${escapeHtml(expiresLabel)}</strong> ولا يمكن استخدامه إلا مرّة واحدة.</p>
  `;

  try {
    const resend = new Resend(env.apiKey);
    await resend.emails.send({
      from: env.from,
      to: input.to,
      subject: `Aeris — تمّ قبول حسابكم · ${input.company_name}`,
      html: shellHtml({
        preheader: 'تمّ قبول حسابكم في Aeris — اضغط لإكمال التسجيل.',
        heading: 'مرحباً بكم في Aeris',
        body,
        ctaUrl: input.welcome_url,
        ctaLabel: 'تفعيل الحساب',
      }),
    });
  } catch (err) {
    console.error('[operator-email] welcome resend send failed', err);
  }
}

// ============================================================
// 2. sendOperatorRejectionEmail
// ============================================================

export interface SendOperatorRejectionEmailInput {
  to: string;
  company_name: string;
  reason: string;
}

export async function sendOperatorRejectionEmail(
  input: SendOperatorRejectionEmailInput
): Promise<void> {
  const env = envCredentials();
  if (!env) {
    console.warn('[operator-email] rejection: missing env — skipping send');
    return;
  }

  const body = `
    <p style="margin:0 0 12px">مرحباً <strong>${escapeHtml(input.company_name)}</strong>،</p>
    <p style="margin:0 0 12px">شكراً لاهتمامكم بالانضمام إلى منصّة Aeris.</p>
    <p style="margin:0 0 12px">بعد المراجعة، اعتذر فريقنا عن قبول الطلب للأسباب التالية:</p>
    <blockquote style="margin:12px 0;padding:12px 16px;border-right:3px solid #C9A961;background:#0D1B30;border-radius:8px;color:#FAFAFA;font-size:14px">
      ${escapeHtml(input.reason)}
    </blockquote>
    <p style="margin:0 0 12px">يمكنكم التواصل مع فريق المساعدة عبر WhatsApp على الرقم +966558048004 لمعرفة المزيد.</p>
  `;

  try {
    const resend = new Resend(env.apiKey);
    await resend.emails.send({
      from: env.from,
      to: input.to,
      subject: `Aeris — رفض طلب التسجيل · ${input.company_name}`,
      html: shellHtml({
        preheader: 'تمّ رفض طلب تسجيلكم في Aeris.',
        heading: 'بشأن طلب التسجيل',
        body,
      }),
    });
  } catch (err) {
    console.error('[operator-email] rejection resend send failed', err);
  }
}

// ============================================================
// 3. sendOperatorPasswordResetEmail
// ============================================================

export interface SendOperatorPasswordResetEmailInput {
  to: string;
  company_name: string;
  new_password: string;
  login_url: string;
}

export type EmailDeliveryResult =
  | { ok: true }
  | { ok: false; reason: 'env_missing' | 'send_failed' };

/**
 * Codex round 1 (PR #41) P1 #1 fix: password-reset email
 * MUST report delivery status so the Server Action can
 * surface a degraded state to the admin UI. Without this,
 * a missing RESEND_API_KEY or a Resend outage silently
 * locks the operator out — the password is rotated and
 * sessions are revoked, but the operator never receives
 * the new password.
 *
 * Welcome + rejection emails stay best-effort because
 * they don't lock the operator out: a missing welcome
 * email leaves the operator at "pending" UX (they can
 * still log in via existing password if they had one),
 * and a missing rejection email is purely informational.
 * The password-reset path is the one that turns silent
 * delivery failure into account loss.
 */
export async function sendOperatorPasswordResetEmail(
  input: SendOperatorPasswordResetEmailInput
): Promise<EmailDeliveryResult> {
  const env = envCredentials();
  if (!env) {
    console.warn('[operator-email] password-reset: missing env — skipping send');
    return { ok: false, reason: 'env_missing' };
  }

  const body = `
    <p style="margin:0 0 12px">مرحباً <strong>${escapeHtml(input.company_name)}</strong>،</p>
    <p style="margin:0 0 12px">قام فريق الإدارة بإعادة تعيين كلمة المرور لحسابكم في Aeris.</p>
    <p style="margin:0 0 8px">كلمة المرور المؤقّتة:</p>
    <p style="margin:0 0 16px;padding:14px 18px;background:#0D1B30;border:1px solid rgba(201,169,97,0.4);border-radius:10px;font-family:Consolas,monospace;color:#E8D4A8;font-size:16px;text-align:center;letter-spacing:0.05em">
      ${escapeHtml(input.new_password)}
    </p>
    <p style="margin:0 0 12px">سيُطلب منكم تغيير كلمة المرور فور تسجيل الدخول التالي.</p>
  `;

  try {
    const resend = new Resend(env.apiKey);
    await resend.emails.send({
      from: env.from,
      to: input.to,
      subject: `Aeris — إعادة تعيين كلمة المرور`,
      html: shellHtml({
        preheader: 'تمّ إعادة تعيين كلمة المرور لحسابكم في Aeris.',
        heading: 'كلمة مرور جديدة',
        body,
        ctaUrl: input.login_url,
        ctaLabel: 'تسجيل الدخول',
      }),
    });
    return { ok: true };
  } catch (err) {
    console.error('[operator-email] password-reset resend send failed', err);
    return { ok: false, reason: 'send_failed' };
  }
}
