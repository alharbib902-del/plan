import Link from 'next/link';

import { operatorsAr } from '@/lib/i18n/operators-ar';
import type { OperatorDashboardStats } from '@/lib/operators/session-store';
import type { OperatorBookingCounts } from '@/lib/operators/portal-queries';

const ar = operatorsAr.portal.dashboard;

export function OperatorDashboardCards({
  stats,
  bookingCounts,
}: {
  stats: OperatorDashboardStats;
  bookingCounts: OperatorBookingCounts;
}) {
  const bookingCards = [
    {
      label: ar.cards.upcomingBookings,
      value: bookingCounts.upcoming,
      color: 'text-emerald-200',
      href: '/operator/bookings?view=upcoming',
    },
    {
      label: ar.cards.unpaidBookings,
      value: bookingCounts.unpaid,
      color: 'text-amber-200',
      href: '/operator/bookings?view=unpaid',
    },
  ];
  const legCards = [
    { label: ar.cards.activeLegs, value: stats.active_legs, color: 'text-emerald-200' },
    { label: ar.cards.reservedLegs, value: stats.reserved_legs, color: 'text-amber-200' },
    { label: ar.cards.soldLegs, value: stats.sold_legs, color: 'text-sky-200' },
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-ar text-sm text-ink-secondary">{ar.bookingsSection}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {bookingCards.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className="group rounded-xl border border-border bg-navy-card/40 p-5 transition-colors hover:border-gold/40"
            >
              <p className="font-ar text-xs text-ink-muted">{c.label}</p>
              <p className={`mt-2 font-display text-3xl ${c.color}`}>{c.value ?? '—'}</p>
              <p className="font-ar mt-2 text-xs text-gold-light group-hover:underline">
                {ar.viewBookings}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-ar text-sm text-ink-secondary">{ar.legsSection}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {legCards.map((c) => (
            <div key={c.label} className="rounded-xl border border-border bg-navy-card/40 p-5">
              <p className="font-ar text-xs text-ink-muted">{c.label}</p>
              <p className={`mt-2 font-display text-3xl ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
