import { NextResponse } from 'next/server';

/**
 * Shared HTTP helpers for the `/api/v1/mobile/*` surface.
 *
 * Contract (matches FLUTTER-APP-PLAN.md §3):
 *   - Success: `{ ok: true, ... }`
 *   - Failure: `{ ok: false, error: '<code>' }` with an
 *     appropriate HTTP status. The app translates the opaque
 *     `error` code to Arabic from a dictionary ported from
 *     `lib/i18n/clients-ar.ts`; the wire stays code-based so
 *     enumeration-safe codes (e.g. invalid_credentials) keep
 *     their meaning without leaking specifics.
 */

/** Default body cap for mobile POST/PATCH (64 KiB). */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

// Map known error codes → HTTP status. Anything unmapped is a
// 400 (client-correctable) by default; transport/storage faults
// are explicitly 5xx/503 so the app can distinguish "retry" from
// "fix your input".
const ERROR_STATUS: Record<string, number> = {
  // 400 — validation / malformed
  validation_failed: 400,
  malformed_body: 400,
  body_too_large: 413,
  ip_required: 400,
  invalid_input: 400,
  alert_invalid: 400,
  invalid_trip_type: 400,
  invalid_legs: 400,
  invalid_iata: 400,
  departure_airport_unknown: 400,
  arrival_airport_unknown: 400,
  invalid_departure_date: 400,
  invalid_return_date: 400,
  invalid_passengers: 400,
  invalid_aircraft_pref: 400,
  special_requests_too_long: 400,
  unknown_source: 400,
  // 401 — session / credentials
  missing_token: 401,
  invalid_session: 401,
  expired: 401,
  session_expired: 401,
  invalid_token_hash: 401,
  invalid_credentials: 401,
  // 403 — flag / state / lockout
  flag_disabled: 403,
  account_not_active: 403,
  password_change_required: 403,
  client_not_active: 403,
  client_not_found: 403,
  // 404 — owned resource not found
  request_not_found: 404,
  leg_not_found: 404,
  booking_not_found: 404,
  // 409 — conflict (concurrent / state collision). No conflict
  // semantics exist in PR1 (config/login/logout/session), but the
  // §3 contract reserves 409, so the known conflict-wire codes are
  // mapped now: the first conflict-emitting endpoint in a later PR
  // (reserve / accept / pay) honours the status automatically.
  leg_already_reserved: 409,
  offer_not_pending: 409,
  offer_expired: 409,
  trip_not_open: 409,
  accept_failed: 409,
  decline_not_allowed: 409,
  cancel_not_allowed: 409,
  booking_has_active_payment: 409,
  auction_window_closed: 409,
  // 429 — throttle
  rate_limited: 429,
  // 5xx — server / dependency
  rpc_failed: 502,
  rpc_error: 502,
  server_error: 502,
  bcrypt_failed: 500,
  storage_error: 503,
  secret_missing: 503,
};

export function statusForError(code: string): number {
  return ERROR_STATUS[code] ?? 400;
}

export function mobileOk(
  data: Record<string, unknown> = {},
  status = 200
): NextResponse {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export interface MobileErrorOptions {
  /** Override the status the error→status map would pick. */
  status?: number;
  /** Extra response headers (e.g. Retry-After on a 429). */
  headers?: Record<string, string>;
}

export function mobileError(
  code: string,
  extra?: Record<string, unknown>,
  opts?: MobileErrorOptions
): NextResponse {
  return NextResponse.json(
    { ok: false, error: code, ...(extra ?? {}) },
    {
      status: opts?.status ?? statusForError(code),
      ...(opts?.headers ? { headers: opts.headers } : {}),
    }
  );
}

/**
 * Restricted CORS for `/api/v1/mobile/*`.
 *
 * The v1 client is native Flutter (Dio) which sends NO `Origin`
 * header, so these headers are a no-op for it. They become
 * load-bearing only when a browser/WebView consumes the API
 * (e.g. the deferred HyperPay payment WebView). The policy is
 * an explicit env allowlist (`MOBILE_CORS_ALLOWED_ORIGINS`,
 * comma-separated) — NEVER `*`: an unset allowlist or an
 * off-list origin yields NO `Access-Control-Allow-Origin`
 * (fail-closed = cross-origin denied).
 */
export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return {};
  const allow = (process.env.MOBILE_CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (!allow.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  };
}

/** Merge CORS headers onto an existing response (no-op for native callers). */
export function withCors(req: Request, res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(corsHeadersFor(req))) {
    res.headers.set(k, v);
  }
  return res;
}

/** 204 preflight response carrying the restricted CORS headers. */
export function mobilePreflight(req: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(req) });
}

export type ReadJsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'malformed_body' | 'body_too_large' };

/**
 * Read + JSON-parse a request body with a hard size cap. Rejects
 * oversized bodies (defence against memory-abuse on the public
 * `/auth/*` endpoints) BEFORE parsing. Uses Content-Length when
 * present, then re-checks the actual decoded length.
 */
export async function readJsonBody<T>(
  req: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES
): Promise<ReadJsonResult<T>> {
  const declared = req.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) {
    return { ok: false, error: 'body_too_large' };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, error: 'malformed_body' };
  }
  // Byte length (UTF-8), not char length — multibyte Arabic must
  // not slip past the cap.
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return { ok: false, error: 'body_too_large' };
  }
  if (text.length === 0) {
    // Treat an empty body as an empty object so endpoints with
    // all-optional inputs still work.
    return { ok: true, value: {} as T };
  }
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: 'malformed_body' };
  }
}
