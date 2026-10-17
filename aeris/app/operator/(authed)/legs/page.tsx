import type { Metadata } from 'next';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import { listOperatorLegs } from '@/lib/operators/portal-queries';
import { routeLabel } from '@/components/admin/empty-legs/formatters';
import { formatSARLabel } from '@/components/clients/offer-format';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { formatRiyadhDateTimeAr } from '@/lib/utils/format';
import type { EmptyLegRow } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.nav.legs,
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<string, string> = {
  available: 'متاحة',
  reserved: 'محجوزة',
  sold: 'مُباعة',
  expired: 'منتهية',
  cancelled: 'ملغاة',
};

function legRoute(leg: EmptyLegRow): string {
  return `${routeLabel(leg.departure_airport, leg.departure_airport_freeform_snapshot)} → ${routeLabel(
    leg.arrival_airport,
    leg.arrival_airport_freeform_snapshot
  )}`;
}

export default async function OperatorEmptyLegsPage() {
  const session = await requireOperatorSession();
  const legs = await listOperatorLegs(session.operator_id);

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.portal.nav.legs}
        </h1>
        <Link
          href="/operator/legs/new"
          className="font-ar inline-flex items-center justify-center rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25"
        >
          {operatorsAr.portal.dashboard.addLeg}
        </Link>
      </header>

      {legs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-10 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {operatorsAr.portal.dashboard.empty}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {legs.map((leg) => (
              <li key={leg.id}>
                <Link
                  href={`/operator/legs/${leg.id}`}
                  className="block rounded-xl border border-border bg-navy-card/40 p-4 transition-colors hover:border-gold/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-ar truncate text-sm text-ink-primary">
                        <span dir="ltr">{legRoute(leg)}</span>
                      </p>
                      <p className="font-ar mt-1 text-xs text-ink-muted">
                        {formatRiyadhDateTimeAr(leg.departure_window_start)}
                      </p>
                    </div>
                    <span className="font-mono shrink-0 text-xs text-gold-light">
                      {leg.leg_number}
                    </span>
                  </div>
                  <div className="font-ar mt-3 flex items-center justify-between gap-3 text-xs">
                    <span className="text-ink-secondary">
                      {STATUS_LABELS[leg.status] ?? leg.status}
                    </span>
                    <span className="text-sm text-gold-light">
                      {formatSARLabel(Number(leg.current_price))}
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
                  <Th>رقم الرحلة</Th>
                  <Th>المسار</Th>
                  <Th>المغادرة</Th>
                  <Th>الحالة</Th>
                  <Th>السعر الحالي</Th>
                  <th className="px-4 py-3">
                    <span className="sr-only">عرض</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {legs.map((leg) => (
                  <tr key={leg.id} className="border-t border-border/50">
                    <td className="font-ar whitespace-nowrap px-4 py-3 font-mono text-xs text-gold-light">
                      {leg.leg_number}
                    </td>
                    <td className="font-ar whitespace-nowrap px-4 py-3 text-sm text-ink-primary">
                      <span dir="ltr">{legRoute(leg)}</span>
                    </td>
                    <td className="font-ar whitespace-nowrap px-4 py-3 text-xs text-ink-muted">
                      {formatRiyadhDateTimeAr(leg.departure_window_start)}
                    </td>
                    <td className="font-ar px-4 py-3 text-xs text-ink-secondary">
                      {STATUS_LABELS[leg.status] ?? leg.status}
                    </td>
                    <td className="font-ar whitespace-nowrap px-4 py-3 text-end text-sm text-gold-light">
                      {formatSARLabel(Number(leg.current_price))}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <Link
                        href={`/operator/legs/${leg.id}`}
                        className="font-ar text-xs text-gold-light hover:underline"
                      >
                        عرض
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
