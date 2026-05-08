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
import { whatsappLink } from '@/lib/utils/format';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.publicReservedTitle,
};

interface PageProps {
  params: { leg_number: string };
  searchParams?: { token?: string };
}

export default async function PublicEmptyLegReservedPage({
  params,
  searchParams,
}: PageProps) {
  if (process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE !== 'true') {
    notFound();
  }

  // The reserved page accepts both 'reserved' (current
  // hold) and 'available' (already-cancelled) so the
  // post-cancel render still has the leg context.
  const leg = await getPublicLegByNumber(params.leg_number, {
    allowedStatuses: ['available', 'reserved'],
  });
  if (!leg) {
    return (
      <section className="mx-auto max-w-2xl px-4 pb-16 pt-28 sm:px-6 lg:px-8">
        <p className="font-ar rounded-md border border-border bg-navy-card/30 px-4 py-6 text-center text-sm text-ink-muted">
          {emptyLegsAr.publicLegNotFound}
        </p>
      </section>
    );
  }

  const token = searchParams?.token ?? '';
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
        {emptyLegsAr.publicReservedTitle}
      </h1>
      <p className="font-ar mt-2 text-base text-ink-secondary">
        {emptyLegsAr.publicReservedHint}
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
          {formatSarAmount(leg.current_price)} {emptyLegsAr.publicLegSar}
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
