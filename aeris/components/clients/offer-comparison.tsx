import { clientsAr } from '@/lib/i18n/clients-ar';
import type {
  AircraftCategoryValue,
  OfferSource,
  OfferStatus,
} from '@/types/database';
import {
  OFFER_STATUS_LABEL,
  OFFER_STATUS_TONE,
  aircraftCategoryLabel,
  aircraftLabel,
  formatDateTimeAr,
  formatSAR,
  offerSourceLabel,
} from './offer-format';

/**
 * Phase 14 — read-only side-by-side comparison of the offers on a
 * single trip request. Rendered as the "compare" view of
 * `OffersPanel` (acceptance stays in `ClientOfferCard`).
 *
 * Columns are offers (newest-first, same order as the cards); rows
 * are the comparable attributes. The cheapest offer(s) by total
 * price and the offer(s) with the earliest valid departure ETA are
 * highlighted — ties highlight every matching offer, and missing /
 * invalid ETAs never win "earliest".
 */

export type OfferComparisonRow = {
  source: OfferSource;
  id: string;
  operator_name: string;
  total_price_sar: number;
  aircraft_category: AircraftCategoryValue | null;
  aircraft_type: string | null;
  aircraft_registration: string | null;
  departure_eta: string | null;
  validity_hours: number | null;
  expires_at: string | null;
  notes: string | null;
  status: OfferStatus;
  is_current_round?: boolean | null;
};

function offerKey(offer: OfferComparisonRow): string {
  return `${offer.source}:${offer.id}`;
}

/** Epoch ms for a date string, or null when missing / unparseable. */
function etaMs(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function validityLabel(hours: number | null): string {
  if (hours === null || hours === undefined) return '—';
  return `${hours} ${clientsAr.compareValidityUnit}`;
}

export function OfferComparison({ offers }: { offers: OfferComparisonRow[] }) {
  // Two passes so ties highlight every matching offer rather than
  // an arbitrary first one. Offers with no valid ETA can never be
  // "earliest" (minEta only ever moves on a real timestamp).
  let minPrice = Number.POSITIVE_INFINITY;
  let minEta = Number.POSITIVE_INFINITY;
  for (const offer of offers) {
    if (offer.total_price_sar < minPrice) minPrice = offer.total_price_sar;
    const ms = etaMs(offer.departure_eta);
    if (ms !== null && ms < minEta) minEta = ms;
  }

  const cheapestKeys = new Set<string>();
  const earliestKeys = new Set<string>();
  for (const offer of offers) {
    if (offer.total_price_sar === minPrice) cheapestKeys.add(offerKey(offer));
    const ms = etaMs(offer.departure_eta);
    if (ms !== null && ms === minEta) earliestKeys.add(offerKey(offer));
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-navy-card/40">
      <table className="w-full min-w-[640px] border-collapse text-right">
        <caption className="sr-only">{clientsAr.compareCaption}</caption>
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="font-ar p-4 text-xs font-normal text-ink-muted"
            >
              {clientsAr.compareAttributeHeader}
            </th>
            {offers.map((offer) => {
              const key = offerKey(offer);
              return (
                <th
                  scope="col"
                  key={key}
                  className="p-4 align-bottom"
                >
                  <span className="font-ar block text-sm font-medium text-ink-primary">
                    {offer.operator_name}
                  </span>
                  <span className="font-ar mt-1 block text-[10px] text-ink-muted">
                    {offerSourceLabel(
                      offer.source,
                      offer.is_current_round === true
                    )}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {cheapestKeys.has(key) ? (
                      <Badge tone="cheapest">
                        {clientsAr.compareCheapestBadge}
                      </Badge>
                    ) : null}
                    {earliestKeys.has(key) ? (
                      <Badge tone="earliest">
                        {clientsAr.compareEarliestBadge}
                      </Badge>
                    ) : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <Row label={clientsAr.offerPriceLabel}>
            {offers.map((offer) => {
              const key = offerKey(offer);
              return (
                <Cell key={key} highlight={cheapestKeys.has(key)}>
                  <span className="font-ar text-gold-light">
                    {formatSAR(offer.total_price_sar)} ريال
                  </span>
                </Cell>
              );
            })}
          </Row>

          <Row label={clientsAr.compareAircraftCategoryLabel}>
            {offers.map((offer) => (
              <Cell key={offerKey(offer)}>
                {aircraftCategoryLabel(offer.aircraft_category)}
              </Cell>
            ))}
          </Row>

          <Row label={clientsAr.offerAircraftLabel}>
            {offers.map((offer) => (
              <Cell key={offerKey(offer)}>
                <span dir="ltr">{aircraftLabel(offer)}</span>
              </Cell>
            ))}
          </Row>

          <Row label={clientsAr.offerDepartureEtaLabel}>
            {offers.map((offer) => {
              const key = offerKey(offer);
              return (
                <Cell key={key} highlight={earliestKeys.has(key)}>
                  {formatDateTimeAr(offer.departure_eta)}
                </Cell>
              );
            })}
          </Row>

          <Row label={clientsAr.compareValidityLabel}>
            {offers.map((offer) => (
              <Cell key={offerKey(offer)}>
                {validityLabel(offer.validity_hours)}
              </Cell>
            ))}
          </Row>

          <Row label={clientsAr.offerExpiresLabel}>
            {offers.map((offer) => (
              <Cell key={offerKey(offer)}>
                {formatDateTimeAr(offer.expires_at)}
              </Cell>
            ))}
          </Row>

          <Row label={clientsAr.compareNotesLabel}>
            {offers.map((offer) => (
              <Cell key={offerKey(offer)}>
                {offer.notes?.trim() ? (
                  <span className="whitespace-pre-wrap">{offer.notes}</span>
                ) : (
                  '—'
                )}
              </Cell>
            ))}
          </Row>

          <Row label={clientsAr.requestDetailStatusLabel}>
            {offers.map((offer) => (
              <Cell key={offerKey(offer)}>
                <span
                  className={`font-ar inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${OFFER_STATUS_TONE[offer.status]}`}
                >
                  {OFFER_STATUS_LABEL[offer.status]}
                </span>
              </Cell>
            ))}
          </Row>
        </tbody>
      </table>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <tr className="border-b border-border/60 last:border-b-0">
      <th
        scope="row"
        className="font-ar whitespace-nowrap p-4 text-xs font-normal text-ink-muted"
      >
        {label}
      </th>
      {children}
    </tr>
  );
}

function Cell({
  children,
  highlight = false,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <td
      className={`font-ar p-4 text-sm text-ink-primary ${
        highlight ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/30' : ''
      }`}
    >
      {children}
    </td>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'cheapest' | 'earliest';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'cheapest'
      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
      : 'border-blue-400/40 bg-blue-500/15 text-blue-100';
  return (
    <span
      className={`font-ar inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${cls}`}
    >
      {children}
    </span>
  );
}
