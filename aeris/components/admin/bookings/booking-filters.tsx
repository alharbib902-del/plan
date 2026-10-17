import Link from 'next/link';

import { cn } from '@/lib/utils/cn';
import {
  FLIGHT_STATUSES,
  FLIGHT_STATUS_LABEL_AR,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABEL_AR,
  bookingsListHref,
} from '@/lib/admin/bookings/constants';
import type {
  BookingFlightStatus,
  BookingPaymentStatus,
} from '@/types/database';

function Chip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'font-ar inline-flex items-center rounded-full border px-4 py-1.5 text-sm transition-colors',
        active
          ? 'border-gold bg-gold/10 text-gold-light'
          : 'border-border bg-navy-secondary/60 text-ink-secondary hover:border-gold/40 hover:text-gold-light'
      )}
    >
      {label}
    </Link>
  );
}

/**
 * Two independent filter rows (payment + flight). Changing one keeps the
 * other and resets pagination to page 1.
 */
export function BookingFilters({
  payment,
  flight,
}: {
  payment: BookingPaymentStatus | 'all';
  flight: BookingFlightStatus | 'all';
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-ar me-1 text-xs text-ink-muted">الدفع:</span>
        <Chip
          href={bookingsListHref({ payment: 'all', flight })}
          active={payment === 'all'}
          label="الكل"
        />
        {PAYMENT_STATUSES.map((s) => (
          <Chip
            key={s}
            href={bookingsListHref({ payment: s, flight })}
            active={payment === s}
            label={PAYMENT_STATUS_LABEL_AR[s]}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-ar me-1 text-xs text-ink-muted">الرحلة:</span>
        <Chip
          href={bookingsListHref({ payment, flight: 'all' })}
          active={flight === 'all'}
          label="الكل"
        />
        {FLIGHT_STATUSES.map((s) => (
          <Chip
            key={s}
            href={bookingsListHref({ payment, flight: s })}
            active={flight === s}
            label={FLIGHT_STATUS_LABEL_AR[s]}
          />
        ))}
      </div>
    </div>
  );
}
