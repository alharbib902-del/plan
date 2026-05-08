import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import type { EmptyLegRow } from '@/lib/empty-legs/types';
import { EmptyLegStatusBadge } from './status-badge';
import {
  formatDateTimeAr,
  formatPercent,
  formatSarAmount,
  routeLabel,
} from './formatters';

export function EmptyLegsTable({ legs }: { legs: EmptyLegRow[] }) {
  if (legs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
        <p className="font-ar text-sm text-ink-muted">
          {emptyLegsAr.emptyListMessage}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border bg-navy-card/40 lg:block">
        <table className="w-full text-right">
          <thead className="border-b border-border bg-navy-secondary/60">
            <tr>
              <Th>{emptyLegsAr.colLegNumber}</Th>
              <Th>{emptyLegsAr.colRoute}</Th>
              <Th>{emptyLegsAr.colWindow}</Th>
              <Th>{emptyLegsAr.colPrice}</Th>
              <Th>{emptyLegsAr.colDiscount}</Th>
              <Th>{emptyLegsAr.colStatus}</Th>
              <th scope="col" className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {legs.map((leg) => (
              <tr
                key={leg.id}
                className="border-t border-border/60 transition-colors hover:bg-navy-secondary/40"
              >
                <td className="px-4 py-4 font-mono text-sm text-gold-light">
                  {leg.leg_number}
                </td>
                <td className="px-4 py-4">
                  <div className="font-ar text-sm text-ink">
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
                  <div className="font-ar mt-1 text-xs text-ink-muted">
                    {leg.max_passengers} {emptyLegsAr.passengersLabel}
                  </div>
                </td>
                <td className="font-ar px-4 py-4 text-sm text-ink-secondary">
                  <div>{formatDateTimeAr(leg.departure_window_start)}</div>
                  <div className="mt-1 text-xs text-ink-muted">
                    {formatDateTimeAr(leg.departure_window_end)}
                  </div>
                </td>
                <td className="px-4 py-4 font-ar text-sm text-ink">
                  {formatSarAmount(leg.current_price)}
                </td>
                <td className="px-4 py-4 font-ar text-sm text-ink-secondary">
                  {formatPercent(leg.current_discount_pct)}
                </td>
                <td className="px-4 py-4">
                  <EmptyLegStatusBadge status={leg.status} />
                </td>
                <td className="px-4 py-4 text-right">
                  <Link
                    href={`/admin/empty-legs/${leg.id}`}
                    className="font-ar inline-flex items-center gap-1 text-sm text-gold-light transition-colors hover:text-gold"
                  >
                    {emptyLegsAr.rowOpen}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:hidden">
        {legs.map((leg) => (
          <Link
            key={leg.id}
            href={`/admin/empty-legs/${leg.id}`}
            className="block rounded-xl border border-border bg-navy-card/40 p-4 transition-colors hover:border-gold/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-sm text-gold-light">
                  {leg.leg_number}
                </div>
                <div className="font-ar mt-1 text-base text-ink">
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
              <EmptyLegStatusBadge status={leg.status} />
            </div>
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="font-ar text-sm text-ink-secondary">
                {formatDateTimeAr(leg.departure_window_start)} ←{' '}
                {formatDateTimeAr(leg.departure_window_end)}
              </div>
              <div className="font-ar mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>
                  {emptyLegsAr.detailCurrentPriceLabel}:{' '}
                  {formatSarAmount(leg.current_price)}
                </span>
                <span>
                  · {emptyLegsAr.detailDiscountPctLabel}:{' '}
                  {formatPercent(leg.current_discount_pct)}
                </span>
                <span>
                  · {leg.max_passengers} {emptyLegsAr.passengersLabel}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted"
    >
      {children}
    </th>
  );
}
