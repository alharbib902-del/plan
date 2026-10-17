import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ReservationCountdown } from '@/components/public/empty-legs/countdown';
import { ReservedActions } from '@/components/public/empty-legs/reserved-actions';
import {
  formatDateTimeAr,
  formatSarAmount,
  routeLabel,
} from '@/components/admin/empty-legs/formatters';
import { getPublicLegByNumber } from '@/lib/empty-legs/public-queries';
import {
  hashReservationToken,
  verifyReservationToken,
} from '@/lib/empty-legs/reservation-token';
import { whatsappLink } from '@/lib/utils/format';
import { clientPricingVisible } from '@/lib/empty-legs/pricing-visibility';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.publicReservedTitle,
};

interface PageProps {
  params: Promise<{ leg_number: string }>;
  searchParams?: Promise<{ token?: string }>;
}

// One card for every rejection layer so the visitor still cannot tell
// which check failed; in practice the overwhelmingly common cause is a
// lapsed hold, hence the expiry-first wording + a way back.
function HoldUnavailableCard({ legNumber }: { legNumber: string }) {
  return (
    <section className="mx-auto max-w-2xl px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-border bg-navy-card/30 px-5 py-8 text-center">
        <h1 className="font-ar text-xl text-ink sm:text-2xl">
          {emptyLegsAr.publicReservedExpiredTitle}
        </h1>
        <p className="font-ar mx-auto mt-3 max-w-md text-sm leading-7 text-ink-secondary">
          {emptyLegsAr.publicReservedExpiredBody}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={`/empty-legs/${encodeURIComponent(legNumber)}`}
            className="font-ar inline-flex min-h-[44px] items-center rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light transition-colors hover:border-gold hover:bg-gold/20"
          >
            {emptyLegsAr.publicReservedExpiredBackToLeg}
          </Link>
          <Link
            href="/empty-legs"
            className="font-ar inline-flex min-h-[44px] items-center px-3 text-sm text-ink-secondary transition-colors hover:text-gold-light"
          >
            {emptyLegsAr.publicReservedExpiredBrowse}
          </Link>
        </div>
      </div>
    </section>
  );
}

export default async function PublicEmptyLegReservedPage({
  params,
  searchParams,
}: PageProps) {
  if (process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE !== 'true') {
    notFound();
  }

  const { leg_number } = await params;
  const resolvedSearchParams = (await searchParams) ?? undefined;

  // Codex round-1 P1 #1 fix. The reserved page reads via
  // the admin Supabase client (no RLS), so a guessed
  // `EL-...` would otherwise expose any held leg's route,
  // price, expiry countdown, and WhatsApp CTA to anon
  // visitors. We require the caller to supply the
  // reservation token in the `?token=` query param and
  // validate it through three layers BEFORE rendering
  // any reserved data:
  //
  //   Layer 1 — HMAC signature + payload `expires_at`
  //             (verifyReservationToken).
  //   Layer 2 — Token's payload.leg_id matches the row's
  //             id AND status='reserved' AND
  //             sha256(rawToken) === row.reservation_token_hash
  //             (this also covers the post-cancel state
  //             where status flipped back to 'available'
  //             and the hash was cleared to NULL).
  //   Layer 3 — Row-level reservation_expires_at > NOW()
  //             — defense in depth alongside Layer 1.
  //
  // Any failure renders the same opaque hold-unavailable
  // card — the visitor cannot tell which layer rejected.
  const token = resolvedSearchParams?.token ?? '';
  if (!token) {
    return <HoldUnavailableCard legNumber={leg_number} />;
  }

  const verified = verifyReservationToken(token);
  if (!verified.valid) {
    return <HoldUnavailableCard legNumber={leg_number} />;
  }

  const leg = await getPublicLegByNumber(leg_number, {
    allowedStatuses: ['available', 'reserved'],
  });
  if (!leg) {
    return <HoldUnavailableCard legNumber={leg_number} />;
  }

  if (verified.payload.leg_id !== leg.id) {
    return <HoldUnavailableCard legNumber={leg_number} />;
  }

  if (
    leg.status !== 'reserved' ||
    leg.reservation_token_hash === null ||
    hashReservationToken(token) !== leg.reservation_token_hash
  ) {
    return <HoldUnavailableCard legNumber={leg_number} />;
  }

  if (
    leg.reservation_expires_at === null ||
    Date.parse(leg.reservation_expires_at) <= Date.now()
  ) {
    return <HoldUnavailableCard legNumber={leg_number} />;
  }

  const expiresAt = leg.reservation_expires_at;

  const waUrl = whatsappLink(
    `مرحباً Aeris، حجزت رحلة ${leg.leg_number} وأود تأكيد الدفع.`
  );

  return (
    <section className="mx-auto max-w-2xl px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <Link
        href={`/empty-legs/${leg.leg_number}`}
        className="font-ar text-xs text-ink-muted hover:text-gold-light"
      >
        ← {emptyLegsAr.publicLegPageBack}
      </Link>
      <h1 className="font-ar mt-2 text-3xl text-ink sm:text-4xl">
        {clientPricingVisible()
          ? emptyLegsAr.publicReservedTitle
          : emptyLegsAr.pricingHiddenReservedTitle}
      </h1>
      <p className="font-ar mt-2 text-base text-ink-secondary">
        {clientPricingVisible()
          ? emptyLegsAr.publicReservedHint
          : emptyLegsAr.pricingHiddenReservedHint}
      </p>

      <article className="mt-6 rounded-xl border border-gold/30 bg-gold/5 p-5">
        <div className="font-mono text-xs text-gold-light">
          {leg.leg_number}
        </div>
        <div className="font-ar mt-1 text-lg text-ink">
          {routeLabel(
            leg.departure_airport,
            leg.departure_airport_freeform_snapshot
          )}
          {' ← '}
          {routeLabel(
            leg.arrival_airport,
            leg.arrival_airport_freeform_snapshot
          )}
        </div>
        <div className="font-ar mt-1 text-sm text-ink-secondary">
          {formatDateTimeAr(leg.departure_window_start)} ←{' '}
          {formatDateTimeAr(leg.departure_window_end)}
        </div>
        <div className="font-ar mt-3 text-base">
          {clientPricingVisible()
            ? `${formatSarAmount(leg.current_price)} ${emptyLegsAr.publicLegSar}`
            : emptyLegsAr.pricingHiddenCardPrice}
        </div>

        {expiresAt && leg.status === 'reserved' ? (
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-gold/20 pt-4">
            <div>
              <div className="font-ar text-xs text-ink-muted">
                {emptyLegsAr.publicReservedExpiresAt}
              </div>
              <div className="font-ar mt-1 text-xs text-ink-secondary">
                {formatDateTimeAr(expiresAt)}
              </div>
            </div>
            <ReservationCountdown targetIso={expiresAt} />
          </div>
        ) : null}
      </article>

      <div className="mt-6">
        <ReservedActions
          legNumber={leg.leg_number}
          reservationToken={token}
          whatsappUrl={waUrl}
        />
      </div>
    </section>
  );
}
