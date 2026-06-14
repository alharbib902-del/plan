// No 'server-only' import on purpose — this is the PURE post-
// validation decision of requireClientBearer, split out so the tsx
// unit suite can pin the password_must_change lockout + the
// expired→session_expired reason normalization without a live
// session store. The `import type` below is erased at compile, so
// pulling these types from the server-only auth module is safe here.

import type {
  ClientSessionContext,
  ValidateClientSessionResult,
} from '@/lib/clients/auth';

export interface RequireClientBearerOptions {
  /** Allow a session with password_must_change=true (default false). */
  allowPasswordChange?: boolean;
}

export type BearerSessionDecision =
  | { ok: true; session: ClientSessionContext }
  | { ok: false; code: string };

/**
 * Maps a validated-session result + options → the final Bearer
 * decision (wire error code or the session).
 *
 *  - The internal `expired` reason is normalised to the wire code
 *    `session_expired`; every other reason passes through (the http
 *    status map turns them into 401/403/502).
 *  - `password_must_change=true` is rejected as `password_change_required`
 *    (403) on EVERY authed endpoint EXCEPT the escape hatches that
 *    pass `allowPasswordChange: true` (/me/session, /auth/logout,
 *    /auth/change-password). The web layout never enforced this, so
 *    the mobile contract closes the gap server-side.
 */
export function resolveBearerSession(
  validation: ValidateClientSessionResult,
  options: RequireClientBearerOptions = {}
): BearerSessionDecision {
  if (!validation.ok) {
    return {
      ok: false,
      code:
        validation.reason === 'expired'
          ? 'session_expired'
          : validation.reason,
    };
  }

  if (validation.session.password_must_change && !options.allowPasswordChange) {
    return { ok: false, code: 'password_change_required' };
  }

  return { ok: true, session: validation.session };
}
