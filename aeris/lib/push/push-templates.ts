/**
 * Pure push notification templates (NO 'server-only', tsx-testable). Arabic,
 * no PII — only the route + event, plus the price ONLY when client pricing is
 * visible (mirroring the email/wa bodies). The deep-link target rides in the
 * FCM `data` payload (leg_number), not the visible text.
 */

export interface PushTemplate {
  title: string;
  body: string;
}

export interface EmptyLegPushArgs {
  eventType: 'published' | 'price_dropped';
  routeFrom: string;
  routeTo: string;
  /** Visible only when includePricing (clientPricingVisible()). */
  currentPrice?: number | null;
  includePricing: boolean;
}

function priceSuffix(args: EmptyLegPushArgs): string {
  if (!args.includePricing) return '';
  const p = args.currentPrice;
  if (p == null || !Number.isFinite(p) || p <= 0) return '';
  return ` — ${new Intl.NumberFormat('en-US').format(p)} ريال`;
}

export function buildEmptyLegPushTemplate(args: EmptyLegPushArgs): PushTemplate {
  const route = `${args.routeFrom} → ${args.routeTo}`;
  if (args.eventType === 'price_dropped') {
    return {
      title: 'انخفض سعر رحلة فارغة',
      body: `${route}${priceSuffix(args)}`,
    };
  }
  return {
    title: 'رحلة فارغة جديدة',
    body: `${route}${priceSuffix(args)}`,
  };
}
