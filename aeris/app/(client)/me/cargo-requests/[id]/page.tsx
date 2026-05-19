import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';

import { requireClientSession } from '@/lib/clients/auth';
import { loadMyCargoRequestDetail } from '@/lib/cargo/queries/client-detail';
import { loadAcceptCashbackContext } from '@/lib/privilege/accept-context';
import {
  AcceptOfferButton,
  DeclineOfferButton,
  CancelRequestButton,
} from '@/components/cargo/client-actions';
import { cargoAr } from '@/lib/i18n/cargo-ar';
import type { CargoRequestRow } from '@/lib/cargo/types';

/**
 * Phase 11 PR 2 — authed cargo request detail page.
 *
 * Shows request bio + per-category fields + offers table with
 * accept/decline buttons. The cancel-request button shows when
 * the request is still cancellable (status pending/offers_received,
 * no accepted offer yet).
 *
 * Auth: requireClientSession() + loadMyCargoRequestDetail() filters
 * `client_id = session.client_id` so cross-tenant URLs return null →
 * 404. The detail page never reveals existence of another client's
 * request.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: cargoAr.meDetailPageTitle,
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

function formatDateTimeAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'short',
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
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    numeric
  );
}

function routeLabel(row: CargoRequestRow): string {
  const dep = row.origin_iata ?? row.origin_freeform ?? '—';
  const arr = row.destination_iata ?? row.destination_freeform ?? '—';
  return `${dep} → ${arr}`;
}

export default async function MyCargoRequestDetailPage({
  params,
}: {
  params: { id: string };
}) {
  if (process.env.ENABLE_CARGO !== 'true') notFound();
  noStore();

  const session = await requireClientSession();
  if (!session) redirect(`/login?redirect=/me/cargo-requests/${params.id}`);

  const [detail, cashbackContext] = await Promise.all([
    loadMyCargoRequestDetail(session.client_id, params.id),
    loadAcceptCashbackContext(session.client_id),
  ]);
  if (!detail) notFound();

  const { request, offers } = detail;
  const cancellable =
    (request.status === 'pending' || request.status === 'offers_received') &&
    !request.accepted_offer_id;

  return (
    <section className="space-y-8">
      <header>
        <Link
          href="/me/cargo-requests"
          className="font-ar text-xs text-ink-muted hover:text-gold-light"
        >
          {cargoAr.meDetailBackToList}
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {cargoAr.meDetailPageTitle}
          </h1>
          <p
            dir="ltr"
            className="font-mono rounded border border-border bg-navy-card px-2 py-0.5 text-sm text-gold-light"
          >
            {request.cargo_request_number}
          </p>
          <span className="font-ar rounded-full border border-border bg-navy-card/60 px-3 py-0.5 text-xs text-ink-muted">
            {cargoAr.statusLabels[request.status] ?? request.status}
          </span>
        </div>
      </header>

      {/* Request bio */}
      <section className="rounded-xl border border-border bg-navy-card/40 p-6">
        <h2 className="font-ar mb-4 text-lg text-ink">
          {cargoAr.meDetailSectionRequest}
        </h2>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Field
            label={cargoAr.meListTableType}
            value={cargoAr.cargoTypes[request.cargo_type] ?? request.cargo_type}
          />
          <Field
            label={cargoAr.meListTableRoute}
            value={routeLabel(request)}
            dir="ltr"
          />
          <Field
            label={cargoAr.meListTablePickup}
            value={formatDateAr(request.pickup_date)}
          />
          <Field
            label={cargoAr.meDetailOfferProposedDates}
            value={
              request.delivery_date_target
                ? formatDateAr(request.delivery_date_target)
                : '—'
            }
          />
          <Field
            label="القيمة المقدَّرة"
            value={`${formatSAR(request.estimated_value_sar)} ريال`}
            dir="ltr"
          />
          <Field
            label="مرونة الأيام"
            value={`±${request.flexibility_days ?? 0}`}
          />
        </dl>
        {request.handling_notes ? (
          <p className="font-ar mt-4 rounded-lg border border-border bg-navy-secondary/40 p-3 text-sm text-ink-secondary">
            {request.handling_notes}
          </p>
        ) : null}
      </section>

      {/* Offers section */}
      <section className="rounded-xl border border-border bg-navy-card/40 p-6">
        <h2 className="font-ar mb-4 text-lg text-ink">
          {cargoAr.meDetailSectionOffers}
        </h2>
        {offers.length === 0 ? (
          <p className="font-ar text-sm text-ink-muted">
            {cargoAr.meDetailNoOffers}
          </p>
        ) : (
          <ul className="space-y-4">
            {offers.map((o) => (
              <li
                key={o.id}
                className="rounded-lg border border-border bg-navy-secondary/30 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <p className="font-ar text-sm text-ink">
                      {o.operator_name_snapshot}
                    </p>
                    <p
                      dir="ltr"
                      className="font-mono mt-1 text-xs text-ink-muted"
                    >
                      {o.aircraft_snapshot ?? '—'}
                    </p>
                  </div>
                  <span className="font-ar rounded-full border border-border bg-navy-card/60 px-3 py-0.5 text-xs text-ink-muted">
                    {cargoAr.statusLabels[o.status] ?? o.status}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <Field
                    label={cargoAr.meDetailOfferTotalPrice}
                    value={`${formatSAR(o.total_price_sar)} ريال`}
                    dir="ltr"
                  />
                  <Field
                    label={cargoAr.meDetailOfferProposedDates}
                    value={`${formatDateAr(o.proposed_pickup_date)} → ${formatDateAr(o.proposed_delivery_date)}`}
                  />
                  <Field
                    label={cargoAr.meDetailOfferBasePrice}
                    value={`${formatSAR(o.base_price_sar)} ريال`}
                    dir="ltr"
                  />
                  <Field
                    label={cargoAr.meDetailOfferExpiresAt}
                    value={formatDateTimeAr(o.expires_at)}
                  />
                </dl>
                {o.operator_notes ? (
                  <p className="font-ar mt-3 rounded border border-border bg-navy-card/40 p-3 text-xs text-ink-secondary">
                    {o.operator_notes}
                  </p>
                ) : null}
                {o.acceptable ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <AcceptOfferButton
                      offerId={o.id}
                      offerTotalSar={o.total_price_sar}
                      privilegeEnabled={cashbackContext.enabled}
                      cashbackBalanceSar={cashbackContext.cashback_balance_sar}
                    />
                    <DeclineOfferButton offerId={o.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Cancel request */}
      {cancellable ? (
        <section className="rounded-xl border border-rose-400/30 bg-rose-500/5 p-6">
          <h3 className="font-ar mb-2 text-base text-rose-100">
            {cargoAr.meDetailRequestCancelCta}
          </h3>
          <p className="font-ar mb-4 text-xs text-ink-muted">
            {cargoAr.meDetailConfirmCancelBody}
          </p>
          <CancelRequestButton requestId={request.id} />
        </section>
      ) : null}
    </section>
  );
}

// Lightweight DL helper.
function Field({
  label,
  value,
  dir,
}: {
  label: string;
  value: string;
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <div>
      <dt className="font-ar text-xs text-ink-muted">{label}</dt>
      <dd
        dir={dir}
        className="mt-0.5 text-sm text-ink"
      >
        {value}
      </dd>
    </div>
  );
}
