import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CancelTripButton } from '@/components/clients/cancel-trip-button';
import { ClientOfferCard, type ClientOfferRow } from '@/components/clients/offer-card';
import { TripStatusChip, type TripStatus } from '@/components/clients/status-chip';
import { requireClientSession } from '@/lib/clients/auth';
import { getTripRequestForClient } from '@/lib/clients/queries/me-requests';
import { listOffersByTripUnified } from '@/lib/supabase/queries/unified-offers';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.requestDetailMetaHeading,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { id: string };
}

const CANCELLABLE_STATUSES: TripStatus[] = [
  'pending',
  'distributed',
  'offered',
];

const ACTIONABLE_OFFER_STATUSES: TripStatus[] = ['distributed', 'offered'];

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

export default async function ClientMeRequestDetailPage({
  params,
}: PageProps) {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();

  const session = await requireClientSession();
  const trip = await getTripRequestForClient(session.client_id, params.id);

  if (!trip) {
    return (
      <section className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-6">
        <p className="font-ar text-sm text-rose-100">
          {clientsAr.requestDetailNotFound}
        </p>
      </section>
    );
  }

  // Fetch offers in parallel — only meaningful when the trip
  // could already have offers (anything past 'pending').
  const offers =
    trip.status === 'pending'
      ? []
      : await listOffersByTripUnified(trip.id);

  const status = trip.status as TripStatus;
  const tripIsActionable = ACTIONABLE_OFFER_STATUSES.includes(status);
  const tripIsCancellable = CANCELLABLE_STATUSES.includes(status);
  const route = `${trip.departure_airport ?? '—'} → ${trip.arrival_airport ?? '—'}`;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {clientsAr.requestDetailMetaHeading}
          </h1>
          <p
            dir="ltr"
            className="font-ar mt-1 text-sm text-ink-muted"
          >
            {trip.request_number}
          </p>
        </div>
        <TripStatusChip status={status} />
      </header>

      <div className="rounded-xl border border-border bg-navy-card/40 p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Field label={clientsAr.requestDetailRouteLabel}>
            <span dir="ltr">{route}</span>
          </Field>
          <Field label={clientsAr.requestDetailDepartureLabel}>
            {formatDateTimeAr(trip.departure_date)}
          </Field>
          <Field label={clientsAr.requestDetailReturnLabel}>
            {formatDateTimeAr(trip.return_date)}
          </Field>
          <Field label={clientsAr.requestDetailPassengersLabel}>
            {trip.passengers_count}
          </Field>
          <Field label={clientsAr.requestDetailAircraftLabel}>
            {trip.aircraft_category_preference ?? '—'}
          </Field>
          {trip.special_requests ? (
            <div className="sm:col-span-2">
              <dt className="font-ar text-xs text-ink-muted">
                {clientsAr.requestDetailSpecialRequestsLabel}
              </dt>
              <dd className="font-ar mt-1 whitespace-pre-wrap text-sm text-ink-primary">
                {trip.special_requests}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <section className="space-y-3">
        <h2 className="font-ar text-lg text-ink-primary">
          {clientsAr.requestDetailOffersHeading}
        </h2>
        {offers.length === 0 ? (
          <p className="font-ar rounded-xl border border-border bg-navy-card/40 p-6 text-sm text-ink-muted">
            {clientsAr.requestDetailOffersEmpty}
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {offers.map((row) => (
              <ClientOfferCard
                key={`${row.source}:${row.id}`}
                offer={
                  {
                    source: row.source,
                    id: row.id,
                    trip_request_id: row.trip_request_id,
                    operator_name: row.operator_name,
                    operator_phone: row.operator_phone,
                    total_price_sar: row.total_price_sar,
                    departure_eta: row.departure_eta,
                    expires_at: row.expires_at,
                    aircraft_type: row.aircraft_type,
                    aircraft_registration: row.aircraft_registration,
                    status: row.status,
                    is_current_round: row.is_current_round,
                  } satisfies ClientOfferRow
                }
                tripIsActionable={tripIsActionable}
              />
            ))}
          </div>
        )}
      </section>

      {tripIsCancellable ? (
        <section>
          <CancelTripButton tripRequestId={trip.id} />
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
