// No 'server-only' import on purpose — these are the PURE decision
// points the empty-legs mobile routes delegate to, so the tsx unit
// suite can pin the price-inference guard + the reserve price gate
// without a live HTTP server or Supabase. The routes (which DO touch
// Supabase) import these; the security contract is enforced here.

/**
 * The filter shape `listPublicAvailableLegs` accepts. Kept local
 * (structurally compatible) so this pure module never imports the
 * server-only query layer.
 */
export interface PublicEmptyLegsQuery {
  departure: string | null;
  minPassengers: number | null;
  maxPrice: number | null;
  limit: number;
}

function parseIntParam(value: string | null, fallback: number): number {
  // Treat absent/blank as the fallback explicitly: Number(null) is 0
  // (finite), which would otherwise swallow the fallback — e.g. an
  // absent `limit` would clamp to 1 instead of the intended 50.
  if (value === null || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * GET /public/empty-legs query parsing.
 *
 * Price-inference guard: when client pricing is hidden the
 * `max_price` filter is DROPPED entirely (returned as null) — else
 * a guest could binary-search the filter to infer the hidden SAR
 * figure. The filter is only honoured when `pricingVisible` is true.
 */
export function parsePublicEmptyLegsQuery(
  params: URLSearchParams,
  pricingVisible: boolean
): PublicEmptyLegsQuery {
  const departure = (params.get('departure') ?? '').slice(0, 64);
  const minPassengersRaw = params.get('min_passengers');
  const maxPriceRaw = params.get('max_price');

  return {
    departure: departure.length > 0 ? departure : null,
    minPassengers: minPassengersRaw ? parseIntParam(minPassengersRaw, 0) : null,
    maxPrice:
      pricingVisible && maxPriceRaw ? parseIntParam(maxPriceRaw, 0) : null,
    limit: Math.max(1, Math.min(parseIntParam(params.get('limit'), 50), 50)),
  };
}

/** The reserve-success fields the response body is shaped from. */
export interface ReserveResultFields {
  leg_id: string;
  reserved_at: string;
  expires_at: string;
  price_at_reservation: number;
}

/**
 * POST /empty-legs/reserve success body.
 *
 * `price_at_reservation_sar` is OMITTED when pricing is hidden — no
 * SAR leak in request-to-book mode (the figure reaches the client
 * over WhatsApp after the seriousness check, never the wire).
 */
export function buildReserveResponseBody(
  result: ReserveResultFields,
  pricingVisible: boolean
): Record<string, unknown> {
  return {
    leg_id: result.leg_id,
    reserved_at: result.reserved_at,
    expires_at: result.expires_at,
    ...(pricingVisible
      ? { price_at_reservation_sar: result.price_at_reservation }
      : {}),
  };
}
