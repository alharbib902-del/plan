import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LifeBuoy, MessageCircle } from 'lucide-react';

import { requireClientSession } from '@/lib/clients/auth';
import {
  getBookingForClient,
  getActiveCheckoutForBooking,
} from '@/lib/clients/queries/me-bookings';
import { clientsAr } from '@/lib/i18n/clients-ar';
import { BookingPaymentActions } from '@/components/clients/booking-payment-actions';
import { ClientBanner } from '@/components/clients/error-banner';
import { AERIS_CONTACT } from '@/lib/config/contact';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.bookingDetailHeading,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ accepted?: string; cashback?: string }>;
}

const UNPAID_PAYMENT_STATUSES = new Set(['pending', 'pending_offline']);

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: clientsAr.bookingPaymentPending,
  pending_offline: clientsAr.bookingPaymentPendingOffline,
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
  searchParams,
}: PageProps) {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();

  const { id } = await params;
  const query = (await searchParams) ?? {};
  const justAccepted = query.accepted === '1';
  const cashbackFailed = query.cashback === 'failed';
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

  // Phase payments PR #120 — pay / refresh-status actions, gated by
  // ENABLE_PAYMENTS (fail-closed) and only for a payable booking.
  const paymentsEnabled = process.env.ENABLE_PAYMENTS === 'true';
  const payable = booking.payment_status === 'pending_offline';
  const activeCheckoutId =
    paymentsEnabled && payable
      ? await getActiveCheckoutForBooking(id)
      : null;

  // Manual-settlement mode: with the gateway off, an unpaid booking has
  // no on-page action, so spell out the offline next step instead.
  const showNextSteps =
    !paymentsEnabled &&
    UNPAID_PAYMENT_STATUSES.has(booking.payment_status ?? '') &&
    booking.flight_status !== 'cancelled';
  const nextStepsWhatsAppUrl = `https://wa.me/${AERIS_CONTACT.whatsappNumber}?text=${encodeURIComponent(
    clientsAr.bookingNextStepsWhatsAppMessage(booking.booking_number)
  )}`;

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

      {justAccepted ? (
        <ClientBanner kind="success">{clientsAr.bookingAcceptedBanner}</ClientBanner>
      ) : null}
      {justAccepted && cashbackFailed ? (
        <ClientBanner kind="warning">
          {clientsAr.bookingAcceptedCashbackWarning}
        </ClientBanner>
      ) : null}

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
              {clientsAr.currencySAR}
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

      {paymentsEnabled && payable ? (
        <BookingPaymentActions
          bookingId={id}
          activeCheckoutId={activeCheckoutId}
        />
      ) : null}

      {showNextSteps ? (
        <section
          aria-labelledby="booking-next-steps"
          className="rounded-xl border border-gold/30 bg-gold/5 p-5"
        >
          <h2
            id="booking-next-steps"
            className="font-ar text-lg text-gold-light"
          >
            {clientsAr.bookingNextStepsTitle}
          </h2>
          <p className="font-ar mt-2 text-sm leading-7 text-ink-secondary">
            {clientsAr.bookingNextStepsBody}
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <a
              href={nextStepsWhatsAppUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-ar inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              {clientsAr.bookingNextStepsWhatsApp}
            </a>
            <Link
              href="/me/support"
              className="font-ar inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border bg-navy-card/60 px-4 py-2 text-sm text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light"
            >
              <LifeBuoy className="h-4 w-4" aria-hidden />
              {clientsAr.bookingNextStepsSupport}
            </Link>
          </div>
        </section>
      ) : null}
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
