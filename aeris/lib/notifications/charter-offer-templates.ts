// Pure template builders (no 'server-only', no I/O) so the
// test:notifications-charter-offer tsx suite can import them outside
// Next.js. The senders live in charter-offer-notify.ts (server-only).

import { formatPhone, formatSAR, normalizeWhatsAppPhone } from '@/lib/utils/format';

/**
 * Charter "silence while waiting" notifications:
 *
 *   - founder alert when an operator submits a charter offer
 *   - client email + WhatsApp «وصلك عرض جديد» (signed-in requests)
 *   - guest-lead WhatsApp «وصل عرض» (no price / operator — the
 *     Aeris team presents offers to guests personally)
 *   - founder alert when a signed-in client creates a charter request
 *
 * Client-facing bodies never carry the price or the operator's name:
 * the client compares offers inside /me, and guests hear them from
 * the Aeris team. Western digits + Asia/Riyadh Gregorian dates.
 */

export interface RouteEndpoints {
  from: string;
  to: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatRiyadhDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return iso;
  }
}

/**
 * IATA first, then the Phase 6.0 freeform leg fields, then legacy
 * legs whose `from`/`to` carried the freeform text directly.
 */
export function resolveRouteEndpoints(trip: {
  departure_airport: string | null;
  arrival_airport: string | null;
  legs:
    | ReadonlyArray<{
        from: string | null;
        to: string | null;
        from_freeform?: string | null;
        to_freeform?: string | null;
      }>
    | null;
}): RouteEndpoints {
  const first = trip.legs && trip.legs.length > 0 ? trip.legs[0] : null;
  const from =
    trip.departure_airport ?? first?.from ?? first?.from_freeform ?? '—';
  const to = trip.arrival_airport ?? first?.to ?? first?.to_freeform ?? '—';
  return { from, to };
}

function emailShell(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaUrl: string;
  ctaLabel: string;
  footer: string;
}): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;background:#050B14;font-family:'IBM Plex Sans Arabic','Inter',sans-serif;color:#FAFAFA">
    <span style="display:none;visibility:hidden;opacity:0;height:0;width:0">${escapeHtml(opts.preheader)}</span>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#050B14;padding:24px 0">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0A1628;border:1px solid rgba(201,169,97,0.25);border-radius:14px;padding:28px">
          <tr><td>
            <div style="font-family:'Playfair Display',serif;letter-spacing:0.28em;color:#E8D4A8;font-size:22px">AERIS</div>
            <h1 style="margin:18px 0 12px;font-size:20px;color:#FAFAFA;font-weight:600">${escapeHtml(opts.heading)}</h1>
            <div style="margin-top:12px;color:#A8B2C1;font-size:14px;line-height:1.8">${opts.bodyHtml}</div>
            <div style="margin-top:26px;text-align:center">
              <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;background:#C9A961;color:#0A1628;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:10px;font-size:15px">${escapeHtml(opts.ctaLabel)}</a>
            </div>
            <p style="margin:24px 0 0;color:#6B7A8F;font-size:12px;text-align:center">${escapeHtml(opts.footer)}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function detailRows(rows: ReadonlyArray<[string, string]>): string {
  const body = rows
    .map(
      ([label, valueHtml]) =>
        `<tr><td style="padding:6px 0;color:#A8B2C1;width:140px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 0;color:#FAFAFA;font-weight:500">${valueHtml}</td></tr>`
    )
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-top:1px solid rgba(201,169,97,0.15);border-bottom:1px solid rgba(201,169,97,0.15);padding:8px 0;font-size:14px">${body}</table>`;
}

function phoneCell(phone: string | null, waGreeting: string): string {
  if (!phone) return '—';
  const waUrl = `https://wa.me/${normalizeWhatsAppPhone(phone)}?text=${encodeURIComponent(waGreeting)}`;
  return `<a href="tel:${escapeHtml(phone)}" style="color:#E8D4A8;text-decoration:none">${escapeHtml(formatPhone(phone))}</a> · <a href="${escapeHtml(waUrl)}" style="color:#C9A961;text-decoration:none">واتساب</a>`;
}

// ------------------------------------------------------------------
// Founder: operator submitted an offer
// ------------------------------------------------------------------

