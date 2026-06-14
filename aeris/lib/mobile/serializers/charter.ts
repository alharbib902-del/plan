import type {
  AirportRow,
  TripRequestRow,
  TripRequestStatus,
  UnifiedOfferRow,
} from '@/types/database';

const CANCELLABLE: readonly TripRequestStatus[] = [
  'pending',
  'distributed',
  'offered',
];

const OFFER_ACTIONABLE_TRIP_STATUSES: readonly TripRequestStatus[] = [
  'distributed',
  'offered',
];

export function isTripCancellable(status: TripRequestStatus): boolean {
  return CANCELLABLE.includes(status);
}

export function isTripOfferActionable(status: TripRequestStatus): boolean {
  return OFFER_ACTIONABLE_TRIP_STATUSES.includes(status);
}

export function serializeTripRequestForMobile(row: TripRequestRow) {
  return {
    id: row.id,
    request_number: row.request_number,
    status: row.status,
    trip_type: row.trip_type,
    legs: row.legs,
    departure_iata: row.departure_airport,
    arrival_iata: row.arrival_airport,
    departure_date: row.departure_date,
    return_date: row.return_date,
    passengers: row.passengers_count,
    aircraft_pref: row.aircraft_category_preference,
    special_requests: row.special_requests,
    can_cancel: isTripCancellable(row.status),
    can_accept_offers: isTripOfferActionable(row.status),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function serializeOfferForMobile(
  row: UnifiedOfferRow,
  tripStatus: TripRequestStatus
) {
  const actionable =
    isTripOfferActionable(tripStatus) && row.status === 'pending';

  return {
    source: row.source,
    id: row.id,
    trip_request_id: row.trip_request_id,
    operator_name: row.operator_name,
    total_price_sar: row.total_price_sar,
    aircraft_category: row.aircraft_category,
    aircraft_type: row.aircraft_type,
    aircraft_registration: row.aircraft_registration,
    departure_eta: row.departure_eta,
    validity_hours: row.validity_hours,
    expires_at: row.expires_at,
    notes: row.notes,
    status: row.status,
    is_current_round: row.is_current_round,
    can_accept: actionable,
    can_decline: actionable,
    created_at: row.created_at,
  };
}

export function serializeAirportForMobile(row: AirportRow) {
  return {
    iata_code: row.iata_code,
    icao_code: row.icao_code,
    name: row.name,
    name_ar: row.name_ar,
    city: row.city,
    city_ar: row.city_ar,
    country: row.country,
    country_ar: row.country_ar,
    is_private_capable: row.is_private_capable,
  };
}
