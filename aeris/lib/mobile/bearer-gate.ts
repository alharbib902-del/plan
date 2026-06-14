import type {
  ValidateClientSessionResult,
  ClientSessionContext,
} from '@/lib/clients/auth';

/**
 * PURE Bearer-session gate decision (NO 'server-only', NO I/O) so the
 * tsx unit suite can pin every route-gate branch without a session
 * store or Next runtime. `requireClientBearer` (server-only) does the
 * I/O (flag read, token parse, DB validation) then defers the decision
 * to this function — single source of truth for the gate.
 *
 * Type-only imports from the server-only `@/lib/clients/auth` are
 * erased at runtime, so importing them here does not pull the
 * server-only shim.
 */

export type BearerGateDecision =
  | { ok: true; session: ClientSessionContext }
  | { ok: false; code: string };

export interface ResolveBearerSessionInput {
  /** ENABLE_CLIENT_PORTAL === 'true' (fail-closed). */
  portalEnabled: boolean;
  /** A non-empty Bearer token was present on the request. */
  hasToken: boolean;
  /** Result of validateClientSessionByHash — present only when portal+token are ok. */
  validation?: ValidateClientSessionResult;
  /** Allow a session with password_must_change=true (escape hatches). */
  allowPasswordChange?: boolean;
}

export function resolveBearerSession(
  input: ResolveBearerSessionInput
): BearerGateDecision {
  // 1. Portal flag (fail-closed) gates the whole authed surface.
  if (!input.portalEnabled) return { ok: false, code: 'flag_disabled' };

  // 2. No Bearer token.
  if (!input.hasToken) return { ok: false, code: 'missing_token' };

  // Defensive: portal+token ok but no validation supplied → treat as
  // invalid (should not happen on the real path).
  const v = input.validation;
  if (!v) return { ok: false, code: 'invalid_session' };

  // 3. Session invalid — normalise `expired`→`session_expired` and
  // `no_cookie` (cookie-path-only, unreachable here) → `invalid_session`;
  // pass the rest (invalid_session / account_not_active / invalid_token_hash
  // / rpc_error) through to the http status map.
  if (!v.ok) {
    const code =
      v.reason === 'expired'
        ? 'session_expired'
        : v.reason === 'no_cookie'
          ? 'invalid_session'
          : v.reason;
    return { ok: false, code };
  }

  // 4. password_must_change lockout (unless an escape-hatch route opts out).
  if (v.session.password_must_change && !input.allowPasswordChange) {
    return { ok: false, code: 'password_change_required' };
  }

  return { ok: true, session: v.session };
}