export interface BuildFounderOfferReceivedEmailInput {
  request_number: string;
  route: RouteEndpoints;
  departure_date: string | null;
  operator_name: string;
  total_price_sar: number;
  aircraft: string | null;
  /** 'client' = signed-in portal request; 'guest' = promoted lead. */
  customer_kind: 'client' | 'guest';
  customer_name: string | null;
  customer_phone: string | null;
  admin_url: string;
}

export function buildFounderOfferReceivedEmail(
  input: BuildFounderOfferReceivedEmailInput
): BuiltEmail {
  const customerLabel =
    input.customer_kind === 'client' ? 'عميل مسجّل' : 'عميل زائر (بدون حساب)';
  const nextStep =
    input.customer_kind === 'client'
      ? 'أُبلغ العميل بوصول عرض جديد ويمكنه مراجعته وقبوله من حسابه.'
      : 'أُبلغ العميل عبر واتساب بوصول عرض — تواصل معه لعرض التفاصيل وتأكيد الحجز.';
  const greeting = `مرحباً ${input.customer_name ?? ''}، نتواصل معك من فريق Aeris بخصوص طلبك ${input.request_number}.`;

  const bodyHtml = `
    <p style="margin:0">وصل عرض جديد من مشغّل على الطلب <span style="color:#E8D4A8;font-family:Consolas,monospace">${escapeHtml(input.request_number)}</span>.</p>
    ${detailRows([
      ['المسار', `${escapeHtml(input.route.from)} ← ${escapeHtml(input.route.to)}`],
      ['موعد المغادرة', `${escapeHtml(formatRiyadhDateTime(input.departure_date))} (توقيت الرياض)`],
      ['المشغّل', escapeHtml(input.operator_name)],
      ['الطائرة', escapeHtml(input.aircraft ?? '—')],
      ['السعر الإجمالي', escapeHtml(formatSAR(input.total_price_sar))],
      ['نوع العميل', escapeHtml(customerLabel)],
      ['العميل', escapeHtml(input.customer_name ?? '—')],
      ['الهاتف', phoneCell(input.customer_phone, greeting)],
    ])}
    <p style="margin:16px 0 0">${escapeHtml(nextStep)}</p>`;

  return {
    subject: `عرض جديد على الطلب ${input.request_number} · ${input.operator_name}`,
    html: emailShell({
      preheader: `عرض جديد على الطلب ${input.request_number}`,
      heading: 'وصل عرض جديد من مشغّل',
      bodyHtml,
      ctaUrl: input.admin_url,
      ctaLabel: 'فتح الطلب في لوحة Aeris',
      footer: 'إشعار تلقائي من نظام Aeris · لا تردّ على هذا البريد.',
    }),
  };
}

// ------------------------------------------------------------------
// Signed-in client: «وصلك عرض جديد»
// ------------------------------------------------------------------

export interface BuildClientOfferReceivedInput {
  full_name: string;
  request_number: string;
  route: RouteEndpoints;
  /** Absolute /me/requests/<id> URL. */
  request_url: string;
}

export function buildClientOfferReceivedEmail(
  input: BuildClientOfferReceivedInput
): BuiltEmail {
  const name = input.full_name.trim();
  const bodyHtml = `
    <p style="margin:0">مرحباً ${escapeHtml(name || 'بك')}،</p>
    <p style="margin:12px 0 0">وصلك عرض جديد على طلب رحلتك:</p>
    ${detailRows([
      ['رقم الطلب', escapeHtml(input.request_number)],
      ['المسار', `${escapeHtml(input.route.from)} ← ${escapeHtml(input.route.to)}`],
    ])}
    <p style="margin:16px 0 0">راجع تفاصيل العرض وقارنه بغيره من حسابك، وعند قبولك سيتواصل معك فريق Aeris لتأكيد الحجز.</p>`;

  return {
    subject: `Aeris — وصلك عرض جديد على طلبك ${input.request_number}`,
    html: emailShell({
      preheader: `وصلك عرض جديد على طلب رحلتك ${input.request_number}`,
      heading: 'وصلك عرض جديد',
      bodyHtml,
      ctaUrl: input.request_url,
      ctaLabel: 'عرض العرض',
      footer: 'فريق Aeris · aeris.sa',
    }),
  };
}

