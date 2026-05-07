import type { AirportRow } from '@/types/database';
import type { Lang } from '@/lib/i18n/operator';
import { isIataFormat } from '@/lib/utils/iata';
import { t } from '@/lib/i18n/operator';

/**
 * Phase 6.2 PR 2b: customer checkout-prep route-display helper.
 *
 * Mirrors the operator portal's 3-shape contract from
 * `airportLabel` (Phase 6.0 PR 2) but reads from the
 * bookings row's TWO snapshot columns per side:
 *   - `route_origin_iata`               (Phase 6.0 IATA shape)
 *   - `route_origin_freeform_snapshot`  (Phase 6.0 freeform fallback)
 *
 * Rendering order (per spec S5 + iteration-4 P1 fix):
 *   1. If `iata` is non-NULL → format via the same lookup
 *      `airportLabel` does: city (lang-aware) + " (" + IATA
 *      + ")". The customer page will already have queried
 *      `airports` once for the round trip, so we reuse the
 *      list here.
 *   2. Else if `freeform` is non-NULL → render the freeform
 *      string verbatim (the value the customer typed on
 *      `/request`).
 *   3. Else (impossible by the
 *      `bookings_route_*_present_check` constraint when
 *      `trip_request_id` is set) → render the i18n
 *      placeholder "غير محدد".
 *
 * Pure server-or-client function — no `server-only` import,
 * no DB call. The caller passes the airports list it
 * already has. This keeps the customer page server
 * component fast (one airports fetch, formatting per leg
 * is in-memory).
 */
export function formatRouteEndpoint(
  iata: string | null,
  freeform: string | null,
  airports: AirportRow[],
  lang: Lang
): string {
  // Shape (a): IATA shape wins when present. Mirrors
  // airportLabel's contract but reads from the bookings
  // snapshot column directly (no `from`/`to` ambiguity
  // because origin and destination are separate columns).
  if (iata && isIataFormat(iata)) {
    const found = airports.find((a) => a.iata_code === iata);
    if (found) {
      const city = lang === 'en' ? found.city : found.city_ar ?? found.city;
      return `${city} (${found.iata_code})`;
    }
    // Valid IATA shape but not in the airports table.
    // Render bare with the unknown suffix per the operator
    // portal precedent.
    return `${iata} ${t('airport_unknown_suffix', lang)}`;
  }

  // Shape (b): freeform fallback. PR 2a's accept_offer +
  // backfill INSERT bodies always populate this from
  // `trip_requests.legs[N]->>'from'/'to'` after a
  // NULLIF(TRIM(...), ''). So whenever the customer
  // submitted /request with text-only origin/destination,
  // this column carries that text verbatim.
  if (freeform && freeform.length > 0) {
    return freeform;
  }

  // Shape (c): both NULL. Unreachable for any booking row
  // whose `trip_request_id IS NOT NULL` (the
  // `bookings_route_*_present_check` constraint enforces
  // it). Defensive surface only.
  return t('airport_missing_value', lang);
}
