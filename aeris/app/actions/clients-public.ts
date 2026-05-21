'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  hashClientPassword,
  verifyClientPassword,
} from '@/lib/clients/password';
import {
  mintClientSessionToken,
  setClientSessionCookie,
  clearClientSessionCookie,
  getRawSessionTokenFromCookie,
  hashSessionToken,
  requireClientSession,
} from '@/lib/clients/auth';
import {
  mintClientPasswordResetToken,
  verifyClientPasswordResetToken,
  ClientPasswordResetTokenEnvError,
} from '@/lib/clients/password-reset-token';
import { sendClientPasswordResetLinkEmail } from '@/lib/notifications/client-email';
import { recordClientEmailAlertStatus } from '@/lib/notifications/client-email-alert-status';
import {
  clientSignupSchema,
  clientLoginSchema,
  clientRequestPasswordResetSchema,
  clientVerifyPasswordResetSchema,
  clientChangePasswordSchema,
  clientUpdateProfileSchema,
} from '@/lib/validators/clients';

/**
 * Phase 9 PR 1 — public + authed client portal Server Actions.
 *
 * 8 actions total (matches Phase 9 spec §5 PR 1 inventory):
 *   PUBLIC (no session required):
 *     - clientSignup
 *     - clientLogin
 *     - clientRequestPasswordReset
 *     - clientVerifyPasswordReset
 *     - clientWelcomeConsume (placeholder for Phase 9.x)
 *
 *   AUTHED (require client session):
 *     - clientLogout
 *     - clientChangePassword
 *     - clientUpdateProfile
 *
 * Each action mirrors Phase 8 PR 2c operator-public discipline:
 *   - Zod-validate input
 *   - Honour ENABLE_CLIENT_PORTAL flag
 *   - Call SECURITY DEFINER RPC via service-role client
 *   - Map structured RPC errors to opaque user-facing errors
 *   - Revalidate affected paths on success
 *   - Email failures route through recordClientEmailAlertStatus
 *     so the canary card surfaces config_missing / send_failed
 */

export type ClientPublicActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

// Codex round 1 PR #55 P2 #2 fix: fail-closed flag.
// Previously this returned true ONLY when the env was the
// literal string 'false', so a deploy that forgot to set
// ENABLE_CLIENT_PORTAL would expose /login, /signup, and
// the Server Actions immediately. The Phase 9 activation
// checklist requires the founder to flip the flag on
// EXPLICITLY after the migration applies and reset-token
// secret is provisioned, so the flag must default to
// disabled when unset.
function isPortalDisabled(): boolean {
  return process.env.ENABLE_CLIENT_PORTAL !== 'true';
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa';
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

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const xf = h.get('x-forwarded-for');
    if (xf) return xf.split(',')[0]!.trim();
    const xr = h.get('x-real-ip');
    if (xr) return xr.trim();
    return null;
  } catch {
    return null;
  }
}

async function userAgent(): Promise<string | null> {
  try {
    return (await headers()).get('user-agent');
  } catch {
    return null;
  }
}

// Phase 9 PR 1 RPCs are intentionally NOT registered in the
// hand-maintained `database.ts` Functions map (Phase 8 PR 2e
// #48 lesson — adding parameterless RPCs collapsed inference
// across the entire codebase). All `.rpc()` calls go through
// this loose-typed accessor that preserves the Supabase JS
// internal `this` binding (Phase 8 PR 2e #51 fix).
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

// ============================================================
// 1. clientSignup
// ============================================================

export type ClientSignupResult =
  | { ok: true; client_id: string }
  | ClientPublicActionFailure;

