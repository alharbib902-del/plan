import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PublicReserveForm } from '@/components/public/empty-legs/reserve-form';
import {
  formatDateTimeAr,
  formatPercent,
  formatSarAmount,
  routeLabel,
} from '@/components/admin/empty-legs/formatters';
import { getPublicLegByNumber } from '@/lib/empty-legs/public-queries';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.publicReserveTitle,
};

interface PageProps {
  params: Promise<{ leg_number: string }>;
}

export default async function PublicEmptyLegReservePage({
  params,
}: PageProps) {
  if (process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE !== 'true') {
    notFound();
  }

  const { leg_number } = await params;
  const leg = await getPublicLegByNumber(leg_number, {
    allowedStatuses: ['available'],
  });
  if (!leg) {
    return (
      <section className="mx-auto max-w-2xl px-4 pb-16 pt-28 sm:px-6 lg:px-8">
        <p className="font-ar rounded-md border border-border bg-navy-card/30 px-4 py-6 text-center text-sm text-ink-muted">
          {emptyLegsAr.publicLegNotFound}
        </p>
        <div className="mt-4 text-center">
          <Link
            href="/empty-legs"
            className="font-ar text-xs text-gold-light hover:text-gold"
          >
            ← {emptyLegsAr.publicLegPageBack}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <Link
        href={`/empty-legs/${leg.leg_number}`}
        className="font-ar text-xs text-ink-muted hover:text-gold-light"
      >
        ← {emptyLegsAr.publicLegPageBack}
      </Link>
      <h1 className="font-ar mt-2 text-3xl text-ink sm:text-4xl">
        {emptyLegsAr.publicReserveTitle}
      </h1>

      <article className="mt-6 rounded-xl border border-border bg-navy-card/40 p-4">
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
        <div className="font-ar mt-2 text-sm text-ink-secondary">
          {formatDateTimeAr(leg.departure_window_start)} ←{' '}
          {formatDateTimeAr(leg.departure_window_end)}
        </div>
        <div className="font-ar mt-3 flex items-baseline gap-3">
          <span className="text-2xl text-gold-light">
            {formatSarAmount(leg.current_price)}
          </span>
          <span className="text-sm text-ink-muted">
            {emptyLegsAr.publicLegSar}
          </span>
          <span className="text-sm text-ink-muted">
            ({formatPercent(leg.current_discount_pct)}{' '}
            {emptyLegsAr.publicLegDiscount})
          </span>
        </div>
      </article>

      <div className="mt-6">
        <PublicReserveForm legNumber={leg.leg_number} />
      </div>
    </section>
  );
}
