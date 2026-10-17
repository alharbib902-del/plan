import type { Metadata } from 'next';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import {
  listOperatorBookings,
  type OperatorBookingView,
} from '@/lib/operators/portal-queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { formatRiyadhDateTimeAr } from '@/lib/utils/format';
import { formatSARLabel } from '@/components/clients/offer-format';
import {
  FlightStatusBadge,
  PaymentStatusBadge,
  bookingRouteLabel,
} from '@/components/operator/booking-status-badges';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.bookings.title,
  robots: { index: false, follow: false },
};

const ar = operatorsAr.portal.bookings;

const VIEWS: OperatorBookingView[] = ['all', 'upcoming', 'unpaid'];

function parseView(value: string | undefined): OperatorBookingView {
  return value === 'upcoming' || value === 'unpaid' ? value : 'all';
}

function viewHref(view: OperatorBookingView): string {
  return view === 'all' ? '/operator/bookings' : `/operator/bookings?view=${view}`;
}

interface PageProps {
  searchParams: Promise<{ view?: string }>;
}

export default async function OperatorBookingsPage({ searchParams }: PageProps) {
  const session = await requireOperatorSession();
  const view = parseView((await searchParams).view);
  const bookings = await listOperatorBookings(session.operator_id, view);

  return (
    <section className="space-y-6">
      <header className="space-y-4">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">{ar.title}</h1>
        <nav aria-label={ar.viewsLabel} className="flex flex-wrap gap-2">
          {VIEWS.map((v) => {
            const active = v === view;
            return (
              <Link
                key={v}
                href={viewHref(v)}
                aria-current={active ? 'page' : undefined}
                className={`font-ar rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-gold/50 bg-gold/15 text-gold-light'
                    : 'border-border text-ink-muted hover:border-gold/40 hover:text-ink-primary'
                }`}
              >
                {ar.views[v]}
              </Link>
            );
          })}
        </nav>
      </header>

      {bookings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-10 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {view === 'all' ? ar.empty : ar.emptyForView}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {bookings.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/operator/bookings/${b.id}`}
                  className="block rounded-xl border border-border bg-navy-card/40 p-4 transition-colors hover:border-gold/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-ar truncate text-sm text-ink-primary">
                        <span dir="ltr">{bookingRouteLabel(b)}</span>
                      </p>
                      <p className="font-ar mt-1 text-xs text-ink-muted">
                        {formatRiyadhDateTimeAr(b.departure_scheduled)}
                      </p>
                    </div>
                    <span className="font-mono shrink-0 text-xs text-gold-light">
                      {b.booking_number}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <FlightStatusBadge status={b.flight_status} />
                    <PaymentStatusBadge status={b.payment_status} />
                  </div>
                  <div className="font-ar mt-3 flex items-center justify-between gap-3 text-xs text-ink-secondary">
                    <span className="truncate">
                      {b.customer_name_snapshot ?? '—'}
                      {b.passengers_count_snapshot !== null
                        ? ` · ${ar.col.passengers}: ${b.passengers_count_snapshot}`
                        : ''}
                    </span>
                    <span className="shrink-0 text-sm text-gold-light">
                      {formatSARLabel(b.total_amount)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-border bg-navy-card/40 md:block">
            <table className="w-full text-start">
              <thead className="border-b border-border bg-navy-secondary/40">
                <tr>
                  <Th>{ar.col.number}</Th>
                  <Th>{ar.col.route}</Th>
                  <Th>{ar.col.departure}</Th>
                  <Th>{ar.col.customer}</Th>
                  <Th>{ar.col.passengers}</Th>
                  <Th>{ar.col.flightStatus}</Th>
                  <Th>{ar.col.paymentStatus}</Th>
                  <Th>{ar.col.amount}</Th>
                  <th className="px-4 py-3">
                    <span className="sr-only">{ar.view}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-t border-border/50">
                    <td className="font-mono whitespace-nowrap px-4 py-3 text-xs text-gold-light">
                      {b.booking_number}
                    </td>
                    <td className="font-ar whitespace-nowrap px-4 py-3 text-sm text-ink-primary">
                      <span dir="ltr">{bookingRouteLabel(b)}</span>
                    </td>
                    <td className="font-ar whitespace-nowrap px-4 py-3 text-xs text-ink-secondary">
                      {formatRiyadhDateTimeAr(b.departure_scheduled)}
                    </td>
                    <td className="font-ar px-4 py-3 text-sm text-ink-primary">
                      {b.customer_name_snapshot ?? '—'}
                    </td>
                    <td className="font-ar px-4 py-3 text-sm text-ink-secondary">
                      {b.passengers_count_snapshot ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <FlightStatusBadge status={b.flight_status} />
                    </td>
                    <td className="px-4 py-3">
                      <PaymentStatusBadge status={b.payment_status} />
                    </td>
                    <td className="font-ar whitespace-nowrap px-4 py-3 text-end text-sm text-gold-light">
                      {formatSARLabel(b.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Link
                        href={`/operator/bookings/${b.id}`}
                        className="font-ar text-xs text-gold-light hover:underline"
                      >
                        {ar.view}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-ar whitespace-nowrap px-4 py-3 text-start text-xs font-medium uppercase tracking-tagged text-ink-muted">
      {children}
    </th>
  );
}