export function buildClientOfferReceivedWhatsAppBody(
  input: BuildClientOfferReceivedInput
): string {
  const name = input.full_name.trim();
  return [
    name ? `مرحباً ${name}،` : 'مرحباً،',
    '',
    `وصلك عرض جديد على طلب رحلتك ${input.request_number} (${input.route.from} ← ${input.route.to}).`,
    'راجع العرض وقارنه من حسابك:',
    '',
    input.request_url,
    '',
    'فريق Aeris',
  ].join('\n');
}

// ------------------------------------------------------------------
// Guest lead (no account): offer arrived, team will reach out
// ------------------------------------------------------------------

export interface BuildGuestOfferReceivedInput {
  customer_name: string | null;
  request_number: string;
  route: RouteEndpoints;
}

export function buildGuestOfferReceivedWhatsAppBody(
  input: BuildGuestOfferReceivedInput
): string {
  const name = (input.customer_name ?? '').trim();
  return [
    name ? `مرحباً ${name}،` : 'مرحباً،',
    '',
    `وصل عرض جديد على طلب رحلتك ${input.request_number} (${input.route.from} ← ${input.route.to}).`,
    'سيتواصل معك فريق Aeris قريباً لعرض التفاصيل وتأكيد الحجز.',
    '',
    'فريق Aeris',
  ].join('\n');
}

// ------------------------------------------------------------------
// Founder: signed-in client created a charter request
// ------------------------------------------------------------------

export interface BuildFounderNewClientRequestEmailInput {
  request_number: string;
  route: RouteEndpoints;
  departure_date: string;
  return_date: string | null;
  passengers: number;
  /** Already-localised aircraft category label, or null for "no preference". */
  aircraft_pref_label: string | null;
  special_requests: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  /** True when ENABLE_TRIP_AUTO_DISTRIBUTION already dispatched it. */
  auto_distribution: boolean;
  admin_url: string;
}

export function buildFounderNewClientRequestEmail(
  input: BuildFounderNewClientRequestEmailInput
): BuiltEmail {
  const greeting = `مرحباً ${input.client_name ?? ''}، نتواصل معك من فريق Aeris بخصوص طلبك ${input.request_number}.`;
  const nextStep = input.auto_distribution
    ? 'وُزّع الطلب تلقائياً على المشغّلين — تابع وصول العروض من لوحة الإدارة.'
    : 'التوزيع التلقائي متوقف — وزّع الطلب على المشغّلين يدوياً من لوحة الإدارة.';

  const rows: Array<[string, string]> = [
    ['المسار', `${escapeHtml(input.route.from)} ← ${escapeHtml(input.route.to)}`],
    ['موعد المغادرة', `${escapeHtml(formatRiyadhDateTime(input.departure_date))} (توقيت الرياض)`],
    ['موعد العودة', escapeHtml(input.return_date ? formatRiyadhDateTime(input.return_date) : '—')],
    ['عدد الركاب', escapeHtml(String(input.passengers))],
    ['فئة الطائرة', escapeHtml(input.aircraft_pref_label ?? 'لا تفضيل')],
    ['العميل', escapeHtml(input.client_name ?? '—')],
    ['الهاتف', phoneCell(input.client_phone, greeting)],
    ['البريد', escapeHtml(input.client_email ?? '—')],
  ];
  if (input.special_requests) {
    rows.push(['طلبات خاصة', escapeHtml(input.special_requests)]);
  }

  const bodyHtml = `
    <p style="margin:0">أنشأ عميل مسجّل طلب رحلة جديداً <span style="color:#E8D4A8;font-family:Consolas,monospace">${escapeHtml(input.request_number)}</span>.</p>
    ${detailRows(rows)}
    <p style="margin:16px 0 0">${escapeHtml(nextStep)}</p>`;

  return {
    subject: `طلب رحلة جديد من عميل مسجّل · ${input.request_number}${input.client_name ? ` · ${input.client_name}` : ''}`,
    html: emailShell({
      preheader: `طلب رحلة جديد ${input.request_number}`,
      heading: 'طلب رحلة جديد من عميل مسجّل',
      bodyHtml,
      ctaUrl: input.admin_url,
      ctaLabel: 'فتح الطلب في لوحة Aeris',
      footer: 'إشعار تلقائي من نظام Aeris · لا تردّ على هذا البريد.',
    }),
  };
}
