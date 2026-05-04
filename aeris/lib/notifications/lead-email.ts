import 'server-only';

import { Resend } from 'resend';
import type { LeadInquiryRow } from '@/types/database';
import { formatPhone, normalizeWhatsAppPhone } from '@/lib/utils/format';

const TRIP_LABEL_AR: Record<LeadInquiryRow['trip_type'], string> = {
  one_way: 'ذهاب فقط',
  round_trip: 'ذهاب وعودة',
  multi_city: 'متعدد الوجهات',
};

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

function buildHtml(lead: LeadInquiryRow): string {
  const detailUrl = `${siteUrl()}/admin/leads/${lead.id}`;
  const phoneClean = normalizeWhatsAppPhone(lead.customer_phone);
  const waMessage =
    `مرحباً ${lead.customer_name}، نتواصل معك من فريق Aeris بخصوص طلبك ` +
    `${lead.request_number}.`;
  const waUrl = `https://wa.me/${phoneClean}?text=${encodeURIComponent(waMessage)}`;
  const tripLabel = TRIP_LABEL_AR[lead.trip_type];
  const notes = lead.notes ? escapeHtml(lead.notes).slice(0, 400) : '—';
  const returnRow = lead.return_date
    ? `<tr><td style="padding:6px 0;color:#A8B2C1">العودة</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(lead.return_date)}</td></tr>`
    : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;background:#050B14;font-family:'IBM Plex Sans Arabic','Inter',sans-serif;color:#FAFAFA">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#050B14;padding:24px 0">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0A1628;border:1px solid rgba(201,169,97,0.25);border-radius:14px;padding:28px">
          <tr><td>
            <div style="font-family:'Playfair Display',serif;letter-spacing:0.28em;color:#E8D4A8;font-size:22px">AERIS</div>
            <h1 style="margin:18px 0 6px;font-size:20px;color:#FAFAFA">طلب رحلة جديد</h1>
            <p style="margin:0;color:#A8B2C1;font-size:14px">رقم الطلب: <span style="color:#E8D4A8;font-family:Consolas,monospace">${escapeHtml(lead.request_number)}</span></p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid rgba(201,169,97,0.15);border-bottom:1px solid rgba(201,169,97,0.15);padding:8px 0;font-size:14px">
              <tr><td style="padding:6px 0;color:#A8B2C1;width:140px">العميل</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(lead.customer_name)}</td></tr>
              <tr><td style="padding:6px 0;color:#A8B2C1">الهاتف</td><td style="padding:6px 0"><a href="tel:${escapeHtml(lead.customer_phone)}" style="color:#E8D4A8;text-decoration:none">${escapeHtml(formatPhone(lead.customer_phone))}</a> · <a href="${escapeHtml(waUrl)}" style="color:#C9A961;text-decoration:none">واتساب</a></td></tr>
              <tr><td style="padding:6px 0;color:#A8B2C1">نوع الرحلة</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(tripLabel)}</td></tr>
              <tr><td style="padding:6px 0;color:#A8B2C1">من</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(lead.origin)}</td></tr>
              <tr><td style="padding:6px 0;color:#A8B2C1">إلى</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(lead.destination)}</td></tr>
              <tr><td style="padding:6px 0;color:#A8B2C1">المغادرة</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${escapeHtml(lead.departure_date)}</td></tr>
              ${returnRow}
              <tr><td style="padding:6px 0;color:#A8B2C1">الركاب</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${lead.passengers}</td></tr>
            </table>

            <div style="margin-top:18px;font-size:13px;color:#A8B2C1">ملاحظات العميل:</div>
            <div style="margin-top:6px;padding:12px;background:#0D1B30;border:1px solid rgba(201,169,97,0.15);border-radius:8px;color:#FAFAFA;font-size:14px;line-height:1.7;white-space:pre-wrap">${notes}</div>

            <div style="margin-top:28px;text-align:center">
              <a href="${escapeHtml(detailUrl)}" style="display:inline-block;background:linear-gradient(180deg,#E8D4A8,#C9A961 50%,#8B7339);color:#0A1628;text-decoration:none;font-weight:500;padding:14px 26px;border-radius:8px">فتح الطلب في لوحة Aeris</a>
            </div>

            <p style="margin:22px 0 0;color:#6B7A8F;font-size:12px;text-align:center">إشعار تلقائي من نظام Aeris · لا تردّ على هذا البريد.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/**
 * Best-effort founder notification. Never throws to the caller.
 * Preconditions are checked here; missing config is a silent no-op.
 */
export async function notifyAdminOfNewLead(lead: LeadInquiryRow): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes('xxxxxxxxxxx')) {
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL || 'noreply@aeris.sa';
  const to = process.env.LEAD_NOTIFICATION_TO || from;

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to,
      subject: `طلب رحلة جديد · ${lead.request_number} · ${lead.customer_name}`,
      html: buildHtml(lead),
    });
  } catch (err) {
    console.error('[lead-email] resend send failed', err);
  }
}
