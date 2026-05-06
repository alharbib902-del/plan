import type { AirportRow, TripRequestRow } from '@/types/database';
import {
  aircraftCategoryLabel,
  airportLabel,
  formatRiyadhDate,
  formatRiyadhDateTime,
  type Lang,
  t,
} from '@/lib/i18n/operator';

/**
 * Carries token-derived facts the operator needs to see, without
 * the trip summary having to know about HMAC payload shapes.
 * Phase 5.1 P2 wiring fix (iteration 2): explicit prop instead
 * of having OperatorTripSummary peek at the verifier's return.
 */
export type OperatorContext = {
  /** ISO 8601 — from verified payload's expires_at (seconds → date). */
  tokenExpiresAt: string;
  /** For client-side debugging only; not rendered. */
  tokenVersion: 1 | 2;
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[120px,1fr] gap-3 border-t border-border/60 py-3 sm:grid-cols-[160px,1fr]">
      <dt className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </dt>
      <dd className="font-ar text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * Read-only trip summary shown to the operator. Customer name and
 * phone are intentionally NOT included — Phase 4/5 invariant:
 * client identity stays private until acceptance.
 *
 * Phase 5.1 (S1):
 *   - Departure rendered with explicit Asia/Riyadh time + label.
 *   - Link-validity row added (read from operatorContext, not
 *     the trip — the token TTL is what the operator's link will
 *     stop working at, not the trip itself).
 *   - All labels translated via the operator i18n dictionary.
 */
export function OperatorTripSummary({
  trip,
  operatorContext,
  airports,
  lang,
}: {
  trip: TripRequestRow;
  operatorContext: OperatorContext;
  airports: AirportRow[];
  lang: Lang;
}) {
  return (
    <div
      lang={lang}
      dir={lang === 'en' ? 'ltr' : 'rtl'}
      className="rounded-xl border border-border bg-navy-card/40 p-6"
    >
      <div className="font-mono text-sm text-gold-light">
        {trip.request_number}
      </div>
      <h2 className="font-ar mt-1 text-xl text-ink">{t('trip_details', lang)}</h2>

      <dl className="mt-4">
        <Row label={t('route_label', lang)}>
          <ol className="space-y-1">
            {(trip.legs ?? []).map((leg, idx) => (
              <li key={idx} className="font-ar">
                <span className="text-ink-muted">[{idx + 1}]</span>{' '}
                {airportLabel(leg.from, leg.from_freeform, lang, airports)} ←{' '}
                {airportLabel(leg.to, leg.to_freeform, lang, airports)}
                <span className="ms-2 text-xs text-ink-muted">
                  {formatRiyadhDate(leg.date, lang)}
                </span>
              </li>
            ))}
          </ol>
        </Row>
        <Row label={t('departure_label', lang)}>
          {formatRiyadhDateTime(trip.departure_date, lang)}
        </Row>
        {trip.return_date && (
          <Row label={t('return_label', lang)}>
            {formatRiyadhDateTime(trip.return_date, lang)}
          </Row>
        )}
        <Row label={t('passengers_label', lang)}>{trip.passengers_count}</Row>
        {trip.aircraft_category_preference && (
          <Row label={t('aircraft_category_requested_label', lang)}>
            {aircraftCategoryLabel(trip.aircraft_category_preference, lang)}
          </Row>
        )}
        {trip.special_requests && (
          <Row label={t('special_requests_label', lang)}>
            <span className="whitespace-pre-wrap">{trip.special_requests}</span>
          </Row>
        )}
        <Row label={t('link_valid_until_label', lang)}>
          <span className="text-ink-secondary">
            {formatRiyadhDateTime(operatorContext.tokenExpiresAt, lang)}
          </span>
        </Row>
      </dl>
    </div>
  );
}
