import { cn } from '@/lib/utils/cn';
import {
  FLIGHT_STATUS_LABEL_AR,
  FLIGHT_STATUS_TONE,
  PAYMENT_STATUS_LABEL_AR,
  PAYMENT_STATUS_TONE,
} from '@/lib/admin/bookings/constants';
import type {
  BookingFlightStatus,
  BookingPaymentStatus,
} from '@/types/database';

const BASE =
  'font-ar inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs';

export function PaymentStatusBadge({
  status,
}: {
  status: BookingPaymentStatus | null;
}) {
  if (!status) return <span className={cn(BASE, 'border-border text-ink-muted')}>—</span>;
  return (
    <span className={cn(BASE, PAYMENT_STATUS_TONE[status])}>
      {PAYMENT_STATUS_LABEL_AR[status] ?? status}
    </span>
  );
}

export function FlightStatusBadge({
  status,
}: {
  status: BookingFlightStatus | null;
}) {
  if (!status) return <span className={cn(BASE, 'border-border text-ink-muted')}>—</span>;
  return (
    <span className={cn(BASE, FLIGHT_STATUS_TONE[status])}>
      {FLIGHT_STATUS_LABEL_AR[status] ?? status}
    </span>
  );
}
