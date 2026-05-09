/**
 * Phase 7 PR 2e — wa.me prefilled message body for the
 * `published` event.
 *
 * Hand-written Arabic-RTL. Embeds:
 *   - leg number (`EL-XXXX`)
 *   - route (origin → destination)
 *   - current price (SAR, Western digits per CLAUDE.md)
 *   - current discount %
 *   - marketplace deep-link to the leg's detail page
 *   - opt-out URL (single-purpose HMAC token, no expiry)
 *
 * Pure function — site URL + opt-out URL are passed in,
 * not read inline, so the unit test runs without env.
 */

export interface LegPublishedTemplateInput {
  legNumber: string;
  routeFrom: string;
  routeTo: string;
  currentPrice: number;
  currentDiscountPct: number;
  legUrl: string;
  optOutUrl: string;
  customerName: string | null;
}

export function buildLegPublishedWhatsAppBody(
  input: LegPublishedTemplateInput
): string {
  const greeting = input.customerName
    ? `مرحباً ${input.customerName}،`
    : 'مرحباً،';
  const priceSar = formatSar(input.currentPrice);
  const discountPct = formatPct(input.currentDiscountPct);

  return [
    greeting,
    '',
    `وجدنا لك رحلة فارغة تناسب اهتمامك:`,
    `• الرقم: ${input.legNumber}`,
    `• المسار: ${input.routeFrom} ← ${input.routeTo}`,
    `• السعر الحالي: ${priceSar} ريال (${discountPct}% خصم)`,
    '',
    `للتفاصيل والحجز:`,
    input.legUrl,
    '',
    `لإيقاف الإشعارات:`,
    input.optOutUrl,
  ].join('\n');
}

function formatSar(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPct(value: number): string {
  return Math.round(value).toString();
}
