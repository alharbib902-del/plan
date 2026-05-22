import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import { getBookingForClient } from '@/lib/clients/queries/me-bookings';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.bookingDetailHeading,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: clientsAr.bookingPaymentPending,
  paid: clientsAr.bookingPaymentPaid,
  refunded: clientsAr.bookingPaymentRefunded,
};

const FLIGHT_STATUS_LABEL: Record<string, string> = {
  confirmed: clientsAr.bookingFlightConfirmed,
  boarding: clientsAr.bookingFlightBoarding,
  in_flight: clientsAr.bookingFlightInFlight,
  completed: clientsAr.bookingFlightCompleted,
  cancelled: clientsAr.bookingFlightCancelled,
};

function formatDateTimeAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatSAR(value: number | string | null): string {
  if (value === null || value === undefined) return '—';
  const numeric =
    typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(numeric)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return String(numeric);
  }
}

export default async function ClientMeBookingDetailPage({
  params,
}: PageProps) {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();

  const { id } = await params;
  const session = await requireClientSession();
  const booking = await getBookingForClient(session.client_id, id);

  if (!booking) {
    return (
      <section className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-6">
        <p className="font-ar text-sm text-rose-100">
          {clientsAr.bookingDetailNotFound}
        </p>
      </section>
    );
  }

  const route = `${booking.route_origin_iata ?? booking.route_origin_freeform_snapshot ?? '—'} → ${
    booking.route_destination_iata ??
    booking.route_destination_freeform_snapshot ??
    '—'
  }`;

  // bookings stores the offer's freeform aircraft text in a
  // single concatenated `aircraft_snapshot` column (Phase 6
  // PR 2a accept_offer §219-225 — `type (registration)`).
  const aircraft = booking.aircraft_snapshot ?? '—';

  const paymentLabel =
    PAYMENT_STATUS_LABEL[booking.payment_status ?? ''] ??
    booking.payment_status ??
    '—';
  const flightLabel =
    FLIGHT_STATUS_LABEL[booking.flight_status ?? ''] ??
    booking.flight_status ??
    '—';

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {clientsAr.bookingDetailHeading}
        </h1>
        <p
          dir="ltr"
          className="font-ar mt-1 text-sm text-ink-muted"
        >
          {booking.booking_number}
        </p>
      </header>

      <div className="rounded-xl border border-border bg-navy-card/40 p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label={clientsAr.bookingDetailRouteLabel}>
            <span dir="ltr">{route}</span>
          </Field>
          <Field label={clientsAr.bookingDetailDepartureLabel}>
            {formatDateTimeAr(booking.departure_scheduled)}
          </Field>
          <Field label={clientsAr.bookingDetailOperatorLabel}>
            {booking.operator_name_snapshot ?? '—'}
          </Field>
          <Field label={clientsAr.bookingDetailAircraftLabel}>
            <span dir="ltr">{aircraft}</span>
          </Field>
          <Field label={clientsAr.bookingDetailTotalLabel}>
            <span className="text-gold-light">
              {formatSAR(booking.total_amount as unknown as number | string | null)}{' '}
              ريال
            </span>
          </Field>
          <Field label={clientsAr.bookingDetailPaymentStatusLabel}>
            {paymentLabel}
          </Field>
          <Field label={clientsAr.bookingDetailFlightStatusLabel}>
            {flightLabel}
          </Field>
        </dl>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-ar text-xs text-ink-muted">{label}</dt>
      <dd className="font-ar mt-1 text-sm text-ink-primary">{children}</dd>
    </div>
  );
}
