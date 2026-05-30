// Server-side ONLY — same rationale as lib/notifications/client-empty-leg-email.ts:
// imported only from the recovery cron's loop. Resend creds shared with the
// other client pipelines (RESEND_API_KEY + RESEND_FROM_EMAIL).

import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';

import type { ClientEmailDeliveryResult } from './client-email';

/**
 * Abandoned trip-request recovery email — fires from the recovery cron when a
 * client's request has been sitting at `offered` (offers waiting) past the stale
 * threshold without a booking. Nudges the client back to /me/requests/<id>.
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

async function resolveClientEmail(clientId: string): Promise<string | null> {
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from('clients')
      .select('auth_email')
      .eq('id', clientId)
      .maybeSingle();
    if (error) {
      console.error('[client-request-recovery-email] auth_email lookup failed', error);
      return null;
    }
    return (data as { auth_email?: string } | null)?.auth_email ?? null;
  } catch (err) {
    console.error('[client-request-recovery-email] auth_email read threw', err);
    return null;
  }
}

export interface SendClientRequestRecoveryEmailInput {
  client: { id: string; full_name: string; auth_email: string };
  requestNumber: string;
  routeFrom: string;
  routeTo: string;
  requestUrl: string;
}

export async function sendClientRequestRecoveryEmail(
  input: SendClientRequestRecoveryEmailInput
): Promise<ClientEmailDeliveryResult> {
  const env = envCredentials();
  if (!env) {
    return { ok: false, reason: 'env_missing', detail: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set' };
  }

  const to =
    input.client.auth_email && input.client.auth_email.trim().length > 0
      ? input.client.auth_email
      : await resolveClientEmail(input.client.id);
  if (!to || to.trim().length === 0) {
    return { ok: false, reason: 'send_failed', detail: `client ${input.client.id} has no auth_email` };
  }

  const html = shellHtml({
    preheader: `لديك عروض بانتظارك على طلب رحلتك ${input.requestNumber}`,
    heading: 'عروض بانتظارك — أكمل حجز رحلتك',
    body: `
      <p>مرحباً ${escapeHtml(input.client.full_name)}،</p>
      <p>وصلتك عروض من المشغّلين على طلب رحلتك ولم تكمل الحجز بعد:</p>
      <p style="background:#0F1F35;padding:16px;border-radius:10px;margin:16px 0">
        <strong style="color:#E8D4A8">رقم الطلب:</strong> ${escapeHtml(input.requestNumber)}<br>
        <strong style="color:#E8D4A8">المسار:</strong> ${escapeHtml(input.routeFrom)} → ${escapeHtml(input.routeTo)}
      </p>
      <p>راجع العروض وأكمل حجزك من حسابك — وسيتواصل معك فريق Aeris لتأكيد التفاصيل.</p>
    `,
    ctaUrl: input.requestUrl,
    ctaLabel: 'عرض العروض وإكمال الحجز',
  });

  try {
    const resend = new Resend(env.apiKey);
    const result = await resend.emails.send({
      from: env.from,
      to,
      subject: `Aeris — عروض بانتظارك على طلب ${input.requestNumber}`,
      html,
    });
    if (result.error) {
      return { ok: false, reason: 'send_failed', detail: result.error.message ?? 'unknown' };
    }
    return { ok: true, message_id: result.data?.id ?? null };
  } catch (err) {
    return { ok: false, reason: 'send_failed', detail: err instanceof Error ? err.message : 'unknown' };
  }
}
