import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { requireOperatorSession } from '@/lib/operators/auth';
import {
  getOperatorBookingById,
  listOperatorBookingAddons,
} from '@/lib/operators/portal-queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { ADDONS_CATALOG } from '@/lib/addons/catalog';
import { formatRiyadhDateTimeAr } from '@/lib/utils/format';
import { formatSARLabel } from '@/components/clients/offer-format';
import {
  FlightStatusBadge,
  PaymentStatusBadge,
  bookingRouteLabel,
} from '@/components/operator/booking-status-badges';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ar = operatorsAr.portal.bookings;

export const metadata: Metadata = {
  title: ar.detailTitle,
  robots: { index: false, follow: false },
};

const ADDON_LABEL = new Map(ADDONS_CATALOG.map((a) => [`${a.type}:${a.subtype}`, a.label_ar]));

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OperatorBookingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await requireOperatorSession();
  const booking = await getOperatorBookingById(session.operator_id, id);
  if (!booking) notFound();
  // Ownership proven above; the add-on read is keyed by booking id only.
  const addons = await listOperatorBookingAddons(booking.id);

  return (
    <section className="space-y-6">
      <nav className="font-ar flex items-center gap-2 text-sm text-ink-muted">
        <Link href="/operator/bookings" className="hover:text-gold-light">
          {ar.title}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        <span className="font-mono text-xs text-ink-secondary">{booking.booking_number}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          <span dir="ltr">{bookingRouteLabel(booking)}</span>
        </h1>
        <p className="font-mono text-xs text-gold-light">{booking.booking_number}</p>
      </header>

      <Card title={ar.sectionTrip}>
        <Field label={ar.labels.route}>
          <span dir="ltr">{bookingRouteLabel(booking)}</span>
        </Field>
        <Field label={ar.labels.departure}>
          {formatRiyadhDateTimeAr(booking.departure_scheduled)}
        </Field>
        {booking.return_scheduled ? (
          <Field label={ar.labels.return}>
            {formatRiyadhDateTimeAr(booking.return_scheduled)}
          </Field>
        ) : null}
        <Field label={ar.labels.passengers}>
          {booking.passengers_count_snapshot ?? '—'}
        </Field>
        <Field label={ar.labels.aircraft}>{booking.aircraft_snapshot ?? '—'}</Field>
      </Card>

      <Card title={ar.sectionStatus}>
        <Field label={ar.labels.flightStatus}>
          <FlightStatusBadge status={booking.flight_status} />
        </Field>
        <Field label={ar.labels.paymentStatus}>
          <PaymentStatusBadge status={booking.payment_status} />
        </Field>
        <Field label={ar.labels.total}>{formatSARLabel(booking.total_amount)}</Field>
        <Field label={ar.labels.createdAt}>{formatRiyadhDateTimeAr(booking.created_at)}</Field>
      </Card>

      <Card title={ar.sectionCustomer}>
        <Field label={ar.col.customer}>{booking.customer_name_snapshot ?? '—'}</Field>
        <Field label={ar.labels.customerPhone}>
          <span dir="ltr">{booking.customer_phone_snapshot ?? '—'}</span>
        </Field>
      </Card>

      <section className="rounded-xl border border-border bg-navy-card/40 p-5">
        <h2 className="font-ar mb-3 text-sm font-medium text-ink-secondary">
          {ar.labels.addons}
        </h2>
        {addons.length === 0 ? (
          <p className="font-ar text-sm text-ink-muted">{ar.noAddons}</p>
        ) : (
          <ul className="space-y-2">
            {addons.map((a) => (
              <li
                key={a.id}
                className="font-ar flex items-center justify-between gap-3 text-sm text-ink-primary"
              >
                <span>
                  {ADDON_LABEL.get(`${a.addon_type}:${a.addon_subtype}`) ?? a.addon_subtype}
                </span>
                {a.quantity > 1 ? (
                  <span className="shrink-0 text-xs text-ink-muted">{ar.quantity(a.quantity)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="rounded-xl border border-border bg-navy-card/30 p-5">
        <p className="font-ar text-sm text-ink-muted">{ar.readOnlyNote}</p>
      </div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-navy-card/40 p-5">
      <h2 className="font-ar mb-3 text-sm font-medium text-ink-secondary">{title}</h2>
      <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-ar text-xs text-ink-muted">{label}</dt>
      <dd className="font-ar text-sm text-ink-primary">{children}</dd>
    </div>
  );
}
