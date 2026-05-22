import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import { getEmptyLegByNumber } from '@/lib/clients/queries/me-empty-legs';
import { ReserveEmptyLegButton } from '@/components/clients/reserve-empty-leg-button';
import { CancelEmptyLegButton } from '@/components/clients/cancel-empty-leg-button';
import { AuctionCountdown } from '@/components/clients/auction-countdown';
import { ClientBanner } from '@/components/clients/error-banner';
import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 10 PR 2 — `/me/empty-legs/[leg_number]` detail page.
 *
 * Renders one of four states based on the leg + reservation
 * relationship to the authenticated client:
 *
 *   1. Available + reservable → reserve button + countdown to
 *      auction window end
 *   2. Reserved by THIS client (State C, current session match)
 *      → "تم الحجز" banner + countdown to reservation expiry +
 *      cancel button
 *   3. Reserved by ANOTHER (guest or different client) →
 *      read-only "غير متاح حالياً" message
 *   4. Sold / expired / cancelled → terminal state copy
 *
 * Gated behind both Phase 9 + Phase 10 flags.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ leg_number: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { leg_number } = await params;
  return {
    title: `${clientsAr.emptyLegsPortalTitle} — ${leg_number}`,
    robots: { index: false, follow: false },
  };
}

function legRouteLabel(leg: {
  departure_airport: string | null;
  departure_airport_freeform_snapshot: string | null;
  arrival_airport: string | null;
  arrival_airport_freeform_snapshot: string | null;
}): string {
  const dep =
    leg.departure_airport ?? leg.departure_airport_freeform_snapshot ?? '—';
  const arr =
    leg.arrival_airport ?? leg.arrival_airport_freeform_snapshot ?? '—';
  return `${dep} → ${arr}`;
}

function formatSAR(value: number | string | null): string {
  if (value === null || value === undefined) return '—';
  const numeric =
    typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    numeric
  );
}

function formatDateTimeAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function ClientMeEmptyLegDetailPage({
  params,
}: PageProps) {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  if (process.env.ENABLE_CLIENT_EMPTY_LEGS_PORTAL !== 'true') notFound();

  const { leg_number } = await params;
  const session = await requireClientSession();
  const leg = await getEmptyLegByNumber(leg_number);
  if (!leg) notFound();

  const isReservedByMe =
    leg.status === 'reserved' &&
    leg.reservation_client_id === session.client_id;
  const isReservedByOther =
    leg.status === 'reserved' && !isReservedByMe;
  const isAvailable = leg.status === 'available';
  const isTerminal =
    leg.status === 'sold' ||
    leg.status === 'cancelled' ||
    leg.status === 'expired';

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <p className="font-ar text-xs text-ink-muted">
          {clientsAr.emptyLegsPortalTitle}
        </p>
        <h1
          dir="ltr"
          className="font-ar text-2xl text-ink-primary sm:text-3xl"
        >
          {leg.leg_number}
        </h1>
      </header>

      <div className="rounded-xl border border-border bg-navy-card/40 p-6">
        <dl className="font-ar grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted">{clientsAr.emptyLegsCardRoute}</dt>
            <dd dir="ltr" className="mt-1 text-base text-ink-primary">
              {legRouteLabel(leg)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">
              {clientsAr.emptyLegsCardDeparture}
            </dt>
            <dd className="mt-1 text-ink-primary">
              {formatDateTimeAr(leg.departure_window_start)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">{clientsAr.emptyLegsCardPrice}</dt>
            <dd className="mt-1 text-ink-primary">
              {formatSAR(leg.current_price as unknown as number | string)}{' '}
              <span className="text-xs text-ink-muted">ريال</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">
              {clientsAr.emptyLegsCardDiscount}
            </dt>
            <dd className="mt-1 text-gold-light">
              {leg.current_discount_pct
                ? `${leg.current_discount_pct}%`
                : '—'}
            </dd>
          </div>
          {isAvailable && leg.auction_window_end_at ? (
            <div className="sm:col-span-2">
              <AuctionCountdown
                auctionWindowEndAt={leg.auction_window_end_at}
              />
            </div>
          ) : null}
          {isReservedByMe && leg.reservation_expires_at ? (
            <div className="sm:col-span-2">
              <AuctionCountdown
                auctionWindowEndAt={null}
                reservationExpiresAt={leg.reservation_expires_at}
              />
            </div>
          ) : null}
        </dl>
      </div>

      {isAvailable ? (
        <ReserveEmptyLegButton legId={leg.id} />
      ) : null}

      {isReservedByMe ? (
        <div className="space-y-3">
          <ClientBanner kind="info">
            <p>{clientsAr.emptyLegsReservedBanner}</p>
          </ClientBanner>
          <CancelEmptyLegButton legId={leg.id} />
        </div>
      ) : null}

      {isReservedByOther ? (
        <ClientBanner kind="warning">
          <p>{clientsAr.emptyLegsUnavailableNow}</p>
        </ClientBanner>
      ) : null}

      {isTerminal ? (
        <ClientBanner kind="info">
          <p>{clientsAr.emptyLegsTerminalState}</p>
        </ClientBanner>
      ) : null}
    </section>
  );
}
