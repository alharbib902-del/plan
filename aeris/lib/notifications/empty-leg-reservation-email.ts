// Server-side ONLY — same rationale as
// lib/notifications/client-empty-leg-email.ts: the
// test:notifications-empty-leg-reservation-email Layer-1 test
// imports the pure template builder under tsx outside Next.js
// where the 'server-only' shim is not resolvable. The surface
// contract is enforced at the call sites — this module is only
// imported from the 'use server' public action
// (app/actions/empty-legs-public.ts) and the server-only core
// (lib/empty-legs/core/empty-legs-core.ts).

import { Resend } from 'resend';

import { formatPhone, normalizeWhatsAppPhone } from '@/lib/utils/format';
import { formatInRiyadh } from '@/lib/utils/format-riyadh';
import { EMAIL_DARK_HEAD } from './email-dark-head';

/**
 * P0 (2026-07) — instant founder alert when an empty-leg
 * reservation lands, on BOTH reservation surfaces:
 *
 *   - guest path  (reserveEmptyLeg → reserve_empty_leg RPC)
 *   - client path (runReserveEmptyLeg →
 *     reserve_empty_leg_authenticated RPC, shared web + mobile)
 *
 * Deliberately INLINE at the reservation call site rather than
 * through the outbox: the empty-legs match-drain cron runs
 * every 30 minutes, which is too slow for a 60-minute hold —
 * the founder needs the alert within seconds to coordinate
 * payment confirmation over WhatsApp.
 *
 * Modeled on notifyAdminOfNewLead (lib/notifications/
 * lead-email.ts): same recipient/from resolution
 * (RESEND_API_KEY + the 'xxxxxxxxxxx' placeholder guard,
 * RESEND_FROM_EMAIL fallback, LEAD_NOTIFICATION_TO override),
 * same Arabic RTL dark HTML shell, same wa.me reply link.
 * Best-effort: never throws to the caller.
 *
 * No price is included — the admin detail page carries it;
 * keeping it out of the email also sidesteps the
 * ENABLE_EMPTY_LEGS_CLIENT_PRICING visibility matrix entirely.
 */

export interface BuildEmptyLegReservationFounderEmailInput {
  leg_id: string;
  leg_number: string;
  route_from: string;
  route_to: string;
  /** ISO timestamps for the leg's departure window. */
  departure_window_start: string;
  departure_window_end: string;
  reserver_name: string;
  reserver_phone: string;
  /** 'guest' = public marketplace form; 'client' = authenticated portal/mobile. */
  reserver_kind: 'guest' | 'client';
  /** ISO timestamp — when the hold lapses (founder SLA clock). */
  reservation_expires_at: string;
}

export interface BuiltEmptyLegReservationFounderEmail {
  subject: string;
  html: string;
}

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

