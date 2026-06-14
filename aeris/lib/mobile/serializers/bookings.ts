import type { BookingRow } from '@/types/database';

/**
 * Booking serializer for `/api/v1/mobile/bookings*`.
 *
 * SECURITY — strict positive allowlist (never `...row`). The raw
 * BookingRow (select('*')) carries fields that MUST NOT reach the
 * client:
 *   - internal financials: commission_amount, operator_payout
 *   - the checkout-link SECRET: checkout_token_hash,
 *     checkout_token_expires_at
 *   - operator contact PII / disintermediation: operator_id,
 *     operator_phone_snapshot, operator_email_snapshot
 *   - internal linkage: offer_id, source_offer_table,
 *     source_offer_id, aircraft_id
 *   - ZATCA internals: zatca_qr_code, zatca_uuid
 *
 * The client's OWN snapshot fields (customer_name/phone_snapshot,
 * client_id) are omitted too — the app already knows the user.
 * Money the client legitimately owes (base/addons/vat/total) IS
 * shown; payment is settled offline today (payment_status =
 * pending_offline).
 */
export function serializeBookingForMobile(row: BookingRow) {
  return {
    id: row.id,
    booking_number: row.booking_number,
    source: row.source_discriminator,
    // Route
    route_origin_iata: row.route_origin_iata,
    route_destination_iata: row.route_destination_iata,
    route_origin_label:
      row.route_origin_iata || row.route_origin_freeform_snapshot,
    route_destination_label:
      row.route_destination_iata || row.route_destination_freeform_snapshot,
    passengers: row.passengers_count_snapshot,
    return_scheduled: row.return_scheduled,
    // Aircraft + operator (name only — never operator contact)
    aircraft: row.aircraft_snapshot,
    operator_name: row.operator_name_snapshot,
    // Amounts the client owes (NOT commission_amount / operator_payout)
    base_amount: row.base_amount,
    addons_amount: row.addons_amount,
    vat_amount: row.vat_amount,
    total_amount: row.total_amount,
    // The two separate states
    payment_status: row.payment_status,
    flight_status: row.flight_status,
    // Schedule
    departure_scheduled: row.departure_scheduled,
    departure_actual: row.departure_actual,
    arrival_actual: row.arrival_actual,
    // The client's own e-invoice link (qr/uuid internals stripped)
    zatca_invoice_url: row.zatca_invoice_url,
    // Misc client-visible
    trip_request_id: row.trip_request_id,
    loyalty_points_earned: row.loyalty_points_earned,
    cancellation_reason: row.cancellation_reason,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
