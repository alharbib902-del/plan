import { routeLabel } from '@/components/admin/empty-legs/formatters';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import type { BookingFlightStatus, BookingPaymentStatus } from '@/types/database';

const ar = operatorsAr.portal.bookings;

const FLIGHT_TONE: Record<BookingFlightStatus, string> = {
  confirmed: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  boarding: 'border-sky-400/40 bg-sky-500/10 text-sky-200',
  in_flight: 'border-sky-400/40 bg-sky-500/10 text-sky-200',
  completed: 'border-border bg-navy-secondary/60 text-ink-secondary',
  cancelled: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
};

const PAYMENT_TONE: Record<BookingPaymentStatus, string> = {
  pending: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  pending_offline: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  paid: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  refunded: 'border-border bg-navy-secondary/60 text-ink-muted',
};

const BADGE_BASE =
  'font-ar inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs';

export function FlightStatusBadge({ status }: { status: BookingFlightStatus }) {
  return (
    <span className={`${BADGE_BASE} ${FLIGHT_TONE[status] ?? FLIGHT_TONE.completed}`}>
      {ar.flightStatuses[status] ?? status}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: BookingPaymentStatus }) {
  return (
    <span className={`${BADGE_BASE} ${PAYMENT_TONE[status] ?? PAYMENT_TONE.refunded}`}>
      {ar.paymentStatuses[status] ?? status}
    </span>
  );
}

/** "RUH → JED" from the booking's IATA codes, falling back to freeform text. */
export function bookingRouteLabel(b: {
  route_origin_iata: string | null;
  route_destination_iata: string | null;
  route_origin_freeform_snapshot: string | null;
  route_destination_freeform_snapshot: string | null;
}): string {
  return `${routeLabel(b.route_origin_iata, b.route_origin_freeform_snapshot)} → ${routeLabel(
    b.route_destination_iata,
    b.route_destination_freeform_snapshot
  )}`;
}