function formatRiyadhDateTime(iso: string): string {
  return formatInRiyadh(iso, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function buildEmptyLegReservationFounderEmail(
  input: BuildEmptyLegReservationFounderEmailInput
): BuiltEmptyLegReservationFounderEmail {
  const detailUrl = `${siteUrl()}/admin/empty-legs/${input.leg_id}`;
  const phoneClean = normalizeWhatsAppPhone(input.reserver_phone);
  const waMessage =
    `مرحباً ${input.reserver_name}، نتواصل معك من فريق Aeris بخصوص حجزك ` +
    `${input.leg_number}.`;
  const waUrl = `https://wa.me/${phoneClean}?text=${encodeURIComponent(waMessage)}`;
  const kindLabel = input.reserver_kind === 'client' ? 'عميل مسجّل' : 'زائر';
  const windowStart = formatRiyadhDateTime(input.departure_window_start);
  const windowEnd = formatRiyadhDateTime(input.departure_window_end);
  const expiresAt = formatRiyadhDateTime(input.reservation_expires_at);

  const subject = `حجز رحلة فارغة جديد · ${input.leg_number} · ${input.reserver_name}`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
  ${EMAIL_DARK_HEAD}
  <body bgcolor="#050B14" style="margin:0;background:#050B14;font-family:'IBM Plex Sans Arabic','Inter',sans-serif;color:#FAFAFA">
    <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#050B14" style="background:#050B14;padding:24px 0">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" bgcolor="#0A1628" style="max-width:600px;background:#0A1628;border:1px solid rgba(201,169,97,0.25);border-radius:14px;padding:28px">
          <tr><td>
            <div style="font-family:'Playfair Display',serif;letter-spacing:0.28em;color:#E8D4A8;font-size:22px">AERIS</div>
            <h1 style="margin:18px 0 6px;font-size:20px;color:#FAFAFA">حجز رحلة فارغة جديد</h1>
            <p style="margin:0;color:#A8B2C1;font-size:14px">رقم الرحلة: <span style="color:#E8D4A8;font-family:Consolas,monospace">${escapeHtml(input.leg_number)}</span></p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid rgba(201,169,97,0.15);border-bottom:1px solid rgba(201,169,97,0.15);padding:8px 0;font-size:14px">
              <tr><td style="padding:6px 0;color:#A8B2C1;width:140px">المسار</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(input.route_from)} ← ${escapeHtml(input.route_to)}</td></tr>
              <tr><td style="padding:6px 0;color:#A8B2C1">نافذة المغادرة</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(windowStart)} ← ${escapeHtml(windowEnd)}</td></tr>
              <tr><td style="padding:6px 0;color:#A8B2C1">مصدر الحجز</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(kindLabel)}</td></tr>
              <tr><td style="padding:6px 0;color:#A8B2C1">العميل</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(input.reserver_name)}</td></tr>
              <tr><td style="padding:6px 0;color:#A8B2C1">الهاتف</td><td style="padding:6px 0"><a href="tel:${escapeHtml(input.reserver_phone)}" style="color:#E8D4A8;text-decoration:none">${escapeHtml(formatPhone(input.reserver_phone))}</a> · <a href="${escapeHtml(waUrl)}" style="color:#C9A961;text-decoration:none">واتساب</a></td></tr>
              <tr><td style="padding:6px 0;color:#A8B2C1">ينتهي التحفّظ في</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(expiresAt)} (توقيت الرياض)</td></tr>
            </table>

            <p style="margin:18px 0 0;color:#A8B2C1;font-size:13px;line-height:1.7">تواصل مع العميل عبر واتساب لتأكيد الدفع قبل انتهاء التحفّظ، ثم أكّد الحجز من لوحة الإدارة.</p>

            <div style="margin-top:28px;text-align:center">
              <a href="${escapeHtml(detailUrl)}" style="display:inline-block;background:linear-gradient(180deg,#E8D4A8,#C9A961 50%,#8B7339);color:#0A1628;text-decoration:none;font-weight:500;padding:14px 26px;border-radius:8px">فتح الرحلة في لوحة Aeris</a>
            </div>

            <p style="margin:22px 0 0;color:#6B7A8F;font-size:12px;text-align:center">إشعار تلقائي من نظام Aeris · لا تردّ على هذا البريد.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html };
}

/**
 * Best-effort founder notification. Never throws to the caller.
 * Preconditions are checked here; missing config is a silent
 * no-op (identical to notifyAdminOfNewLead's posture).
 */
export async function notifyAdminOfEmptyLegReservation(
  input: BuildEmptyLegReservationFounderEmailInput
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes('xxxxxxxxxxx')) {
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL || 'noreply@aeris.sa';
  const to = process.env.LEAD_NOTIFICATION_TO || from;

  try {
    const { subject, html } = buildEmptyLegReservationFounderEmail(input);
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to, subject, html });
  } catch (err) {
    console.error('[empty-leg-reservation-email] resend send failed', err);
  }
}
