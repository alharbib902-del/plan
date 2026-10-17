import type { Metadata } from 'next';
import Link from 'next/link';

import { BookingFilters } from '@/components/admin/bookings/booking-filters';
import { BookingPagination } from '@/components/admin/bookings/booking-pagination';
import { BookingTable } from '@/components/admin/bookings/booking-table';
import {
  bookingsListHref,
  parseFlightFilter,
  parsePage,
  parsePaymentFilter,
} from '@/lib/admin/bookings/constants';
import { listAdminBookings } from '@/lib/admin/bookings/queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'الحجوزات',
  robots: { index: false, follow: false },
};

interface BookingsPageProps {
  searchParams?: Promise<{ payment?: string; flight?: string; page?: string }>;
}

export default async function AdminBookingsPage({
  searchParams,
}: BookingsPageProps) {
  const sp = (await searchParams) ?? {};
  const payment = parsePaymentFilter(sp.payment);
  const flight = parseFlightFilter(sp.flight);
  const page = parsePage(sp.page);

  const { rows, total } = await listAdminBookings({ payment, flight, page });

  return (
    <section>
      <div className="mb-6">
        <h1 className="font-ar text-2xl text-ink sm:text-3xl">الحجوزات</h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          كل الحجوزات المؤكَّدة. أكِّد استلام الدفع اليدوي (تحويل/واتساب)
          وحدّث حالة الرحلة من صفحة الحجز.
          {total !== null ? ` (${total})` : ''}
        </p>
      </div>

      <div className="mb-6">
        <BookingFilters payment={payment} flight={flight} />
      </div>

      {total === null ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">
            هذه الصفحة خارج نطاق النتائج.
          </p>
          <Link
            href={bookingsListHref({ payment, flight })}
            className="font-ar mt-3 inline-block text-sm text-gold-light hover:text-gold"
          >
            العودة للصفحة الأولى
          </Link>
        </div>
      ) : (
        <>
          <BookingTable rows={rows} />
          <BookingPagination
            payment={payment}
            flight={flight}
            page={page}
            total={total}
          />
        </>
      )}
    </section>
  );
}
