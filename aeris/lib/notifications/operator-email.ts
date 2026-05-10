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

/**
 * Codex round 2 (PR #41) P2 #2 fix: welcome email now reports
 * delivery status (was previously void / best-effort). After
 * `admin_approve_operator` runs, the operator row is approved
 * and a one-time welcome token has been minted — the operator's
 * ONLY way to set their first session is the magic-link URL in
 * this email (or the URL the admin copies from the toast).
 * Silent delivery failure is a soft-lockout: admin sees
 * ok:true, but the operator never gets the link AND admin
 * never knows.
 *
 * The `welcome_url` itself is always returned by
 * adminApproveOperator regardless of email status, so admin
 * can copy it to wa.me as a fallback. The degraded warning
 * tells admin to do exactly that.
 */
export async function sendOperatorWelcomeEmail(
  input: SendOperatorWelcomeEmailInput
): Promise<EmailDeliveryResult> {
  const env = envCredentials();
  if (!env) {
    console.warn('[operator-email] welcome: missing RESEND_API_KEY / RESEND_FROM_EMAIL — skipping send');
    return { ok: false, reason: 'env_missing' };
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
    return { ok: true };
  } catch (err) {
    console.error('[operator-email] welcome resend send failed', err);
    return { ok: false, reason: 'send_failed' };
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
// 3a. sendOperatorPasswordResetLinkEmail
//
// Codex round 1 PR #42 P1 #2 fix: dedicated template for the
// operator-initiated reset flow (operatorRequestPasswordReset).
// Body says "click to reset your password"; CTA points to the
// reset-password URL with the embedded token. Distinct from
// the admin-initiated path (3b below) which delivers a temp
// password instead of a link.
// ============================================================

export interface SendOperatorPasswordResetLinkEmailInput {
  to: string;
  company_name: string;
  reset_url: string;
  expires_in_minutes: number;
}

export async function sendOperatorPasswordResetLinkEmail(
  input: SendOperatorPasswordResetLinkEmailInput
): Promise<EmailDeliveryResult> {
  const env = envCredentials();
  if (!env) {
    console.warn('[operator-email] reset-link: missing env — skipping send');
    return { ok: false, reason: 'env_missing' };
  }

  const body = `
    <p style="margin:0 0 12px">مرحباً <strong>${escapeHtml(input.company_name)}</strong>،</p>
    <p style="margin:0 0 12px">تلقّينا طلباً لإعادة تعيين كلمة المرور لحسابكم في Aeris.</p>
    <p style="margin:0 0 12px">اضغط الزر أدناه لاختيار كلمة مرور جديدة. الرابط صالح لمدّة <strong>${input.expires_in_minutes} دقيقة</strong> ولا يمكن استخدامه إلا مرّة واحدة.</p>
    <p style="margin:0 0 12px;color:#A8B2C1;font-size:13px">إذا لم تطلب هذا، يمكنك تجاهل هذه الرسالة بأمان — لن يتغيّر شيء.</p>
  `;

  try {
    const resend = new Resend(env.apiKey);
    await resend.emails.send({
      from: env.from,
      to: input.to,
      subject: `Aeris — إعادة تعيين كلمة المرور`,
      html: shellHtml({
        preheader: 'رابط إعادة تعيين كلمة المرور لحسابك في Aeris.',
        heading: 'إعادة تعيين كلمة المرور',
        body,
        ctaUrl: input.reset_url,
        ctaLabel: 'إعادة تعيين كلمة المرور',
      }),
    });
    return { ok: true };
  } catch (err) {
    console.error('[operator-email] reset-link resend send failed', err);
    return { ok: false, reason: 'send_failed' };
  }
}

// ============================================================
// 3b. sendOperatorPasswordResetEmail (admin-initiated)
//
// Used by adminResetOperatorPassword to deliver a one-shot
// temporary password the operator must change on next login.
// Distinct from sendOperatorPasswordResetLinkEmail (3a) which
// delivers a click-to-reset link for the operator-initiated
// forgot-password flow.
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
 * Account-state-changing emails MUST report delivery status
 * so the Server Action can surface a degraded state to admin
 * when delivery fails. The two flavours that change account
 * state and thus return EmailDeliveryResult:
 *
 *   - sendOperatorPasswordResetEmail (Codex round 1 P1 #1)
 *     — silent failure locks the operator out (sessions
 *     revoked, new password never delivered).
 *   - sendOperatorWelcomeEmail (Codex round 2 P2 #2)
 *     — silent failure locks a freshly-approved operator
 *     out: the row is now `approved` and a one-time welcome
 *     token has been minted, but the operator has no
 *     password yet AND no link to set one. Admin still gets
 *     the welcome URL in the action result toast so they
 *     can relay manually via WhatsApp.
 *
 * sendOperatorRejectionEmail stays best-effort void — its
 * delivery failure is purely informational. The rejected
 * operator can still see the status if admin reaches out
 * by other means; no account is lost either way.
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
