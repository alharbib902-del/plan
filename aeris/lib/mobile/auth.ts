import 'server-only';

import { NextResponse } from 'next/server';

import {
  validateClientSessionByHash,
  type ClientSessionContext,
} from '@/lib/clients/auth';
import { hashSessionToken } from '@/lib/clients/session-token';
import { extractBearerToken } from '@/lib/mobile/bearer';
import { resolveBearerSession } from '@/lib/mobile/bearer-gate';
import { mobileError } from '@/lib/mobile/http';

// Re-export the pure parser + option type so server callers can keep
// importing them from the auth module (the unit suite imports the
// pure `@/lib/mobile/bearer` + `@/lib/mobile/bearer-gate` directly —
// it can't import this `server-only` module under tsx).
export { extractBearerToken };
export type { RequireClientBearerOptions };

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

export type RequireClientBearerResult =
  | { ok: true; session: ClientSessionContext; token_hash: string }
  | { ok: false; response: NextResponse };

export async function requireClientBearer(
  req: Request,
  opts: RequireClientBearerOptions = {}
): Promise<RequireClientBearerResult> {
  const portalEnabled = process.env.ENABLE_CLIENT_PORTAL === 'true';
  const token = extractBearerToken(req);
  // `invalid_token_hash` from the RPC is unreachable on any
  // validate-by-hash path (Bearer here, cookie in
  // validateClientSession): we always pass `hashSessionToken(...)`,
  // which is by construction a valid 64-char lowercase-hex digest,
  // so the RPC's `_is_sha256_hex` guard never fails — a forged
  // token hashes to a valid-but-unmatched digest → `invalid_session`.
  // The guard stays as a DB-boundary defence + serves the
  // hash-as-text reset-token RPCs.
  const tokenHash = token ? hashSessionToken(token) : null;
  const validation =
    portalEnabled && tokenHash
      ? await validateClientSessionByHash(tokenHash)
      : undefined;

  // All gate branches (flag / missing-token / reason-normalisation /
  // password_must_change lockout) live in the pure resolveBearerSession
  // so the unit suite can pin them without a session store.
  const decision = resolveBearerSession({
    portalEnabled,
    hasToken: token !== null,
    validation,
    allowPasswordChange: opts.allowPasswordChange,
  });
  if (!decision.ok) {
    return { ok: false, response: mobileError(decision.code) };
  }

  // decision.ok ⇒ portal + token were present ⇒ tokenHash is non-null.
  return { ok: true, session: decision.session, token_hash: tokenHash! };
}
