import Link from 'next/link';

import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import {
  formatDateTimeAr,
  formatPercent,
  formatSarAmount,
  routeLabel,
} from '@/components/admin/empty-legs/formatters';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

export function PublicLegCard({ leg }: { leg: EmptyLegRow }) {
  return (
    <Link
      href={`/empty-legs/${leg.leg_number}`}
      className="group block rounded-2xl border border-border bg-navy-card/40 p-5 transition-all hover:border-gold/40 hover:bg-navy-card/60"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-gold-light">
            {leg.leg_number}
          </div>
          <div className="font-ar mt-2 text-lg text-ink sm:text-xl">
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
        </div>
        <div className="text-end">
          <div className="font-ar text-2xl text-gold-light sm:text-3xl">
            {formatSarAmount(leg.current_price)}
          </div>
          <div className="font-ar mt-1 text-xs text-ink-muted">
            {emptyLegsAr.publicLegSar} ·{' '}
            {formatPercent(leg.current_discount_pct)}{' '}
            {emptyLegsAr.publicLegDiscount}
          </div>
        </div>
      </header>

      <div className="mt-4 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-2">
        <div className="font-ar text-xs text-ink-muted">
          {emptyLegsAr.publicLegWindow}
        </div>
        <div className="font-ar text-xs text-ink">
          {formatDateTimeAr(leg.departure_window_start)} ←{' '}
          {formatDateTimeAr(leg.departure_window_end)}
        </div>
        <div className="font-ar text-xs text-ink-muted">
          {emptyLegsAr.publicLegMaxPassengers}
        </div>
        <div className="font-ar text-xs text-ink">
          {leg.max_passengers}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <span className="font-ar inline-flex items-center gap-1 text-sm text-gold-light transition-colors group-hover:text-gold">
          {emptyLegsAr.publicLegReserveCta}
          <span aria-hidden>←</span>
        </span>
      </div>
    </Link>
  );
}
