import type { Metadata } from 'next';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import { listOperatorLegs } from '@/lib/operators/portal-queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.nav.legs,
  robots: { index: false, follow: false },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

const STATUS_LABELS: Record<string, string> = {
  available: 'متاحة',
  reserved: 'محجوزة',
  sold: 'مُباعة',
  expired: 'منتهية',
  cancelled: 'ملغاة',
};

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
          href="/operator/empty-legs/new"
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
        <div className="overflow-hidden rounded-xl border border-border bg-navy-card/40">
          <table className="w-full text-right">
            <thead className="border-b border-border bg-navy-secondary/40">
              <tr>
                <Th>رقم الرحلة</Th>
                <Th>المسار</Th>
                <Th>المغادرة</Th>
                <Th>الحالة</Th>
                <Th>السعر الحالي</Th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {legs.map((leg) => (
                <tr key={leg.id} className="border-t border-border/50">
                  <td className="font-ar px-4 py-3 font-mono text-xs text-gold-light">
                    {leg.leg_number}
                  </td>
                  <td className="font-ar px-4 py-3 text-sm text-ink-primary">
                    {leg.departure_airport_freeform_snapshot ?? '—'} →{' '}
                    {leg.arrival_airport_freeform_snapshot ?? '—'}
                  </td>
                  <td className="font-ar px-4 py-3 text-xs text-ink-muted">
                    {formatDate(leg.departure_window_start)}
                  </td>
                  <td className="font-ar px-4 py-3 text-xs text-ink-secondary">
                    {STATUS_LABELS[leg.status] ?? leg.status}
                  </td>
                  <td className="px-4 py-3 text-end text-sm text-gold-light">
                    {Number(leg.current_price).toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Link
                      href={`/operator/empty-legs/${leg.id}`}
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
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-ar px-4 py-3 text-start text-xs font-medium uppercase tracking-tagged text-ink-muted">
      {children}
    </th>
  );
}
