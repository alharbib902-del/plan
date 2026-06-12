/**
 * Phase 7 PR 2e — wa.me prefilled message body for the
 * `price_dropped` event.
 *
 * Same shape as the `published` template but with an
 * urgency framing ("السعر انخفض") instead of a discovery
 * framing ("وجدنا لك رحلة"). The opt-out URL is identical.
 */

export interface LegPriceDroppedTemplateInput {
  legNumber: string;
  routeFrom: string;
  routeTo: string;
  currentPrice: number;
  currentDiscountPct: number;
  legUrl: string;
  optOutUrl: string;
  customerName: string | null;
  /** 2026-06 request-to-book — when false the body shows the discount
   *  % only (no SAR amount); Aeris sends the price manually after the
   *  seriousness check. Defaults to true so the function stays pure and
   *  existing callers/tests are unchanged. */
  includePricing?: boolean;
}

export function buildLegPriceDroppedWhatsAppBody(
  input: LegPriceDroppedTemplateInput
): string {
  const greeting = input.customerName
    ? `مرحباً ${input.customerName}،`
    : 'مرحباً،';
  const priceSar = formatSar(input.currentPrice);
  const discountPct = formatPct(input.currentDiscountPct);

  return [
    greeting,
    '',
    `انخفض سعر الرحلة الفارغة التي سبق أن أبدينا اهتمامك بها:`,
    `• الرقم: ${input.legNumber}`,
    `• المسار: ${input.routeFrom} ← ${input.routeTo}`,
    input.includePricing === false
      ? `• الخصم الحالي: ${discountPct}%`
      : `• السعر الجديد: ${priceSar} ريال (${discountPct}% خصم)`,
    '',
    `قد تختفي المقاعد بسرعة. للحجز:`,
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