export async function clientSignup(input: {
  email: string;
  password: string;
  full_name: string;
  phone: string;
  marketing_opt_in: boolean;
}): Promise<ClientSignupResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = clientSignupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // Codex round 3 PR #55 P2 #1 fix — return ip_required when
  // headers are unavailable instead of masking with
  // '0.0.0.0'. The mask grouped real users under one fake IP,
  // so the 24h rate-limit could block unrelated honest signups
  // and the ip_required RPC contract could never fire as
  // designed (probes had no way to validate the missing-IP
  // path). Mirror Phase 8 operatorSignup discipline (PR 2c
  // line 175): IP check sits between Zod parse and bcrypt so
  // we don't burn a 12-cost hash on a request we can't
  // attribute.
  const ip = await clientIp();
  if (!ip) return { ok: false, error: 'ip_required' };

  let passwordHash: string;
  try {
    passwordHash = await hashClientPassword(parsed.data.password);
  } catch (err) {
    console.error('[clients-public.clientSignup] bcrypt failed', err);
    return { ok: false, error: 'bcrypt_failed' };
  }

  const client = looseClient();
  const { data, error } = await client.rpc('client_signup', {
    p_email: parsed.data.email,
    p_password_hash: passwordHash,
    p_full_name: parsed.data.full_name,
    p_phone: parsed.data.phone,
    p_marketing_opt_in: parsed.data.marketing_opt_in,
    p_ip: ip,
  });
  if (error) {
    console.error('[clients-public.clientSignup] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as
    | { ok: true; client_id: string }
    | { ok: false; error: string };
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, client_id: result.client_id };
}

// ============================================================
// 2. clientLogin
// ============================================================

export type ClientLoginResult =
  | { ok: true; client_id: string }
  | ClientPublicActionFailure;

export async function clientLogin(input: {
  email: string;
  password: string;
  remember_me: boolean;
}): Promise<ClientLoginResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

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
    console.error('[clients-public.clientLogin] lookup rpc error', lookupErr);
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
    // Opaque — never leak whether email exists
    return { ok: false, error: 'invalid_credentials' };
  }
  if (lookup.signup_status !== 'active') {
    return { ok: false, error: 'account_not_active' };
  }

  const passwordOk = await verifyClientPassword(
    parsed.data.password,
    lookup.password_hash
  );
  if (!passwordOk) {
    return { ok: false, error: 'invalid_credentials' };
  }

  const minted = mintClientSessionToken(parsed.data.remember_me);

  const { data: sessionData, error: sessionErr } = await client.rpc(
    'client_login_create_session',
    {
      p_client_id: lookup.client_id,
      p_session_token_hash: minted.token_hash,
      p_remember_me: parsed.data.remember_me,
      p_ip: await clientIp(),
      p_user_agent: await userAgent(),
    }
  );
  if (sessionErr) {
    console.error(
      '[clients-public.clientLogin] session rpc error',
      sessionErr
    );
    return { ok: false, error: 'rpc_failed' };
  }
  const session = sessionData as unknown as
    | { ok: true; session_id: string; expires_at: string }
    | { ok: false; error: string };
  if (!session.ok) {
    return { ok: false, error: session.error };
  }

  await setClientSessionCookie(minted.raw_token, parsed.data.remember_me);
  return { ok: true, client_id: lookup.client_id };
}

// ============================================================
// 3. clientLogout
// ============================================================

export type ClientLogoutResult = { ok: true } | ClientPublicActionFailure;

export async function clientLogout(): Promise<ClientLogoutResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const raw = await getRawSessionTokenFromCookie();
  if (!raw) {
    await clearClientSessionCookie();
    return { ok: true };
  }

  const tokenHash = hashSessionToken(raw);
  const client = looseClient();
  const { error } = await client.rpc('client_logout', {
    p_session_token_hash: tokenHash,
  });
  if (error) {
    console.error('[clients-public.clientLogout] rpc error', error);
    // Always clear cookie regardless of RPC outcome
  }

  await clearClientSessionCookie();
  return { ok: true };
}

// ============================================================
// 4. clientRequestPasswordReset
// ============================================================

export type ClientRequestPasswordResetResult =
  | { ok: true }
  | ClientPublicActionFailure;

