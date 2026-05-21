import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  mintClientSessionToken,
  hashSessionToken,
  CLIENT_SESSION_TTL_SECONDS,
  type MintedClientSession,
} from './session-token';

// Re-export the pure-crypto session-token primitives so
// existing call sites that import from `@/lib/clients/auth`
// keep working without refactor. The functions live in
// session-token.ts so the unit tests can import them
// without pulling Next.js-only modules.
export {
  mintClientSessionToken,
  hashSessionToken,
  type MintedClientSession,
};

/**
 * Phase 9 PR 1 — client portal cookie + session auth.
 *
 * Mirror of `lib/operators/auth.ts` (Phase 8 PR 2c) adapted
 * for the demand side. Differences from the operator surface:
 *
 *   - Cookie name: `aeris_client` (distinct from
 *     `aeris_operator` and `aeris_admin`; co-existence on
 *     `/me`, `/operator`, `/admin` with different lifetimes).
 *   - RPC: `client_session_validate` instead of
 *     `operator_session_validate`.
 *   - Failure redirect: `/login` (NOT `/operator/login`).
 *   - Active-status check: rejects `signup_status` other
 *     than `'active'` (`suspended`, `deleted`).
 *
 * Same security discipline:
 *   - Cookie holds RAW token; DB stores `sha256(rawToken)`.
 *   - DB-backed sessions; mid-session revoke is honoured on
 *     the next request.
 *   - 7d default TTL, 30d with "تذكّرني".
 */

export const CLIENT_COOKIE_NAME = 'aeris_client';

export function getClientCookieOptions(rememberMe: boolean) {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: rememberMe
      ? CLIENT_SESSION_TTL_SECONDS.remember_me
      : CLIENT_SESSION_TTL_SECONDS.default,
    secure: process.env.NODE_ENV === 'production',
  };
}

export async function setClientSessionCookie(
  rawToken: string,
  rememberMe: boolean
): Promise<void> {
  (await cookies()).set(
    CLIENT_COOKIE_NAME,
    rawToken,
    getClientCookieOptions(rememberMe)
  );
}

export async function clearClientSessionCookie(): Promise<void> {
  (await cookies()).set(CLIENT_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function getRawSessionTokenFromCookie(): Promise<string | null> {
  const v = (await cookies()).get(CLIENT_COOKIE_NAME)?.value;
  if (!v || v.length === 0) return null;
  return v;
}

// ============================================================
// Validation — calls the SECURITY DEFINER RPC + maps result
// ============================================================

export interface ClientSessionContext {
  client_id: string;
  full_name: string;
  contact_phone: string;
  expires_at: string;
  password_must_change: boolean;
}

export type ValidateClientSessionResult =
  | { ok: true; session: ClientSessionContext }
  | {
      ok: false;
      reason:
        | 'no_cookie'
        | 'invalid_session'
        | 'expired'
        | 'account_not_active'
        | 'invalid_token_hash'
        | 'rpc_error';
    };

export async function validateClientSession(): Promise<ValidateClientSessionResult> {
  const raw = await getRawSessionTokenFromCookie();
  if (!raw) return { ok: false, reason: 'no_cookie' };

  const tokenHash = hashSessionToken(raw);

  const client = createAdminClient();
  // Cast the WHOLE client to a structural type containing
  // the loose-name `rpc` method, then invoke as a method
  // (Phase 8 PR 2e #51 hotfix discipline — preserves
  // Supabase JS internal `this` binding + bypasses the
  // hand-maintained Functions-map narrowing for the
  // intentionally-unregistered Phase 9 RPCs).
  const looseClient = client as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>
    ) => Promise<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>;
  };
  const { data, error } = await looseClient.rpc('client_session_validate', {
    p_session_token_hash: tokenHash,
  });
  if (error) {
    console.error('[clients.auth] client_session_validate rpc error', error);
    return { ok: false, reason: 'rpc_error' };
  }

  const result = data as unknown as
    | {
        ok: true;
        client_id: string;
        full_name: string;
        contact_phone: string;
        expires_at: string;
        password_must_change: boolean;
      }
    | {
        ok: false;
        error:
          | 'invalid_session'
          | 'expired'
          | 'account_not_active'
          | 'invalid_token_hash';
      };

  if (!result.ok) {
    return { ok: false, reason: result.error };
  }
  return {
    ok: true,
    session: {
      client_id: result.client_id,
      full_name: result.full_name,
      contact_phone: result.contact_phone,
      expires_at: result.expires_at,
      password_must_change: result.password_must_change,
    },
  };
}

/**
 * Required-session helper. Used by every authed `/me/*` page +
 * mutation Server Action. Redirects to `/login` on any
 * failure (clearing the cookie if it was invalid).
 */
export async function requireClientSession(): Promise<ClientSessionContext> {
  const result = await validateClientSession();
  if (!result.ok) {
    if (result.reason !== 'no_cookie') await clearClientSessionCookie();
    redirect('/login');
  }
  return result.session;
}
