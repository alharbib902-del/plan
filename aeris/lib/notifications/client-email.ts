import 'server-only';

import { Resend } from 'resend';

/**
 * Phase 9 PR 1 — client-facing emails (mirror of
 * `lib/notifications/operator-email.ts` Phase 8 PR 2b).
 *
 * One flavour shipped in PR 1:
 *   - sendClientPasswordResetLinkEmail — fires from
 *     `clientRequestPasswordReset` Server Action with the
 *     magic-link URL bound to the reset token.
 *
 * Returns ClientEmailDeliveryResult so the calling Server
 * Action can record alert status via
 * recordClientEmailAlertStatus + admin canary surfaces the
 * channel health (Phase 9 spec §3.7 + §4.1 P2 #1 fix).
 *
 * Env: RESEND_API_KEY + RESEND_FROM_EMAIL (shared with
 * operator + lead pipelines — same Resend account).
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

export type ClientEmailDeliveryResult =
  | { ok: true; message_id: string | null }
  | {
      ok: false;
      reason: 'env_missing' | 'send_failed';
      detail: string;
    };

export interface SendClientPasswordResetLinkEmailInput {
  to: string;
  full_name: string;
  reset_url: string;
  expires_in_minutes: number;
}

export async function sendClientPasswordResetLinkEmail(
  input: SendClientPasswordResetLinkEmailInput
): Promise<ClientEmailDeliveryResult> {
  const env = envCredentials();
  if (!env) {
    return {
      ok: false,
      reason: 'env_missing',
      detail: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set',
    };
  }

  const html = shellHtml({
    preheader: 'إعادة تعيين كلمة مرور Aeris',
    heading: 'إعادة تعيين كلمة المرور',
    body: `
      <p>مرحباً ${escapeHtml(input.full_name)}،</p>
      <p>وصلنا طلب لإعادة تعيين كلمة مرور حسابك في Aeris.</p>
      <p>الرابط أدناه صالح لمدة ${input.expires_in_minutes} دقيقة. إن لم تطلب ذلك، تجاهل هذه الرسالة.</p>
    `,
    ctaUrl: input.reset_url,
    ctaLabel: 'تعيين كلمة مرور جديدة',
  });

  try {
    const resend = new Resend(env.apiKey);
    const result = await resend.emails.send({
      from: env.from,
      to: input.to,
      subject: 'إعادة تعيين كلمة مرور Aeris',
      html,
    });
    if (result.error) {
      return {
        ok: false,
        reason: 'send_failed',
        detail: result.error.message ?? 'unknown',
      };
    }
    return { ok: true, message_id: result.data?.id ?? null };
  } catch (err) {
    return {
      ok: false,
      reason: 'send_failed',
      detail: err instanceof Error ? err.message : 'unknown',
    };
  }
}
