import 'server-only';

import { NextResponse } from 'next/server';

import {
  validateClientSessionByHash,
  type ClientSessionContext,
} from '@/lib/clients/auth';
import { hashSessionToken } from '@/lib/clients/session-token';
import { extractBearerToken } from '@/lib/mobile/bearer';
import { mobileError } from '@/lib/mobile/http';

// Re-export the pure parser so server callers can keep importing
// it from the auth module (the unit suite imports the pure
// `@/lib/mobile/bearer` directly — it can't import this
// `server-only` module under tsx).
export { extractBearerToken };

/**
 * Bearer-token session guard for `/api/v1/mobile/*`.
 *
 * The mobile analogue of `requireClientSession()` (web), but:
 *   - reads the raw token from the `Authorization: Bearer ...`
 *     header instead of the `aeris_client` cookie,
 *   - returns a 401 JSON envelope instead of `redirect('/login')`,
 *   - shares the SAME validation core (`validateClientSessionByHash`)
 *     so cookie + Bearer surfaces judge a session identically.
 *
 * `password_must_change` lockout (FLUTTER-APP-PLAN.md §5 S7 /
 * consultant note #2): EVERY authed endpoint rejects a session
 * whose `password_must_change=true` EXCEPT the three escape
 * hatches that pass `allowPasswordChange: true`
 * (`/me/session`, `/auth/logout`, `/auth/change-password`). The
 * web layout never enforced this, so the mobile contract closes
 * the gap server-side.
 */

export interface RequireClientBearerOptions {
  /** Allow a session with password_must_change=true (default false). */
  allowPasswordChange?: boolean;
}

export type RequireClientBearerResult =
  | { ok: true; session: ClientSessionContext }
  | { ok: false; response: NextResponse };

export async function requireClientBearer(
  req: Request,
  opts: RequireClientBearerOptions = {}
): Promise<RequireClientBearerResult> {
  // Portal flag gates the whole authed surface (fail-closed).
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') {
    return { ok: false, response: mobileError('flag_disabled') };
  }

  const token = extractBearerToken(req);
  if (!token) {
    return { ok: false, response: mobileError('missing_token') };
  }

  // `invalid_token_hash` from the RPC is unreachable on any
  // validate-by-hash path (Bearer here, cookie in
  // validateClientSession): we always pass `hashSessionToken(...)`,
  // which is by construction a valid 64-char lowercase-hex digest,
  // so the RPC's `_is_sha256_hex` guard never fails — a forged
  // token hashes to a valid-but-unmatched digest → `invalid_session`.
  // The guard stays as a DB-boundary defence + serves the
  // hash-as-text reset-token RPCs. `no_cookie` likewise cannot
  // occur here (it is cookie-path-only). All map to 401.
  const result = await validateClientSessionByHash(hashSessionToken(token));
  if (!result.ok) {
    // Normalise the internal `expired` reason to the wire code
    // `session_expired`; pass the rest through (401/403/502 via
    // the http status map).
    const code =
      result.reason === 'expired' ? 'session_expired' : result.reason;
    return { ok: false, response: mobileError(code) };
  }

  if (result.session.password_must_change && !opts.allowPasswordChange) {
    return { ok: false, response: mobileError('password_change_required') };
  }

  return { ok: true, session: result.session };
}
