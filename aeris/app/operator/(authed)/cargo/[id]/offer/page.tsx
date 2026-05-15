import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import {
  loadOperatorCargoRequestForOffer,
  listCapableAircraftForOperator,
  formatCargoRoute,
} from '@/lib/cargo/queries/operator-list';
import { CargoOfferForm } from '@/components/cargo/cargo-offer-form';
import { cargoAr } from '@/lib/i18n/cargo-ar';
import type { CargoType } from '@/lib/cargo/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: cargoAr.operatorOfferPageTitle,
  robots: { index: false, follow: false },
};

function formatDateAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function OperatorCargoOfferPage({
  params,
}: {
  params: { id: string };
}) {
  if (process.env.ENABLE_CARGO !== 'true') notFound();
  noStore();

  const session = await requireOperatorSession();

  const request = await loadOperatorCargoRequestForOffer(params.id);
  if (!request) notFound();

  const aircraftOptions = await listCapableAircraftForOperator(
    session.operator_id,
    request.cargo_type as CargoType
  );

  return (
    <section className="space-y-6">
      <header>
        <Link
          href="/operator/cargo"
          className="font-ar text-xs text-ink-muted hover:text-gold-light"
        >
          {cargoAr.operatorOfferBack}
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {cargoAr.operatorOfferPageTitle}
          </h1>
          <p
            dir="ltr"
            className="font-mono rounded border border-border bg-navy-card px-2 py-0.5 text-sm text-gold-light"
          >
            {request.cargo_request_number}
          </p>
        </div>
      </header>

      {/* Request brief */}
      <div className="rounded-xl border border-border bg-navy-card/40 p-5">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-ar text-xs text-ink-muted">
              {cargoAr.cargoTypeLabel}
            </dt>
            <dd className="font-ar mt-0.5 text-ink">
              {cargoAr.cargoTypes[request.cargo_type] ?? request.cargo_type}
            </dd>
          </div>
          <div>
            <dt className="font-ar text-xs text-ink-muted">
              {cargoAr.adminQueueTableRoute}
            </dt>
            <dd dir="ltr" className="mt-0.5 text-ink">
              {formatCargoRoute(request)}
            </dd>
          </div>
          <div>
            <dt className="font-ar text-xs text-ink-muted">
              {cargoAr.operatorListTablePickup}
            </dt>
            <dd className="mt-0.5 text-ink">
              {formatDateAr(request.pickup_date)}
            </dd>
          </div>
        </dl>
        {request.handling_notes ? (
          <p className="font-ar mt-4 rounded-lg border border-border bg-navy-secondary/40 p-3 text-sm text-ink-secondary">
            {request.handling_notes}
          </p>
        ) : null}
      </div>

      <CargoOfferForm
        cargoRequestId={request.id}
        aircraftOptions={aircraftOptions}
        defaultPickupDate={request.pickup_date ?? undefined}
        defaultDeliveryDate={request.delivery_date_target ?? undefined}
      />
    </section>
  );
}
