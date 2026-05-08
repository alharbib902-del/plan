import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

const ERROR_MAP: Record<string, string> = {
  // RPC errors
  leg_not_found: emptyLegsAr.errorRpcLegNotFound,
  leg_not_available: emptyLegsAr.errorRpcLegNotAvailable,
  leg_not_reserved: emptyLegsAr.errorRpcLegNotReserved,
  leg_window_closed: emptyLegsAr.errorRpcLegWindowClosed,
  reservation_expired: emptyLegsAr.errorRpcReservationExpired,
  reservation_token_mismatch: emptyLegsAr.errorRpcReservationTokenMismatch,
  reservation_token_invalid: emptyLegsAr.errorRpcReservationTokenInvalid,
  reservation_expiry_invalid: emptyLegsAr.errorRpcReservationExpiryInvalid,
  reservation_expiry_too_far: emptyLegsAr.errorRpcReservationExpiryTooFar,
  departure_route_missing: emptyLegsAr.errorRpcDepartureRouteMissing,
  arrival_route_missing: emptyLegsAr.errorRpcArrivalRouteMissing,
  departure_airport_unknown: emptyLegsAr.errorRpcDepartureAirportUnknown,
  arrival_airport_unknown: emptyLegsAr.errorRpcArrivalAirportUnknown,
  departure_window_invalid: emptyLegsAr.errorRpcDepartureWindowInvalid,
  original_price_invalid: emptyLegsAr.errorRpcOriginalPriceInvalid,
  max_passengers_invalid: emptyLegsAr.errorRpcMaxPassengersInvalid,
  auction_initial_discount_out_of_range:
    emptyLegsAr.errorRpcAuctionInitialOutOfRange,
  auction_floor_discount_out_of_range:
    emptyLegsAr.errorRpcAuctionFloorOutOfRange,
  auction_floor_below_initial: emptyLegsAr.errorRpcAuctionFloorBelowInitial,
  auction_curve_invalid: emptyLegsAr.errorRpcAuctionCurveInvalid,
  auction_window_lead_hours_invalid:
    emptyLegsAr.errorRpcAuctionWindowLeadHoursInvalid,
  auction_window_already_closed: emptyLegsAr.errorRpcAuctionWindowAlreadyClosed,
  parent_booking_not_found: emptyLegsAr.errorRpcParentBookingNotFound,
  operator_not_found: emptyLegsAr.errorRpcOperatorNotFound,
  operator_stub_not_found: emptyLegsAr.errorRpcOperatorStubNotFound,
  aircraft_not_found: emptyLegsAr.errorRpcAircraftNotFound,
  new_price_invalid: emptyLegsAr.errorRpcNewPriceInvalid,
  new_price_above_original: emptyLegsAr.errorRpcNewPriceAboveOriginal,
  new_price_below_floor: emptyLegsAr.errorRpcNewPriceBelowFloor,
  customer_name_missing: emptyLegsAr.errorRpcCustomerNameMissing,
  customer_phone_missing: emptyLegsAr.errorRpcCustomerPhoneMissing,
  cancellation_reason_required: emptyLegsAr.errorRpcCancellationReasonRequired,
  leg_already_terminal: emptyLegsAr.errorRpcLegAlreadyTerminal,

  // Zod / Server Action wrapper errors
  flag_disabled: emptyLegsAr.errorFlagDisabled,
  validation_failed: emptyLegsAr.errorGeneric,
  rpc_failed: emptyLegsAr.errorGeneric,
  update_failed: emptyLegsAr.errorOutreachNotFound,

  // Field-level Zod codes
  reservation_token_missing: emptyLegsAr.errorRpcReservationTokenInvalid,
  reservation_token_too_long: emptyLegsAr.errorRpcReservationTokenInvalid,
};

export function translateEmptyLegError(code: string | undefined): string {
  if (!code) return emptyLegsAr.errorGeneric;
  return ERROR_MAP[code] ?? emptyLegsAr.errorGeneric;
}
