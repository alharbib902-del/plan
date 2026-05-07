import type { Metadata } from 'next';

import {
  hashCheckoutToken,
  verifyCheckoutToken,
} from '@/lib/checkout/customer-token';
import { createAdminClient } from '@/lib/supabase/admin';
import { listAirports } from '@/lib/supabase/queries/airports';
import {
  getBookingById,
  listBookingAddons,
} from '@/lib/supabase/queries/bookings';
import { ADDONS_BY_SUBTYPE } from '@/lib/addons/catalog';
import { formatRouteEndpoint } from '@/lib/checkout/route-display';
import { buildWhatsappConfirmMessage } from '@/lib/checkout/whatsapp-message';
import { formatRiyadhDateTime, t } from '@/lib/i18n/operator';
import type { AirportRow, BookingAddonRow, BookingRow } from '@/types/database';
import { CheckoutPrepClient } from '@/components/checkout/checkout-prep-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'مراجعة الحجز',
  robots: { index: false, follow: false },
};

interface CheckoutPrepPageProps {
  params: { token: string };
}

const WHATSAPP_NUMBER = '966558048004';

/**
 * Site URL used to build the personal review URL embedded in
 * the WhatsApp confirm-message body. Falls back to the
 * current Vercel production hostname when
 * `NEXT_PUBLIC_SITE_URL` isn't set (so the link still works
 * during the aeris.sa DNS migration). The value is read on
 * each request — server component, no build-time inlining
 * gotchas.
 */
function resolveSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
    return fromEnv.replace(/\/+$/, '');
  }
  return 'https://aeris-flax.vercel.app';
}

/**
 * Phase 6.2 PR 2b: customer checkout-prep page.
 *
 * Three-layer token validation per spec S5 + Codex
 * iteration-4 P2 #3 fix:
 *   1. **Signature + payload exp** via
 *      `verifyCheckoutToken(token)`. HMAC against
 *      `CUSTOMER_CHECKOUT_SECRET`; asserts `payload.exp >
 *      NOW()`. Returns `null` on any failure (also on
 *      missing-secret per the fail-closed posture).
 *   2. **DB hash match**: `bookings.checkout_token_hash =
 *      sha256(token)`. Catches token rotation.
 *   3. **DB expiry**: `bookings.checkout_token_expires_at >
 *      NOW()`. Founder soft-revoke lever.
 *
 * Any layer's failure renders the same "expired or not-
 * issued" surface — defense in depth. Customer cannot tell
 * which check failed.
 *
 * On success: renders the flight summary (from snapshot
 * fields), attached add-ons (with remove buttons for
 * pending), totals, WhatsApp deep link, and the confirm
 * button. Confirm flips every `'pending'` addon to
 * `'confirmed'` (idempotent; does NOT touch
 * `payment_status`).
 */
export default async function CheckoutPrepPage({
  params,
}: CheckoutPrepPageProps) {
  // Layer 1: signature + payload exp.
  const payload = verifyCheckoutToken(params.token);
  if (!payload) {
    return <ExpiredOrNotIssuedSurface />;
  }

  // Layer 2 + 3: DB hash + DB expiry.
  const expectedHash = hashCheckoutToken(params.token);
  const booking = await getBookingById(payload.booking_id);
  if (
    !booking ||
    !booking.checkout_token_hash ||
    booking.checkout_token_hash !== expectedHash ||
    !booking.checkout_token_expires_at ||
    new Date(booking.checkout_token_expires_at).getTime() <= Date.now()
  ) {
    return <ExpiredOrNotIssuedSurface />;
  }

  // All three layers passed. Load the addons + airports for
  // the rich render. The addons table is RLS deny-all so
  // we go through service role same as everywhere else.
  const [addons, airports] = await Promise.all([
    listBookingAddons(booking.id),
    listAirports({ privateCapable: true }),
  ]);

  return (
    <CheckoutPrepView
      token={params.token}
      booking={booking}
      addons={addons}
      airports={airports}
    />
  );
}

