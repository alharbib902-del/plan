import Link from 'next/link';

import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import {
  formatDateTimeAr,
  formatPercent,
  formatSarAmount,
  routeLabel,
} from '@/components/admin/empty-legs/formatters';
import type { EmptyLegRow } from '@/lib/empty-legs/types';
import { clientPricingVisible } from '@/lib/empty-legs/pricing-visibility';
import { PublicAuctionTrajectory } from './auction-trajectory';

export function PublicLegDetail({ leg }: { leg: EmptyLegRow }) {
  return (
    <article className="space-y-6">
      <header className="border-b border-border pb-4">
        <Link
          href="/empty-legs"
          className="font-ar text-xs text-ink-muted hover:text-gold-light"
        >
          ← {emptyLegsAr.publicLegPageBack}
        </Link>
        <h1 className="font-ar mt-2 text-3xl text-ink sm:text-4xl">
          {routeLabel(
            leg.departure_airport,
            leg.departure_airport_freeform_snapshot
          )}
          {' ← '}
          {routeLabel(
            leg.arrival_airport,
            leg.arrival_airport_freeform_snapshot
          )}
        </h1>
        <div className="mt-2 font-mono text-sm text-gold-light">
          {leg.leg_number}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <Pair label={emptyLegsAr.publicLegWindow}>
          {formatDateTimeAr(leg.departure_window_start)} ←{' '}
          {formatDateTimeAr(leg.departure_window_end)}
        </Pair>
        <Pair label={emptyLegsAr.publicLegMaxPassengers}>
          {leg.max_passengers}
        </Pair>
        {clientPricingVisible() ? (
          <>
            <Pair label={emptyLegsAr.publicLegOriginalPrice}>
              {formatSarAmount(leg.original_price)} {emptyLegsAr.publicLegSar}
            </Pair>
            <Pair label={emptyLegsAr.publicLegPrice}>
              <span className="text-2xl text-gold-light">
                {formatSarAmount(leg.current_price)}
              </span>{' '}
              <span className="text-sm">{emptyLegsAr.publicLegSar}</span>{' '}
              <span className="text-sm text-ink-muted">
                ({formatPercent(leg.current_discount_pct)}{' '}
                {emptyLegsAr.publicLegDiscount})
              </span>
            </Pair>
          </>
        ) : (
          <>
            <Pair label={emptyLegsAr.pricingHiddenPriceLabel}>
              <span className="text-xl text-gold-light">
                {emptyLegsAr.pricingHiddenValue}
              </span>{' '}
              <span className="text-xs text-ink-muted">
                {emptyLegsAr.pricingHiddenDetailNote}
              </span>
            </Pair>
            <Pair label={emptyLegsAr.publicLegDiscount}>
              <span className="text-xl text-gold-light">
                {formatPercent(leg.current_discount_pct)}
              </span>
            </Pair>
          </>
        )}
      </section>

      {clientPricingVisible() ? <PublicAuctionTrajectory leg={leg} /> : null}

      {leg.status === 'available' ? (
        <div className="flex justify-end">
          <Link
            href={`/empty-legs/${leg.leg_number}/reserve`}
            className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/15 px-6 py-3 text-base text-gold-light transition-colors hover:bg-gold/25"
          >
            {clientPricingVisible()
              ? emptyLegsAr.publicLegReserveCta
              : emptyLegsAr.pricingHiddenReserveCta}
            <span aria-hidden>←</span>
          </Link>
        </div>
      ) : leg.status === 'sold' ? (
        <p className="font-ar rounded-md border border-border bg-navy-secondary/40 px-4 py-3 text-sm text-ink-muted">
          {emptyLegsAr.publicLegSold}
        </p>
      ) : leg.status === 'expired' ? (
        <p className="font-ar rounded-md border border-border bg-navy-secondary/40 px-4 py-3 text-sm text-ink-muted">
          {emptyLegsAr.publicLegExpired}
        </p>
      ) : null}
    </article>
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
