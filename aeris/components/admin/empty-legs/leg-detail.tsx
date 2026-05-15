import Link from 'next/link';

import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import type { EmptyLegRow } from '@/lib/empty-legs/types';
import { EmptyLegStatusBadge } from './status-badge';
import {
  formatDateTimeAr,
  formatPercent,
  formatSarAmount,
  routeLabel,
} from './formatters';
import { PriceEditForm } from './price-edit-form';
import { CancelLegButton } from './cancel-button';
import { MarkSoldManualForm } from './mark-sold-form';
import { ReservationActions } from './reservation-actions';

interface EmptyLegDetailProps {
  leg: EmptyLegRow;
  // Phase 10 PR 2 — when leg.reservation_client_id IS NOT NULL,
  // the page server component pre-loads the client's display
  // fields and passes them here. The reservation snapshot
  // columns on the leg row are NULL for State C, so we display
  // these instead.
  reservationClient?: {
    full_name: string;
    contact_phone: string;
  } | null;
}

export function EmptyLegDetail({
  leg,
  reservationClient,
}: EmptyLegDetailProps) {
  const floor =
    leg.original_price !== null && leg.auction_floor_discount_pct !== null
      ? Math.round(
          leg.original_price * (1 - leg.auction_floor_discount_pct / 100)
        )
      : null;

  // Phase 10 PR 2 — for State C reservations, swap the snapshot
  // fields with the live client display fields. State B keeps
  // the original snapshot fields (which are populated for guest
  // reservations).
  const isClientReservation = leg.reservation_client_id !== null;
  const displayCustomerName = isClientReservation
    ? reservationClient?.full_name ?? null
    : leg.reservation_customer_name_snapshot;
  const displayCustomerPhone = isClientReservation
    ? reservationClient?.contact_phone ?? null
    : leg.reservation_customer_phone_snapshot;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <Link
            href="/admin/empty-legs"
            className="font-ar text-xs text-ink-muted hover:text-gold-light"
          >
            ← {emptyLegsAr.back}
          </Link>
          <h1 className="font-ar mt-2 text-2xl text-ink sm:text-3xl">
            {emptyLegsAr.pageDetailTitle}
          </h1>
          <div className="mt-1 font-mono text-sm text-gold-light">
            {leg.leg_number}
          </div>
        </div>
        <EmptyLegStatusBadge status={leg.status} />
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <Pair label={emptyLegsAr.detailRouteLabel}>
          {routeLabel(
            leg.departure_airport,
            leg.departure_airport_freeform_snapshot
          )}
          {' ← '}
          {routeLabel(
            leg.arrival_airport,
            leg.arrival_airport_freeform_snapshot
          )}
        </Pair>
        <Pair label={emptyLegsAr.detailWindowLabel}>
          {formatDateTimeAr(leg.departure_window_start)}
          {' ← '}
          {formatDateTimeAr(leg.departure_window_end)}
        </Pair>
        <Pair label={emptyLegsAr.detailFlexibilityLabel}>
          {leg.flexibility_hours ?? 0} {emptyLegsAr.detailFlexibilityHoursSuffix}
        </Pair>
        <Pair label={emptyLegsAr.detailMaxPassengersLabel}>
          {leg.max_passengers}
        </Pair>
        <Pair label={emptyLegsAr.detailOriginalPriceLabel}>
          {formatSarAmount(leg.original_price)}
        </Pair>
        <Pair label={emptyLegsAr.detailCurrentPriceLabel}>
          {formatSarAmount(leg.current_price)}
        </Pair>
        <Pair label={emptyLegsAr.detailDiscountPctLabel}>
          {formatPercent(leg.current_discount_pct)}
        </Pair>
        <Pair label={emptyLegsAr.detailAuctionWindowLabel}>
          {formatDateTimeAr(leg.auction_window_start_at)}
          {' ← '}
          {formatDateTimeAr(leg.auction_window_end_at)}
        </Pair>
        <Pair label={emptyLegsAr.detailAuctionCurveLabel}>
          {leg.auction_curve === 'linear'
            ? emptyLegsAr.fieldAuctionCurveLinear
            : leg.auction_curve === 'accelerating'
              ? emptyLegsAr.fieldAuctionCurveAccelerating
              : emptyLegsAr.detailNotProvided}
        </Pair>
        <Pair label={emptyLegsAr.detailOperatorLabel}>
          {leg.operator_name_snapshot ?? emptyLegsAr.detailNotProvided}
        </Pair>
        <Pair label={emptyLegsAr.detailAircraftLabel}>
          {leg.aircraft_snapshot ?? emptyLegsAr.detailNotProvided}
        </Pair>
      </section>

      {leg.status === 'available' ? (
        <section className="space-y-3">
          <h2 className="font-ar text-base text-ink">
            {emptyLegsAr.caseAvailableTitle}
          </h2>
          <PriceEditForm
            legId={leg.id}
            currentPrice={leg.current_price}
            floorPrice={floor}
            originalPrice={leg.original_price}
          />
          <CancelLegButton legId={leg.id} />
          <MarkSoldManualForm legId={leg.id} />
        </section>
      ) : null}

      {leg.status === 'reserved' ? (
        <section className="space-y-3">
          <h2 className="font-ar text-base text-ink">
            {isClientReservation
              ? emptyLegsAr.caseReservedClientTitle
              : emptyLegsAr.caseReservedTitle}
          </h2>
          <ReservationActions
            legId={leg.id}
            customerName={displayCustomerName}
            customerPhone={displayCustomerPhone}
            expiresAt={leg.reservation_expires_at}
            reservationClientId={leg.reservation_client_id}
          />
        </section>
      ) : null}

      {leg.status === 'sold' ? (
        <section className="space-y-3">
          <h2 className="font-ar text-base text-ink">
            {emptyLegsAr.caseSoldTitle}
          </h2>
          {/*
            Codex round-1 P2 #2 fix. The prior draft linked
            to /admin/bookings/<id>, but no booking-detail
            route exists in the codebase yet (admin currently
            ships leads + trips + trip-addons + empty-legs
            only). Until that route exists, render the
            booking id as copy-only text plus a hint, so the
            founder is not sent to a 404. When the bookings
            admin page lands in a future phase, swap this
            block back to a Link.
          */}
          <div className="rounded-lg border border-border bg-navy-secondary/40 p-4">
            {leg.customer_booking_id ? (
              <>
                <p className="font-ar text-sm text-ink">
                  {emptyLegsAr.soldBookingId}:{' '}
                  <span dir="ltr" className="font-mono text-gold-light">
                    {leg.customer_booking_id}
                  </span>
                </p>
                <p className="font-ar mt-2 text-xs text-ink-muted">
                  {emptyLegsAr.soldBookingDeepLinkPending}
                </p>
              </>
            ) : (
              <p className="font-ar text-sm text-ink-muted">
                {emptyLegsAr.soldBookingMissing}
              </p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Pair({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-navy-card/40 p-3">
      <div className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </div>
      <div className="font-ar mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}
