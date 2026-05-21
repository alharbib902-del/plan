import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 8 PR 2c — operator portal cookie + session auth.
 *
 * Differs from `lib/admin/auth.ts` in two ways:
 *
 *   1. The cookie value is the RAW session token (32 bytes
 *      hex). The DB stores `sha256(rawToken)` only — we
 *      never persist the raw value. On every request we
 *      sha256 the cookie and call
 *      `operator_session_validate(p_token_hash)`.
 *
 *   2. Sessions are DB-backed (operator_sessions row), so a
 *      suspend / password-reset can revoke them mid-request
 *      AND a future admin "force logout all sessions" tool
 *      gets built on top of the same row set.
 *
 * Cookie name: `aeris_operator` (intentionally distinct from
 * `aeris_admin`; co-existence on `/admin` + `/operator` with
 * different lifetimes).
 */

export const OPERATOR_COOKIE_NAME = 'aeris_operator';
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const SESSION_TOKEN_BYTES = 32;

export interface MintedOperatorSession {
  raw_token: string;
  token_hash: string;
  expires_at: Date;
  remember_me: boolean;
}

/**
 * Mint a fresh raw session token + hash. Pass the hash to the
 * RPC (operator_login_create_session / consume_operator_welcome_token);
 * pass the raw token to setOperatorSessionCookie.
 */
export function mintOperatorSessionToken(
  rememberMe: boolean
): MintedOperatorSession {
  const rawToken = randomBytes(SESSION_TOKEN_BYTES).toString('hex'); // 64-char lowercase hex (sha256-shape)
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const ttl = rememberMe ? THIRTY_DAYS_SECONDS : SEVEN_DAYS_SECONDS;
  return {
    raw_token: rawToken,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + ttl * 1000),
    remember_me: rememberMe,
  };
}

/**
 * Re-derive the sha256 hash from a stored raw token. Used by
 * the protected layout + Server Actions on every request.
 */
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function getOperatorCookieOptions(rememberMe: boolean) {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: rememberMe ? THIRTY_DAYS_SECONDS : SEVEN_DAYS_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  };
}

export async function setOperatorSessionCookie(
  rawToken: string,
  rememberMe: boolean
): Promise<void> {
  (await cookies()).set(
    OPERATOR_COOKIE_NAME,
    rawToken,
    getOperatorCookieOptions(rememberMe)
  );
}

export async function clearOperatorSessionCookie(): Promise<void> {
  (await cookies()).set(OPERATOR_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function getRawSessionTokenFromCookie(): Promise<string | null> {
  const v = (await cookies()).get(OPERATOR_COOKIE_NAME)?.value;
  if (!v || v.length === 0) return null;
  return v;
}

// ============================================================
// Validation — calls the SECURITY DEFINER RPC + maps result
// ============================================================

export interface OperatorSessionContext {
  operator_id: string;
  expires_at: string;
  password_must_change: boolean;
}

export type ValidateOperatorSessionResult =
  | { ok: true; session: OperatorSessionContext }
  | { ok: false; reason: 'no_cookie' | 'invalid_session' | 'account_not_approved' | 'rpc_error' };

/**
 * Read-only validation. Returns the session context or a
 * structured failure reason. Does NOT redirect — for the
 * cases where the caller wants to render a public page if
 * not authed (e.g. /operator/welcome/[token]).
 */
export async function validateOperatorSession(): Promise<ValidateOperatorSessionResult> {
  const raw = await getRawSessionTokenFromCookie();
  if (!raw) return { ok: false, reason: 'no_cookie' };

  const tokenHash = hashSessionToken(raw);

  const client = createAdminClient();
  const { data, error } = await client.rpc('operator_session_validate', {
    p_token_hash: tokenHash,
  });
  if (error) {
    console.error('[operators.auth] operator_session_validate rpc error', error);
    return { ok: false, reason: 'rpc_error' };
  }
  const result = data as
    | {
        ok: true;
        operator_id: string;
        expires_at: string;
        password_must_change: boolean;
      }
    | { ok: false; error: 'invalid_session' | 'account_not_approved' };

  if (!result.ok) {
    return { ok: false, reason: result.error };
  }
  return {
    ok: true,
    session: {
      operator_id: result.operator_id,
      expires_at: result.expires_at,
      password_must_change: result.password_must_change,
    },
  };
}

/**
 * Required-session helper. Used by every authed page +
 * mutation Server Action. Redirects to /operator/login on
 * any failure (clearing the cookie if it was invalid).
 */
export async function requireOperatorSession(): Promise<OperatorSessionContext> {
  const result = await validateOperatorSession();
  if (!result.ok) {
    if (result.reason !== 'no_cookie') clearOperatorSessionCookie();
    redirect('/operator/login');
  }
  return result.session;
}
