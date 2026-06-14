import { clientPricingVisible } from '@/lib/empty-legs/pricing-visibility';
import type { EmptyLegRow } from '@/lib/empty-legs/types';
import type { MatchedEmptyLegEntry } from '@/lib/clients/queries/me-empty-legs';
import type { ClientEmptyLegAlertRow } from '@/lib/empty-legs/alerts';

/**
 * THE single empty-leg serializer for BOTH the guest
 * (`/public/empty-legs*`) and the authed (`/empty-legs*`)
 * surfaces (PR3 condition: one serializer, no price leak on
 * either surface).
 *
 * SECURITY — strict positive allowlist. The raw EmptyLegRow is
 * fetched with `select('*')` and carries fields that MUST NEVER
 * reach a client:
 *   - operator identity (disintermediation): operator_id,
 *     operator_stub_id, operator_name_snapshot,
 *     operator_phone_snapshot, operator_email_snapshot
 *   - the reservation HOLD secret: reservation_token_hash
 *   - ANOTHER customer's PII: reservation_customer_name_snapshot,
 *     reservation_customer_phone_snapshot
 *   - the raw reserver id: reservation_client_id (we expose only
 *     derived booleans, never the id)
 *   - internal links/ops: parent_booking_id, customer_booking_id,
 *     aircraft_id, suppress_notifications, notifications_sent,
 *     views_count
 * Never `...row` — add fields explicitly below.
 *
 * PRICE — absolute prices (original_price/current_price) are
 * included ONLY when clientPricingVisible() is true. The
 * DISCOUNT band (percentages) stays visible either way
 * (request-to-book shows the discount, hides the SAR figure).
 * Filtering happens HERE (server), not in the UI.
 */
export function serializeEmptyLegForMobile(
  row: EmptyLegRow,
  opts: { viewerClientId?: string | null } = {}
) {
  const pricingVisible = clientPricingVisible();
  const viewerClientId = opts.viewerClientId ?? null;
  const isReservedByMe =
    viewerClientId != null && row.reservation_client_id === viewerClientId;
  const isReserved =
    row.status === 'reserved' || row.reservation_client_id != null;

  return {
    id: row.id,
    leg_number: row.leg_number,
    status: row.status,
    // Route
    departure_iata: row.departure_airport,
    arrival_iata: row.arrival_airport,
    departure_label:
      row.departure_airport || row.departure_airport_freeform_snapshot,
    arrival_label:
      row.arrival_airport || row.arrival_airport_freeform_snapshot,
    departure_window_start: row.departure_window_start,
    departure_window_end: row.departure_window_end,
    flexibility_hours: row.flexibility_hours,
    // Aircraft (snapshot description only — never aircraft_id)
    aircraft: row.aircraft_snapshot,
    max_passengers: row.max_passengers,
    // Discount band — always visible (request-to-book identity)
    current_discount_pct: row.current_discount_pct,
    auction_initial_discount_pct: row.auction_initial_discount_pct,
    auction_floor_discount_pct: row.auction_floor_discount_pct,
    auction_curve: row.auction_curve,
    // Auction countdown — server time is the single source of truth
    auction_window_start_at: row.auction_window_start_at,
    auction_window_end_at: row.auction_window_end_at,
    last_price_drop_at: row.last_price_drop_at,
    // Reservation state — derived booleans only, never the raw id
    is_reserved: isReserved,
    is_reserved_by_me: isReservedByMe,
    // The hold expiry is the reserver's own countdown — only theirs
    reservation_expires_at: isReservedByMe ? row.reservation_expires_at : null,
    // Pricing — flag-gated server-side
    pricing_visible: pricingVisible,
    ...(pricingVisible
      ? {
          original_price_sar: row.original_price,
          current_price_sar: row.current_price,
        }
      : {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Matched leg (matches tab) = serialized leg + notification meta. */
export function serializeMatchedLegForMobile(
  entry: MatchedEmptyLegEntry,
  opts: { viewerClientId?: string | null } = {}
) {
  return {
    notification: {
      id: entry.notification_id,
      sent_at: entry.notification_sent_at,
      event_type: entry.notification_event_type,
      channel: entry.notification_channel,
    },
    leg: serializeEmptyLegForMobile(entry.leg, opts),
  };
}

/**
 * A client's OWN price alert. `max_price_sar` is the client's own
 * ceiling (not a leg price), so it is returned regardless of the
 * pricing flag.
 */
export function serializeAlertForMobile(row: ClientEmptyLegAlertRow) {
  return {
    id: row.id,
    origin_iata: row.origin_iata,
    destination_iata: row.destination_iata,
    max_price_sar: row.max_price_sar,
    date_from: row.date_from,
    date_to: row.date_to,
    channels: row.channels,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}
