import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { getAdminCargoRequest } from '@/lib/cargo/queries/admin-queue';
import {
  AdminAcceptOnBehalfButton,
  AdminDeclineOnBehalfButton,
  AdminCancelRequestButton,
  AdminManualDispatchButton,
} from '@/components/cargo/admin-actions';
import { cargoAr } from '@/lib/i18n/cargo-ar';
import type { CargoRequestRow, CargoOfferRow } from '@/lib/cargo/types';

/**
 * Phase 11 PR 1 + PR 2 — admin cargo request detail.
 *
 * PR 1 was read-only; PR 2 adds accept/decline-on-behalf buttons
 * for guest cargo requests (request.client_id IS NULL) plus a
 * cancel-request button. The buttons render conditionally:
 *   - Accept/Decline: only when offer.status='pending' AND request
 *     is guest AND request.status IN ('pending', 'offers_received').
 *   - Cancel: only when request is guest AND no accepted offer yet.
 * The Server Actions also re-check via §4.4-§4.6 RPC guards
 * (`admin_cannot_accept_for_authed_client` etc.) so the UI is
 * defense-in-depth, not the only gate.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: { id: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  return {
    title: `${cargoAr.adminDetailTitle} — ${params.id}`,
    robots: { index: false, follow: false },
  };
}

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

function formatSAR(value: number | string | null): string {
  if (value === null || value === undefined) return '—';
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    numeric
  );
}

export default async function AdminCargoRequestDetailPage({ params }: PageProps) {
  if (process.env.ENABLE_CARGO !== 'true') notFound();

  const data = await getAdminCargoRequest(params.id);
  if (!data) notFound();

  const { offers, ...request } = data;

  // Admin actions visible only on guest path (request.client_id IS NULL).
  const isGuestRequest = request.client_id === null;
  const requestOpen =
    request.status === 'pending' || request.status === 'offers_received';
  const showCancel =
    isGuestRequest && requestOpen && !request.accepted_offer_id;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/admin/cargo"
          className="font-ar text-xs text-ink-muted hover:text-gold-light"
        >
          {cargoAr.adminDetailBack}
        </Link>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {cargoAr.adminDetailTitle}
        </h1>
        <p
          dir="ltr"
          className="font-mono text-sm text-gold-light"
        >
          {request.cargo_request_number}
        </p>
      </header>

      {/* Customer */}
      <Section title={cargoAr.adminDetailSectionCustomer}>
        <Pair label={cargoAr.customerNameLabel}>
          {request.customer_name_snapshot}
        </Pair>
        <Pair label={cargoAr.customerPhoneLabel}>
          <span dir="ltr">{request.customer_phone_snapshot}</span>
        </Pair>
        {request.customer_email_snapshot ? (
          <Pair label={cargoAr.customerEmailLabel}>
            <span dir="ltr">{request.customer_email_snapshot}</span>
          </Pair>
        ) : null}
      </Section>

      {/* Request */}
      <Section title={cargoAr.adminDetailSectionRequest}>
        <Pair label={cargoAr.cargoTypeLabel}>
          {cargoAr.cargoTypes[request.cargo_type] ?? request.cargo_type}
        </Pair>
        <Pair label={cargoAr.adminQueueTableRoute}>
          <span dir="ltr">
            {(request.origin_iata ?? request.origin_freeform ?? '—') +
              ' → ' +
              (request.destination_iata ??
                request.destination_freeform ??
                '—')}
          </span>
        </Pair>
        <Pair label={cargoAr.pickupDateLabel}>
          {formatDateAr(request.pickup_date)}
        </Pair>
        {request.delivery_date_target ? (
          <Pair label={cargoAr.deliveryDateTargetLabel}>
            {formatDateAr(request.delivery_date_target)}
          </Pair>
        ) : null}
        <Pair label={cargoAr.flexibilityDaysLabel}>
          {request.flexibility_days}
        </Pair>
        <Pair label={cargoAr.estimatedValueLabel}>
          {formatSAR(request.estimated_value_sar)} ريال
        </Pair>
        <Pair label={cargoAr.insuranceRequiredLabel}>
          {request.insurance_required ? 'نعم' : 'لا'}
        </Pair>
        <Pair label={cargoAr.adminQueueTableStatus}>
          <span className="text-gold-light">
            {cargoAr.statusLabels[request.status] ?? request.status}
          </span>
        </Pair>
        {request.handling_notes ? (
          <Pair label={cargoAr.handlingNotesLabel}>
            {request.handling_notes}
          </Pair>
        ) : null}
      </Section>

      {/* Per-category */}
      <CategorySection request={request} />

      {/* Offers */}
      <Section title={cargoAr.adminDetailSectionOffers}>
        {offers.length === 0 ? (
          <p className="font-ar text-sm text-ink-muted">
            {cargoAr.adminDetailNoOffers}
          </p>
        ) : (
          <div className="space-y-3">
            {offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                showAdminActions={isGuestRequest && requestOpen}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Cancel request — guest path, not yet accepted */}
      {showCancel ? (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/5 p-5">
          <h3 className="font-ar mb-2 text-base text-rose-100">
            {cargoAr.adminCancelRequestCta}
          </h3>
          <p className="font-ar mb-4 text-xs text-ink-muted">
            {cargoAr.meDetailConfirmCancelBody}
          </p>
          <AdminCancelRequestButton requestId={request.id} />
        </div>
      ) : null}

      {/* PR 3 §6.2 — manual dispatch (admin override). Available
          when request is still actionable (pending/offers_received)
          regardless of guest/authed; admin override is legitimate
          either way. */}
      {requestOpen ? (
        <div className="rounded-xl border border-gold/30 bg-gold/5 p-5">
          <h3 className="font-ar mb-2 text-base text-gold-light">
            {cargoAr.adminManualDispatchCta}
          </h3>
          <p className="font-ar mb-4 text-xs text-ink-muted">
            {cargoAr.adminManualDispatchConfirm}
          </p>
          <AdminManualDispatchButton requestId={request.id} />
        </div>
      ) : null}
    </section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-navy-card/40 p-5">
      <h2 className="font-ar mb-4 text-base font-medium text-ink">{title}</h2>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function Pair({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </dt>
      <dd className="font-ar mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

function CategorySection({ request }: { request: CargoRequestRow }) {
  if (request.cargo_type === 'horse') {
    return (
      <Section title={cargoAr.adminDetailSectionCategory}>
        <Pair label={cargoAr.horseCountLabel}>{request.horse_count}</Pair>
        {request.horse_groom_required !== null ? (
          <Pair label={cargoAr.horseGroomRequiredLabel}>
            {request.horse_groom_required ? 'نعم' : 'لا'}
          </Pair>
        ) : null}
        {request.horse_cites_status ? (
          <Pair label={cargoAr.horseCitesStatusLabel}>
            {cargoAr.horseCitesStatusOptions[request.horse_cites_status] ??
              request.horse_cites_status}
          </Pair>
        ) : null}
        {request.horse_stall_requirements ? (
          <Pair label={cargoAr.horseStallRequirementsLabel}>
            {request.horse_stall_requirements}
          </Pair>
        ) : null}
      </Section>
    );
  }
  if (request.cargo_type === 'luxury_car') {
    return (
      <Section title={cargoAr.adminDetailSectionCategory}>
        <Pair label={cargoAr.carMakeLabel}>{request.car_make ?? '—'}</Pair>
        <Pair label={cargoAr.carModelLabel}>{request.car_model ?? '—'}</Pair>
        {request.car_year ? (
          <Pair label={cargoAr.carYearLabel}>{request.car_year}</Pair>
        ) : null}
        {request.car_running_condition !== null ? (
          <Pair label={cargoAr.carRunningConditionLabel}>
            {request.car_running_condition ? 'نعم' : 'لا'}
          </Pair>
        ) : null}
        {request.car_enclosed_required !== null ? (
          <Pair label={cargoAr.carEnclosedRequiredLabel}>
            {request.car_enclosed_required ? 'نعم' : 'لا'}
          </Pair>
        ) : null}
      </Section>
    );
  }
  if (request.cargo_type === 'valuables') {
    return (
      <Section title={cargoAr.adminDetailSectionCategory}>
        <Pair label={cargoAr.valuablesDeclaredValueLabel}>
          {request.valuables_declared_value_sar
            ? `${Number(request.valuables_declared_value_sar).toLocaleString('en-US')} ريال`
            : '—'}
        </Pair>
        {request.valuables_security_level ? (
          <Pair label={cargoAr.valuablesSecurityLevelLabel}>
            {cargoAr.valuablesSecurityLevelOptions[
              request.valuables_security_level
            ] ?? request.valuables_security_level}
          </Pair>
        ) : null}
        {request.valuables_climate_controlled !== null ? (
          <Pair label={cargoAr.valuablesClimateControlledLabel}>
            {request.valuables_climate_controlled ? 'نعم' : 'لا'}
          </Pair>
        ) : null}
        {request.valuables_item_description ? (
          <Pair label={cargoAr.valuablesItemDescriptionLabel}>
            {request.valuables_item_description}
          </Pair>
        ) : null}
      </Section>
    );
  }
  // other
  return (
    <Section title={cargoAr.adminDetailSectionCategory}>
      <Pair label={cargoAr.otherDescriptionLabel}>
        {request.other_description ?? '—'}
      </Pair>
      {request.other_dimensions_lwh_cm ? (
        <Pair label={cargoAr.otherDimensionsLabel}>
          <span dir="ltr">{request.other_dimensions_lwh_cm}</span>
        </Pair>
      ) : null}
      {request.other_weight_kg ? (
        <Pair label={cargoAr.otherWeightLabel}>
          {request.other_weight_kg} كجم
        </Pair>
      ) : null}
      {request.other_special_handling ? (
        <Pair label={cargoAr.otherSpecialHandlingLabel}>
          {request.other_special_handling}
        </Pair>
      ) : null}
    </Section>
  );
}

function OfferCard({
  offer,
  showAdminActions,
}: {
  offer: CargoOfferRow;
  /** Render accept/decline buttons — set when request is guest +
   *  open. The buttons themselves only run RPC if offer.status
   *  is still 'pending' at action time (the §4.4/§4.5 RPCs reject
   *  `offer_not_pending` otherwise). */
  showAdminActions: boolean;
}) {
  const offerActionable = showAdminActions && offer.status === 'pending';
  return (
    <div className="rounded-lg border border-border bg-navy-secondary/30 p-4">
      <div className="font-ar flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-ink-primary">
          {cargoAr.adminDetailOfferOperator}: {offer.operator_name_snapshot}
        </span>
        <span className="text-gold-light">
          {cargoAr.statusLabels[offer.status] ?? offer.status}
        </span>
      </div>
      <dl className="font-ar mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-ink-muted">
            {cargoAr.adminDetailOfferTotalPrice}
          </dt>
          <dd className="mt-1 text-base text-gold-light">
            {Number(offer.total_price_sar).toLocaleString('en-US')} ريال
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">
            {cargoAr.adminDetailOfferProposedDates}
          </dt>
          <dd className="mt-1">
            {offer.proposed_pickup_date} → {offer.proposed_delivery_date}
          </dd>
        </div>
      </dl>
      {offer.operator_notes ? (
        <p className="font-ar mt-3 text-xs text-ink-muted">
          <span className="text-ink">
            {cargoAr.adminDetailOfferNotes}:
          </span>{' '}
          {offer.operator_notes}
        </p>
      ) : null}
      {offerActionable ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <AdminAcceptOnBehalfButton offerId={offer.id} />
          <AdminDeclineOnBehalfButton offerId={offer.id} />
        </div>
      ) : null}
    </div>
  );
}
