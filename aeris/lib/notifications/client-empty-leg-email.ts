// Server-side ONLY — same rationale as lib/empty-legs/notifications.ts:
// the test:empty-legs-matching Layer-1 test runs under tsx outside
// Next.js where the 'server-only' shim is not resolvable. Surface
// contract is enforced at the call site (this module is only
// imported from Server Actions + the matcher's client-loop).

import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

import type { ClientEmailDeliveryResult } from './client-email';
import { recordClientEmptyLegAlertStatus } from './client-empty-leg-alert-status';

/**
 * Phase 10 PR 1 — client-facing emails for the empty-legs portal.
 *
 * Two flavours:
 *   - sendClientEmptyLegMatchEmail — fires from the matcher's
 *     client-loop when the dispatcher inserts a row into
 *     empty_leg_notifications with channel='email' or
 *     'email_and_wa'. The body links to /me/empty-legs/<leg_number>.
 *   - sendClientEmptyLegReservationConfirmationEmail — fires from
 *     reserveAuthenticatedEmptyLeg Server Action on success.
 *     The body confirms the 1-hour hold + admin call-back.
 *
 * Both surfaces flip the §3.6 client_empty_leg_alert_status
 * singleton via recordClientEmptyLegAlertStatus on every send
 * (round 7 P1 #2). The contextLabel identifies which surface
 * is the broken channel for admin debugging.
 *
 * Env: RESEND_API_KEY + RESEND_FROM_EMAIL (shared with the
 * operator + lead + Phase 9 client pipelines — same Resend
 * account; per-surface health tracked via separate singletons).
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

function legRouteLabel(
  iata: string | null,
  freeform: string | null
): string {
  if (iata && iata.trim().length > 0) return iata;
  if (freeform && freeform.trim().length > 0) return freeform;
  return '—';
}

async function resolveClientEmail(clientId: string): Promise<string | null> {
  // Read auth_email lazily — the matcher's ClientCandidateRow only
  // carries display fields. This 1-row read is acceptable per
  // dispatch (≤ 50 dispatches per cycle).
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from('clients')
      .select('auth_email')
      .eq('id', clientId)
      .maybeSingle();
    if (error) {
      console.error('[client-empty-leg-email] auth_email lookup failed', error);
      return null;
    }
    return (data as { auth_email?: string } | null)?.auth_email ?? null;
  } catch (err) {
    console.error('[client-empty-leg-email] auth_email read threw', err);
    return null;
  }
}

// ============================================================
// Match email — fires from the matcher's client-loop
// ============================================================

export interface SendClientEmptyLegMatchEmailInput {
  client: {
    id: string;
    full_name: string;
    auth_email: string; // can be empty; will be resolved if so
    contact_phone: string;
  };
  leg: EmptyLegRow;
  eventType: 'published' | 'price_dropped';
  legUrl: string;
}

export async function sendClientEmptyLegMatchEmail(
  input: SendClientEmptyLegMatchEmailInput
): Promise<ClientEmailDeliveryResult> {
  const env = envCredentials();
  if (!env) {
    const result: ClientEmailDeliveryResult = {
      ok: false,
      reason: 'env_missing',
      detail: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set',
    };
    await recordClientEmptyLegAlertStatus(
      createAdminClient(),
      result,
      `empty-leg-match:${input.eventType}`
    );
    return result;
  }

  const to =
    input.client.auth_email && input.client.auth_email.trim().length > 0
      ? input.client.auth_email
      : await resolveClientEmail(input.client.id);

  if (!to || to.trim().length === 0) {
    const result: ClientEmailDeliveryResult = {
      ok: false,
      reason: 'send_failed',
      detail: `client ${input.client.id} has no auth_email`,
    };
    await recordClientEmptyLegAlertStatus(
      createAdminClient(),
      result,
      `empty-leg-match:${input.eventType}`
    );
    return result;
  }

  const routeFrom = legRouteLabel(
    input.leg.departure_airport,
    input.leg.departure_airport_freeform_snapshot
  );
  const routeTo = legRouteLabel(
    input.leg.arrival_airport,
    input.leg.arrival_airport_freeform_snapshot
  );
  const price = input.leg.current_price ?? 0;
  const discountPct = input.leg.current_discount_pct ?? 0;
  const isPriceDrop = input.eventType === 'price_dropped';

  const heading = isPriceDrop
    ? 'انخفض السعر — رحلة فارغة جديدة لك'
    : 'رحلة فارغة جديدة قد تناسبك';
  const subject = isPriceDrop
    ? 'Aeris — انخفض سعر رحلة فارغة'
    : 'Aeris — رحلة فارغة جديدة';

  const html = shellHtml({
    preheader: `${routeFrom} → ${routeTo} — ${price} ريال (خصم ${discountPct}%)`,
    heading,
    body: `
      <p>مرحباً ${escapeHtml(input.client.full_name)}،</p>
      <p>عثر نظام المطابقة على رحلة فارغة قد تناسب رحلاتك السابقة:</p>
      <p style="background:#0F1F35;padding:16px;border-radius:10px;margin:16px 0">
        <strong style="color:#E8D4A8">المسار:</strong> ${escapeHtml(routeFrom)} → ${escapeHtml(routeTo)}<br>
        <strong style="color:#E8D4A8">السعر الحالي:</strong> ${price.toLocaleString('en-US')} ريال<br>
        <strong style="color:#E8D4A8">الخصم الحالي:</strong> ${discountPct}%
      </p>
      <p>السعر يتغير ديناميكياً مع اقتراب موعد الرحلة. يمكنك حجز الرحلة من حسابك في أي وقت — وسيتواصل معك فريق Aeris لتأكيد التفاصيل خلال ساعة.</p>
    `,
    ctaUrl: input.legUrl,
    ctaLabel: isPriceDrop ? 'عرض السعر الجديد' : 'عرض الرحلة الفارغة',
  });

  try {
    const resend = new Resend(env.apiKey);
    const result = await resend.emails.send({
      from: env.from,
      to,
      subject,
      html,
    });
    if (result.error) {
      const failure: ClientEmailDeliveryResult = {
        ok: false,
        reason: 'send_failed',
        detail: result.error.message ?? 'unknown',
      };
      await recordClientEmptyLegAlertStatus(
        createAdminClient(),
        failure,
        `empty-leg-match:${input.eventType}`
      );
      return failure;
    }
    const success: ClientEmailDeliveryResult = {
      ok: true,
      message_id: result.data?.id ?? null,
    };
    await recordClientEmptyLegAlertStatus(
      createAdminClient(),
      success,
      `empty-leg-match:${input.eventType}`
    );
    return success;
  } catch (err) {
    const failure: ClientEmailDeliveryResult = {
      ok: false,
      reason: 'send_failed',
      detail: err instanceof Error ? err.message : 'unknown',
    };
    await recordClientEmptyLegAlertStatus(
      createAdminClient(),
      failure,
      `empty-leg-match:${input.eventType}`
    );
    return failure;
  }
}

// ============================================================
// Reservation confirmation email — fires from
// reserveAuthenticatedEmptyLeg Server Action on success
// ============================================================

export interface SendClientEmptyLegReservationConfirmationInput {
  to: string;
  full_name: string;
  leg_number: string;
  route_from: string;
  route_to: string;
  price_at_reservation: number;
  expires_at: string; // ISO timestamp
  leg_url: string;
}

export async function sendClientEmptyLegReservationConfirmationEmail(
  input: SendClientEmptyLegReservationConfirmationInput
): Promise<ClientEmailDeliveryResult> {
  const env = envCredentials();
  if (!env) {
    const result: ClientEmailDeliveryResult = {
      ok: false,
      reason: 'env_missing',
      detail: 'RESEND_API_KEY or RESEND_FROM_EMAIL not set',
    };
    await recordClientEmptyLegAlertStatus(
      createAdminClient(),
      result,
      'empty-leg-reservation:confirm'
    );
    return result;
  }

  const expiresLocal = new Date(input.expires_at).toLocaleTimeString('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Riyadh',
  });

  const html = shellHtml({
    preheader: `تم حجز رحلتك ${input.leg_number} — في انتظار تأكيد الإدارة`,
    heading: 'تم حجز رحلتك مؤقتاً',
    body: `
      <p>مرحباً ${escapeHtml(input.full_name)}،</p>
      <p>تم حجز الرحلة الفارغة <strong style="color:#E8D4A8">${escapeHtml(input.leg_number)}</strong> باسمك مؤقتاً لمدة ساعة واحدة:</p>
      <p style="background:#0F1F35;padding:16px;border-radius:10px;margin:16px 0">
        <strong style="color:#E8D4A8">المسار:</strong> ${escapeHtml(input.route_from)} → ${escapeHtml(input.route_to)}<br>
        <strong style="color:#E8D4A8">السعر:</strong> ${input.price_at_reservation.toLocaleString('en-US')} ريال<br>
        <strong style="color:#E8D4A8">ينتهي الحجز عند:</strong> ${expiresLocal} (توقيت الرياض)
      </p>
      <p>سيتواصل معك فريق Aeris خلال ساعة لتأكيد الحجز نهائياً وإكمال تفاصيل الدفع. يمكنك إلغاء الحجز من حسابك في أي لحظة قبل التأكيد.</p>
    `,
    ctaUrl: input.leg_url,
    ctaLabel: 'عرض حالة الحجز',
  });

  try {
    const resend = new Resend(env.apiKey);
    const result = await resend.emails.send({
      from: env.from,
      to: input.to,
      subject: `Aeris — تم حجز الرحلة ${input.leg_number} مؤقتاً`,
      html,
    });
    if (result.error) {
      const failure: ClientEmailDeliveryResult = {
        ok: false,
        reason: 'send_failed',
        detail: result.error.message ?? 'unknown',
      };
      await recordClientEmptyLegAlertStatus(
        createAdminClient(),
        failure,
        'empty-leg-reservation:confirm'
      );
      return failure;
    }
    const success: ClientEmailDeliveryResult = {
      ok: true,
      message_id: result.data?.id ?? null,
    };
    await recordClientEmptyLegAlertStatus(
      createAdminClient(),
      success,
      'empty-leg-reservation:confirm'
    );
    return success;
  } catch (err) {
    const failure: ClientEmailDeliveryResult = {
      ok: false,
      reason: 'send_failed',
      detail: err instanceof Error ? err.message : 'unknown',
    };
    await recordClientEmptyLegAlertStatus(
      createAdminClient(),
      failure,
      'empty-leg-reservation:confirm'
    );
    return failure;
  }
}
