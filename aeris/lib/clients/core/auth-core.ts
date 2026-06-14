import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { verifyClientPassword } from '@/lib/clients/password';
import {
  mintClientSessionToken,
  hashSessionToken,
} from '@/lib/clients/session-token';
import { clientLoginSchema } from '@/lib/validators/clients';
import {
  checkPublicActionRateLimit,
  recordPublicActionAttempt,
} from '@/lib/rate-limit/public-action';
import type { ClientRequestContext } from '@/lib/clients/core/request-context';

/**
 * Transport-neutral client-auth core.
 *
 * The login/logout business logic lives here ONCE so the web
 * Server Actions (`app/actions/clients-public.ts`, cookie-based)
 * and the mobile route handlers (`app/api/v1/mobile/auth/*`,
 * Bearer-based) share a single implementation. The ONLY thing
 * that differs between the two surfaces is the transport of the
 * minted raw token:
 *   - web  → `setClientSessionCookie(raw_token)` (httpOnly)
 *   - mobile → returns `raw_token` in the JSON body; the app
 *     stores it in secure storage + sends `Authorization:
 *     Bearer <raw_token>`.
 *
 * Because there is exactly one implementation, the two
 * surfaces cannot drift (the "parity" guarantee is structural,
 * not test-enforced). Flag check, rate-limit, credential
 * verification, and session minting are all performed here.
 */

const ENABLE_CLIENT_PORTAL = 'ENABLE_CLIENT_PORTAL';

// Fail-closed flag (matches isPortalDisabled in clients-public.ts
// and the Phase 9 activation checklist): ONLY the literal 'true'
// enables the portal; unset/typo/empty stays disabled.
function isPortalDisabled(): boolean {
  return process.env[ENABLE_CLIENT_PORTAL] !== 'true';
}

function fieldErrorsFromZod(
  issues: { path: (string | number)[]; message: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join('.');
    if (path) out[path] = issue.message;
  }
  return out;
}

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

function looseClient(): LooseRpcClient {
  return createAdminClient() as unknown as LooseRpcClient;
}

export type ClientLoginCoreSuccess = {
  ok: true;
  client_id: string;
  /** Raw session token — transport decides how to deliver it. */
  raw_token: string;
  expires_at: string;
  remember_me: boolean;
  password_must_change: boolean;
};

export type ClientLoginCoreFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
  /** Set on `rate_limited` so the transport can emit Retry-After. */
  retry_after_seconds?: number;
};

export type ClientLoginCoreResult =
  | ClientLoginCoreSuccess
  | ClientLoginCoreFailure;

/**
 * Validate credentials + mint a DB-backed session. Does NOT set
 * a cookie and does NOT touch `cookies()` — the caller delivers
 * `raw_token` over its own transport.
 */
export async function runClientLogin(
  input: { email: string; password: string; remember_me: boolean },
  ctx: ClientRequestContext
): Promise<ClientLoginCoreResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  // SEC-02 — per-IP login rate-limit (credential stuffing / brute force).
  // Shared 'client_login' bucket across web + mobile by design.
  const rl = await checkPublicActionRateLimit('client_login');
  if (!rl.ok) {
    if (rl.reason !== 'storage_error' && rl.reason !== 'secret_missing') {
      await recordPublicActionAttempt(
        'client_login',
        rl.actorFingerprint,
        'rate_limited'
      );
    }
    return {
      ok: false,
      error: 'rate_limited',
      retry_after_seconds: rl.retryAfterSeconds,
    };
  }

  const parsed = clientLoginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data: lookupData, error: lookupErr } = await client.rpc(
    'client_login_lookup',
    { p_email: parsed.data.email }
  );
  if (lookupErr) {
    console.error('[clients.core.runClientLogin] lookup rpc error', lookupErr);
    return { ok: false, error: 'rpc_failed' };
  }

  const lookup = lookupData as unknown as
    | {
        ok: true;
        client_id: string;
        password_hash: string;
        signup_status: 'active' | 'suspended' | 'deleted';
        password_must_change: boolean;
      }
    | { ok: false; error: string };

  if (!lookup.ok) {
    // Opaque — never leak whether the email exists.
    await recordPublicActionAttempt(
      'client_login',
      rl.actorFingerprint,
      'auth_failed'
    );
    return { ok: false, error: 'invalid_credentials' };
  }
  if (lookup.signup_status !== 'active') {
    await recordPublicActionAttempt(
      'client_login',
      rl.actorFingerprint,
      'auth_failed'
    );
    return { ok: false, error: 'account_not_active' };
  }

  const passwordOk = await verifyClientPassword(
    parsed.data.password,
    lookup.password_hash
  );
  if (!passwordOk) {
    await recordPublicActionAttempt(
      'client_login',
      rl.actorFingerprint,
      'auth_failed'
    );
    return { ok: false, error: 'invalid_credentials' };
  }

  const minted = mintClientSessionToken(parsed.data.remember_me);

  const { data: sessionData, error: sessionErr } = await client.rpc(
    'client_login_create_session',
    {
      p_client_id: lookup.client_id,
      p_session_token_hash: minted.token_hash,
      p_remember_me: parsed.data.remember_me,
      p_ip: ctx.ip,
      p_user_agent: ctx.userAgent,
    }
  );
  if (sessionErr) {
    console.error('[clients.core.runClientLogin] session rpc error', sessionErr);
    return { ok: false, error: 'rpc_failed' };
  }
  const session = sessionData as unknown as
    | { ok: true; session_id: string; expires_at: string }
    | { ok: false; error: string };
  if (!session.ok) {
    return { ok: false, error: session.error };
  }

  await recordPublicActionAttempt(
    'client_login',
    rl.actorFingerprint,
    'success'
  );

  return {
    ok: true,
    client_id: lookup.client_id,
    raw_token: minted.raw_token,
    expires_at: session.expires_at,
    remember_me: parsed.data.remember_me,
    password_must_change: lookup.password_must_change,
  };
}

export type ClientLogoutCoreResult = { ok: true };

/**
 * Revoke the session identified by `rawToken` (idempotent —
 * `client_logout` is a no-op on an unknown/already-revoked
 * hash). Always returns ok so the caller can unconditionally
 * clear the cookie (web) or wipe secure storage (mobile),
 * matching the prior `clientLogout` behaviour.
 */
export async function runClientLogout(
  rawToken: string | null
): Promise<ClientLogoutCoreResult> {
  if (!rawToken) return { ok: true };
  const client = looseClient();
  const { error } = await client.rpc('client_logout', {
    p_session_token_hash: hashSessionToken(rawToken),
  });
  if (error) {
    // Always succeed from the caller's POV — the cookie/token
    // is cleared regardless of the RPC outcome.
    console.error('[clients.core.runClientLogout] rpc error', error);
  }
  return { ok: true };
}
