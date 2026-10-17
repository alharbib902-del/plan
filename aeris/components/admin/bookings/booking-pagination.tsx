import Link from 'next/link';

import {
  BOOKINGS_PAGE_SIZE,
  bookingsListHref,
} from '@/lib/admin/bookings/constants';
import type {
  BookingFlightStatus,
  BookingPaymentStatus,
} from '@/types/database';

const LINK =
  'font-ar rounded-md border border-border bg-navy-secondary/60 px-4 py-2 text-sm text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light';

export function BookingPagination({
  payment,
  flight,
  page,
  total,
}: {
  payment: BookingPaymentStatus | 'all';
  flight: BookingFlightStatus | 'all';
  page: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / BOOKINGS_PAGE_SIZE));
  if (pages <= 1) return null;

  return (
    <nav
      aria-label="التنقل بين الصفحات"
      className="mt-6 flex flex-wrap items-center justify-between gap-3"
    >
      {page > 1 ? (
        <Link
          href={bookingsListHref({ payment, flight, page: page - 1 })}
          className={LINK}
        >
          السابق
        </Link>
      ) : (
        <span />
      )}
      <span className="font-ar text-xs text-ink-muted">
        صفحة {page} من {pages}
      </span>
      {page < pages ? (
        <Link
          href={bookingsListHref({ payment, flight, page: page + 1 })}
          className={LINK}
        >
          التالي
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