export async function clientRequestPasswordReset(input: {
  email: string;
}): Promise<ClientRequestPasswordResetResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = clientRequestPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // Mint placeholder token first (real client_id is bound by
  // the RPC's email→client lookup; the payload's client_id
  // field is informational only — the wire token + sha256 hash
  // is what the verify path keys on).
  let minted;
  try {
    minted = mintClientPasswordResetToken({ client_id: 'pending-lookup' });
  } catch (err) {
    if (err instanceof ClientPasswordResetTokenEnvError) {
      console.error(
        '[clients-public.clientRequestPasswordReset] env missing',
        err
      );
      try {
        await recordClientEmailAlertStatus(
          createAdminClient(),
          {
            ok: false,
            reason: 'env_missing',
            detail: 'CLIENT_PASSWORD_RESET_TOKEN_SECRET is not set',
          },
          'clientRequestPasswordReset'
        );
      } catch (alertErr) {
        console.error(
          '[clients-public.clientRequestPasswordReset] alert update failed',
          alertErr
        );
      }
      // Still return opaque success so we do not leak
      // missing-env to anonymous browsers.
      return { ok: true };
    }
    console.error(
      '[clients-public.clientRequestPasswordReset] mint failed',
      err
    );
    return { ok: false, error: 'token_mint_failed' };
  }

  const adminClient = createAdminClient();
  const loose = adminClient as unknown as LooseRpcClient;
  const { data, error } = await loose.rpc(
    'client_mint_password_reset_token',
    {
      p_email: parsed.data.email,
      p_token_hash: minted.token_hash,
      p_expires_at: minted.expires_at.toISOString(),
      p_ip: await clientIp(),
    }
  );
  if (error) {
    console.error(
      '[clients-public.clientRequestPasswordReset] rpc error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }

  // Codex round 1 PR #55 P1 #2 fix: read the contact fields
  // directly from the RPC's return value instead of re-
  // resolving by email. The previous ILIKE-based follow-up
  // query treated `_` and `%` as wildcards (both valid in
  // RFC 5321 email local parts) so a request for
  // `attacker_admin@aeris.sa` could route the reset link
  // to a different account whose email matched the wildcard
  // pattern. The RPC already ran the exact normalised
  // lookup; trust its output.
  const result = data as unknown as
    | {
        ok: true;
        token_id: string;
        client_id: string;
        full_name: string;
        contact_email: string;
      }
    | { ok: true; no_op: true }
    | { ok: false; error: string };

  if (result.ok && 'token_id' in result) {
    const resetUrl = `${siteUrl()}/reset-password/${minted.raw_token}`;
    const sendResult = await sendClientPasswordResetLinkEmail({
      to: result.contact_email,
      full_name: result.full_name,
      reset_url: resetUrl,
      expires_in_minutes: 30,
    });
    await recordClientEmailAlertStatus(
      adminClient,
      sendResult,
      'clientRequestPasswordReset'
    );
  } else if (!result.ok) {
    // Codex round 2 PR #55 P2 #2 fix — record a degraded
    // alert when the RPC returns a structured failure
    // (`invalid_expiry`, `invalid_token_hash`, …). Previously
    // these silent fall-throughs left the admin canary in
    // 'healthy' state while no email shipped, hiding genuine
    // wiring bugs (e.g. a future caller that drifts the
    // expiry contract). Browser still sees the opaque
    // success below to prevent enumeration; admin sees the
    // real cause via the alert singleton.
    console.error(
      '[clients-public.clientRequestPasswordReset] rpc structured failure',
      result.error
    );
    try {
      await recordClientEmailAlertStatus(
        adminClient,
        {
          ok: false,
          reason: 'send_failed',
          detail: `reset_token_rpc_failed: ${result.error}`,
        },
        'clientRequestPasswordReset'
      );
    } catch (alertErr) {
      console.error(
        '[clients-public.clientRequestPasswordReset] alert update failed',
        alertErr
      );
    }
  }
  // The remaining branch — { ok: true, no_op: true } for an
  // unknown email — is intentionally silent: admin must NOT
  // get a degraded-alert ping every time someone types a
  // wrong address into the forgot form. The whole point of
  // no_op is enumeration-resistance.

  // Always opaque ok to prevent enumeration
  return { ok: true };
}

// ============================================================
// 5. clientVerifyPasswordReset
// ============================================================

export type ClientVerifyPasswordResetResult =
  | { ok: true; client_id: string }
  | ClientPublicActionFailure;

export async function clientVerifyPasswordReset(input: {
  token: string;
  new_password: string;
}): Promise<ClientVerifyPasswordResetResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = clientVerifyPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const verify = verifyClientPasswordResetToken(parsed.data.token);
  if (!verify.valid) {
    return { ok: false, error: 'token_invalid' };
  }

  let newHash: string;
  try {
    newHash = await hashClientPassword(parsed.data.new_password);
  } catch (err) {
    console.error(
      '[clients-public.clientVerifyPasswordReset] bcrypt failed',
      err
    );
    return { ok: false, error: 'bcrypt_failed' };
  }

  const client = looseClient();
  const { data, error } = await client.rpc('client_verify_password_reset', {
    p_token_hash: verify.token_hash,
    p_new_password_hash: newHash,
  });
  if (error) {
    console.error(
      '[clients-public.clientVerifyPasswordReset] rpc error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as unknown as
    | { ok: true; client_id: string }
    | { ok: false; error: string };
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, client_id: result.client_id };
}

// ============================================================
// 6. clientChangePassword (authed)
// ============================================================

export type ClientChangePasswordResult =
  | { ok: true }
  | ClientPublicActionFailure;

export async function clientChangePassword(input: {
  current_password: string;
  new_password: string;
}): Promise<ClientChangePasswordResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();

  const parsed = clientChangePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();

  // Lookup current password hash via the existing login_lookup
  // RPC (we don't have the email handy in the session ctx, so
  // SELECT directly against the clients row pinned to the
  // session client_id).
  const { data: clientRow, error: rowErr } = await client
    .from('clients')
    .select('password_hash')
    .eq('id', session.client_id)
    .maybeSingle();
  if (rowErr || !clientRow) {
    console.error(
      '[clients-public.clientChangePassword] lookup error',
      rowErr
    );
    return { ok: false, error: 'lookup_failed' };
  }

  const currentOk = await verifyClientPassword(
    parsed.data.current_password,
    (clientRow as { password_hash: string }).password_hash
  );
  if (!currentOk) {
    return { ok: false, error: 'current_password_invalid' };
  }

  let newHash: string;
  try {
    newHash = await hashClientPassword(parsed.data.new_password);
  } catch (err) {
    console.error(
      '[clients-public.clientChangePassword] bcrypt failed',
      err
    );
    return { ok: false, error: 'bcrypt_failed' };
  }

  const { error: updateErr } = await client
    .from('clients')
    .update({
      password_hash: newHash,
      password_must_change: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.client_id);
  if (updateErr) {
    console.error(
      '[clients-public.clientChangePassword] update error',
      updateErr
    );
    return { ok: false, error: 'update_failed' };
  }

  revalidatePath('/me/profile');
  return { ok: true };
}

// ============================================================
// 7. clientUpdateProfile (authed)
// ============================================================

export type ClientUpdateProfileResult =
  | { ok: true }
  | ClientPublicActionFailure;

export async function clientUpdateProfile(input: {
  full_name: string;
  phone: string;
  marketing_opt_in: boolean;
}): Promise<ClientUpdateProfileResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();

  const parsed = clientUpdateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { error } = await client
    .from('clients')
    .update({
      full_name: parsed.data.full_name,
      contact_phone: parsed.data.phone,
      marketing_opt_in: parsed.data.marketing_opt_in,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.client_id);
  if (error) {
    console.error('[clients-public.clientUpdateProfile] error', error);
    return { ok: false, error: 'update_failed' };
  }

  revalidatePath('/me/profile');
  revalidatePath('/me');
  return { ok: true };
}

// ============================================================
// 8. clientWelcomeConsume — placeholder for Phase 9.x
// admin-mint-magic-link flow. Kept exported so the portal's
// route module can hot-swap once Phase 9.x lands.
// ============================================================

export type ClientWelcomeConsumeResult =
  | { ok: true; client_id: string }
  | ClientPublicActionFailure;

export async function clientWelcomeConsume(_input: {
  token: string;
  new_password: string;
}): Promise<ClientWelcomeConsumeResult> {
  return { ok: false, error: 'not_implemented' };
}
