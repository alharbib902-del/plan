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
    `• السعر الجديد: ${priceSar} ريال (${discountPct}% خصم)`,
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
