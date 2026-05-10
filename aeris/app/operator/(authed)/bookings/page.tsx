import type { Metadata } from 'next';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import { listOperatorBookings } from '@/lib/operators/portal-queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.bookings.title,
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

export default async function OperatorBookingsPage() {
  const session = await requireOperatorSession();
  const bookings = await listOperatorBookings(session.operator_id);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.portal.bookings.title}
        </h1>
      </header>

      {bookings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-10 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {operatorsAr.portal.bookings.empty}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-navy-card/40">
          <table className="w-full text-right">
            <thead className="border-b border-border bg-navy-secondary/40">
              <tr>
                <Th>رقم الحجز</Th>
                <Th>العميل</Th>
                <Th>التاريخ</Th>
                <Th>الحالة</Th>
                <Th>المبلغ</Th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-t border-border/50">
                  <td className="font-mono px-4 py-3 text-xs text-gold-light">
                    {b.booking_number}
                  </td>
                  <td className="font-ar px-4 py-3 text-sm text-ink-primary">
                    {b.customer_name ?? '—'}
                  </td>
                  <td className="font-ar px-4 py-3 text-xs text-ink-muted">
                    {formatDate(b.created_at)}
                  </td>
                  <td className="font-ar px-4 py-3 text-xs text-ink-secondary">{b.status}</td>
                  <td className="px-4 py-3 text-end text-sm text-gold-light">
                    {Number(b.total_price_sar).toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Link
                      href={`/operator/bookings/${b.id}`}
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