// ────────────────────────────────────────────────────────────
// Verified-success view
// ────────────────────────────────────────────────────────────

function CheckoutPrepView({
  token,
  booking,
  addons,
  airports,
}: {
  token: string;
  booking: BookingRow;
  addons: BookingAddonRow[];
  airports: AirportRow[];
}) {
  const lang = 'ar' as const;
  const origin = formatRouteEndpoint(
    booking.route_origin_iata,
    booking.route_origin_freeform_snapshot,
    airports,
    lang
  );
  const destination = formatRouteEndpoint(
    booking.route_destination_iata,
    booking.route_destination_freeform_snapshot,
    airports,
    lang
  );

  // Active addons drive both the displayed list and the
  // total. Cancelled rows are visible but greyed out;
  // delivered is treated as active for sums.
  const activeAddons = addons.filter(
    (a) => a.status !== 'cancelled'
  );

  const baseAmount = Number(booking.base_amount);
  const addonsAmount = Number(booking.addons_amount);
  const totalAmount = Number(booking.total_amount);

  // PR 2c: WhatsApp prefilled body uses the rich confirm-
  // message template (greeting, booking details, totals,
  // personal review URL). The builder is a pure helper in
  // `lib/checkout/whatsapp-message.ts` (unit-tested via
  // `npm run test:checkout-whatsapp`).
  const siteUrl = resolveSiteUrl();
  const reviewUrl = `${siteUrl}/booking/${token}/checkout-prep`;

  const whatsappMessageBody = buildWhatsappConfirmMessage({
    customerName: booking.customer_name_snapshot,
    bookingNumber: booking.booking_number,
    routeFormatted: `${origin} ← ${destination}`,
    departureFormatted: formatRiyadhDateTime(
      booking.departure_scheduled,
      lang
    ),
    returnFormatted: booking.return_scheduled
      ? formatRiyadhDateTime(booking.return_scheduled, lang)
      : null,
    passengersCount: booking.passengers_count_snapshot,
    baseAmount: baseAmount,
    addonsAmount: addonsAmount,
    totalAmount: totalAmount,
    activeAddons: activeAddons.map((addon) => {
      const catalogEntry = ADDONS_BY_SUBTYPE.get(addon.addon_subtype);
      return {
        labelAr: catalogEntry?.label_ar ?? addon.addon_subtype,
        quantity: addon.quantity,
        totalPrice: Number(addon.total_price),
      };
    }),
    reviewUrl,
  });
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappMessageBody)}`;

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-navy-card/40 p-6">
        <div className="font-mono text-sm text-gold-light">
          {booking.booking_number}
        </div>
        <h1 className="font-ar mt-1 text-xl text-ink">
          {t('checkout_prep_page_title', lang)}
        </h1>
      </header>

      {/* Flight summary */}
      <section className="rounded-xl border border-border bg-navy-card/40 p-6">
        <h2 className="font-ar text-base font-medium text-ink">
          {t('checkout_prep_flight_summary_heading', lang)}
        </h2>
        <dl className="mt-4 space-y-3">
          <Row label={t('route_label', lang)}>
            <span className="font-ar text-ink">{origin}</span>
            <span aria-hidden> ← </span>
            <span className="font-ar text-ink">{destination}</span>
          </Row>
          <Row label={t('departure_label', lang)}>
            {formatRiyadhDateTime(booking.departure_scheduled, lang)}
          </Row>
          {booking.return_scheduled && (
            <Row label={t('return_label', lang)}>
              {formatRiyadhDateTime(booking.return_scheduled, lang)}
            </Row>
          )}
          <Row label={t('passengers_label', lang)}>
            {booking.passengers_count_snapshot ?? '—'}
          </Row>
        </dl>
      </section>

      {/* Add-ons */}
      <section className="rounded-xl border border-border bg-navy-card/40 p-6">
        <h2 className="font-ar text-base font-medium text-ink">
          {t('checkout_prep_addons_heading', lang)}
        </h2>
        {activeAddons.length === 0 ? (
          <p className="font-ar mt-3 text-sm text-ink-muted">
            لا توجد خدمات مُلحقة بهذا الحجز.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/40">
            {addons.map((addon) => (
              <CheckoutPrepAddonRow
                key={addon.id}
                addon={addon}
                lang={lang}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Totals */}
      <section className="rounded-xl border border-border bg-navy-card/40 p-6">
        <h2 className="font-ar text-base font-medium text-ink">
          {t('checkout_prep_totals_heading', lang)}
        </h2>
        <dl className="font-ar mt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-ink-muted">
              {t('checkout_prep_subtotal_label', lang)}
            </dt>
            <dd className="text-ink">
              {baseAmount.toLocaleString()} ريال
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-ink-muted">
              {t('checkout_prep_addons_subtotal_label', lang)}
            </dt>
            <dd className="text-ink">
              {addonsAmount.toLocaleString()} ريال
            </dd>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
            <dt className="font-medium text-ink">
              {t('checkout_prep_grand_total_label', lang)}
            </dt>
            <dd className="font-medium text-gold-light">
              {totalAmount.toLocaleString()} ريال
            </dd>
          </div>
        </dl>
        <p className="font-ar mt-4 rounded-md border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">
          {t('checkout_prep_payment_offline_notice', lang)}
        </p>
      </section>

      {/* Actions: confirm + WhatsApp + per-addon remove */}
      <CheckoutPrepClient
        token={token}
        bookingNumber={booking.booking_number}
        addons={addons}
        whatsappUrl={whatsappUrl}
      />

      {/* Personal-link notice */}
      <p
        className="font-ar text-center text-xs text-ink-muted/60"
        role="note"
      >
        {t('checkout_prep_link_personal_notice', lang)}
      </p>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[100px,1fr] gap-3 sm:grid-cols-[140px,1fr]">
      <dt className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </dt>
      <dd className="font-ar text-sm text-ink">{children}</dd>
    </div>
  );
}

function CheckoutPrepAddonRow({
  addon,
  lang,
}: {
  addon: BookingAddonRow;
  lang: 'ar';
}) {
  const catalogEntry = ADDONS_BY_SUBTYPE.get(addon.addon_subtype);
  const label = catalogEntry?.label_ar ?? addon.addon_subtype;
  const isCancelled = addon.status === 'cancelled';

  return (
    <li
      className={`py-3 ${isCancelled ? 'opacity-50' : ''}`}
      data-addon-id={addon.id}
      data-addon-status={addon.status}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <div className="font-ar text-sm text-ink">{label}</div>
          {addon.details &&
            typeof addon.details === 'object' &&
            'note' in addon.details &&
            typeof addon.details.note === 'string' && (
              <div className="font-ar mt-1 text-xs text-ink-muted">
                {addon.details.note}
              </div>
            )}
        </div>
        <div className="font-ar shrink-0 text-xs text-ink-muted">
          ×{addon.quantity}
        </div>
        <div className="font-ar shrink-0 text-sm text-ink">
          {Number(addon.total_price).toLocaleString()} ريال
        </div>
        <span className="font-ar shrink-0 rounded-full border border-border bg-navy-secondary/40 px-2 py-0.5 text-[10px] text-ink-muted">
          {t(
            `addon_status_${addon.status}` as 'addon_status_pending',
            lang
          )}
        </span>
      </div>
    </li>
  );
}

// ────────────────────────────────────────────────────────────
// "Expired or not-issued" surface (token-validation failure)
// ────────────────────────────────────────────────────────────

function ExpiredOrNotIssuedSurface() {
  const lang = 'ar' as const;
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}`;
  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-8 text-center">
      <h1 className="font-ar text-lg font-medium text-amber-100">
        {t('checkout_prep_expired_title', lang)}
      </h1>
      <p className="font-ar mt-3 text-sm text-amber-100/80">
        {t('checkout_prep_expired_body', lang)}
      </p>
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-ar mt-6 inline-flex items-center gap-2 rounded-md bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100"
      >
        {t('whatsapp_contact_button', lang)}
      </a>
    </div>
  );
}
