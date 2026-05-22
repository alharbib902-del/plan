import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OperatorLegActions } from '@/components/operator/empty-legs/operator-leg-actions';
import { EmptyLegStatusBadge } from '@/components/admin/empty-legs/status-badge';
import {
  formatDateTimeAr,
  formatPercent,
  formatSarAmount,
  routeLabel,
} from '@/components/admin/empty-legs/formatters';
import { getEmptyLegByIdAndStub } from '@/lib/admin/empty-legs/queries';
import { validateOperatorEmptyLegSession } from '@/lib/operator/empty-leg-session-store';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.operatorPortalLegEditTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string; id: string }>;
}

export default async function OperatorEmptyLegDetailPage({ params }: PageProps) {
  if (process.env.ENABLE_OPERATOR_PORTAL !== 'true') {
    notFound();
  }

  const { token, id } = await params;
  const session = await validateOperatorEmptyLegSession(token);
  if (!session.ok) {
    return (
      <main dir="rtl" className="min-h-screen bg-navy">
        <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4 py-16 sm:px-6">
          <div className="w-full rounded-2xl border border-red-400/40 bg-red-500/10 p-8 text-center">
            <h1 className="font-ar text-xl text-red-200">
              {emptyLegsAr.operatorPortalSessionInvalid}
            </h1>
          </div>
        </div>
      </main>
    );
  }

  // Stub-scoped read: returns NULL if the leg's
  // operator_stub_id != session.operatorStubId. The opaque
  // "not found" is by design (Codex iteration-12 P1 #1).
  const leg = await getEmptyLegByIdAndStub(
    id,
    session.operatorStubId
  );
  if (!leg) {
    return (
      <main dir="rtl" className="min-h-screen bg-navy">
        <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-4 py-16 sm:px-6">
          <div className="w-full rounded-2xl border border-border bg-navy-card/40 p-8 text-center">
            <p className="font-ar text-sm text-ink-muted">
              {emptyLegsAr.operatorPortalLegNotFound}
            </p>
            <Link
              href={`/operator/empty-legs/${token}`}
              className="font-ar mt-4 inline-flex text-xs text-gold-light hover:text-gold"
            >
              ← {emptyLegsAr.back}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const floor =
    leg.original_price !== null && leg.auction_floor_discount_pct !== null
      ? Math.round(
          leg.original_price * (1 - leg.auction_floor_discount_pct / 100)
        )
      : null;

  return (
    <main dir="rtl" className="min-h-screen bg-navy">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href={`/operator/empty-legs/${token}`}
          className="font-ar text-xs text-ink-muted hover:text-gold-light"
        >
          ← {emptyLegsAr.back}
        </Link>

        <header className="mt-2 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h1 className="font-ar text-2xl text-ink sm:text-3xl">
              {emptyLegsAr.operatorPortalLegEditTitle}
            </h1>
            <div className="mt-1 font-mono text-sm text-gold-light">
              {leg.leg_number}
            </div>
          </div>
          <EmptyLegStatusBadge status={leg.status} />
        </header>

        <section className="mt-6 grid gap-3 sm:grid-cols-2">
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
          <Pair label={emptyLegsAr.detailOriginalPriceLabel}>
            {formatSarAmount(leg.original_price)}
          </Pair>
          <Pair label={emptyLegsAr.detailCurrentPriceLabel}>
            {formatSarAmount(leg.current_price)}
          </Pair>
          <Pair label={emptyLegsAr.detailDiscountPctLabel}>
            {formatPercent(leg.current_discount_pct)}
          </Pair>
          <Pair label={emptyLegsAr.detailMaxPassengersLabel}>
            {leg.max_passengers}
          </Pair>
        </section>

        {leg.status === 'available' ? (
          <section className="mt-6">
            <OperatorLegActions
              mode="token"
              token={token}
              legId={leg.id}
              currentPrice={leg.current_price}
              floorPrice={floor}
              originalPrice={leg.original_price}
            />
          </section>
        ) : null}
      </div>
    </main>
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
