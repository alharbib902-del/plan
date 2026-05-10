'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createHash } from 'crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  hashOperatorPassword,
  verifyOperatorPassword,
} from '@/lib/operators/password';
import {
  mintOperatorSessionToken,
  setOperatorSessionCookie,
  clearOperatorSessionCookie,
  getRawSessionTokenFromCookie,
  hashSessionToken,
  requireOperatorSession,
} from '@/lib/operators/auth';
import {
  mintPasswordResetToken,
  verifyPasswordResetToken,
  PasswordResetTokenEnvError,
} from '@/lib/operators/password-reset-token';
import {
  sendOperatorPasswordResetLinkEmail,
  type EmailDeliveryResult,
} from '@/lib/notifications/operator-email';
import {
  operatorSignupSchema,
  operatorLoginSchema,
  operatorRequestPasswordResetSchema,
  operatorVerifyPasswordResetSchema,
  operatorVerifyOtpSchema,
  operatorChangePasswordSchema,
  operatorUpdateProfileSchema,
  operatorWelcomeConsumeSchema,
} from '@/lib/validators/operators';

/**
 * Phase 8 PR 2c — public + authed operator portal Server
 * Actions. The 8 functions below are the only ones the
 * portal forms are allowed to call from the browser:
 *
 *   PUBLIC (no session required):
 *     - operatorSignup
 *     - operatorLogin
 *     - operatorRequestPasswordReset
 *     - operatorVerifyPasswordReset
 *     - operatorVerifyOtp
 *     - operatorConsumeWelcomeToken
 *
 *   AUTHED (require operator session):
 *     - operatorLogout
 *     - operatorChangePassword
 *     - operatorUpdateProfile
 *
 * Every action follows the same shape: Zod parse -> RPC (or
 * cookie/DB mutation) -> structured `{ ok, ... }` result. The
 * portal-shell components map error codes to Arabic strings
 * via the i18n `operatorsAr.portal.errors` map.
 *
 * Public actions are flag-gated by ENABLE_OPERATOR_PORTAL —
 * when false the actions short-circuit with
 * { ok: false, error: 'flag_disabled' } so a deploy without
 * the portal flipped on simply renders empty / 404 pages.
 */

// ============================================================
// Shared
// ============================================================

export type OperatorPublicActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

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

function isPortalDisabled(): boolean {
  return process.env.ENABLE_OPERATOR_PORTAL === 'false';
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa';
}

function clientIp(): string | null {
  // Vercel forwards real IP via x-forwarded-for / x-real-ip.
  // Take the first IP in the comma-separated list (closest
  // client) and fall back to x-real-ip if the header is
  // missing.
  const h = headers();
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return h.get('x-real-ip');
}

function clientUserAgent(): string | null {
  return headers().get('user-agent');
}

/**
 * Codex round 2 PR #42 P1 #1 + P1 #2 fix: PostgREST's
 * `ilike` operator forwards `_` and `%` to SQL ILIKE
 * unchanged — both are SQL wildcards that match arbitrary
 * characters. Email local parts can contain `_`, so a raw
 * `.ilike('auth_email', 'j_smith@aeris.test')` would match
 * `jXsmith@aeris.test` (and any other character in that
 * position), letting password-reset / OTP-login look up the
 * wrong operator AND email a reset link to that wrong
 * operator's contact.
 *
 * Escape `_`, `%`, and `\` (the escape character itself)
 * with backslash so the pattern matches the literal
 * supplied string. PostgreSQL ILIKE uses `\` as the default
 * escape character; the Supabase JS client passes the
 * pattern through to PostgREST -> SQL unchanged.
 *
 * Combined with case-insensitive matching from ILIKE, this
 * matches the RPC-side `LOWER(auth_email) =
 * _normalize_operator_email(p_email)` invariant.
 */
function escapeIlikePattern(s: string): string {
  return s.replace(/[\\_%]/g, '\\$&');
}

/**
 * Codex round 3 PR #42 P2 fix: consume the operator-email
 * delivery result and reflect it in the singleton
 * operator_notification_alert_status row (PR 1 §3.10), so
 * admin sees a degraded-state banner on /admin/operators
 * when env is missing or Resend is failing.
 *
 * Public actions still return the same opaque
 * { ok: true } to the browser (no enumeration / no
 * delivery-state leak), but the failure is now visible to
 * admin AND to structured logs. PR 2b admin actions can
 * adopt the same helper in a follow-up.
 *
 * Singleton row id=1 is seeded by PR 1; we always UPDATE,
 * never INSERT.
 */
async function recordEmailAlertStatus(
  client: ReturnType<typeof createAdminClient>,
  result: EmailDeliveryResult,
  contextLabel: string
): Promise<void> {
  try {
    if (result.ok) {
      // Restore healthy on a successful send. This is what
      // clears a previous failure once the env var lands or
      // Resend recovers.
      await client
        .from('operator_notification_alert_status')
        .update({ status: 'healthy', updated_at: new Date().toISOString() })
        .eq('id', 1);
    } else {
      const status = result.reason === 'env_missing' ? 'config_missing' : 'send_failed';
      const reasonLabel = `${contextLabel}: ${result.reason}`;
      await client
        .from('operator_notification_alert_status')
        .update({
          status,
          last_failure_at: new Date().toISOString(),
          last_failure_reason: reasonLabel,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
      console.error(
        `[operator-notification-alert] ${contextLabel} failed: ${result.reason}`
      );
    }
  } catch (err) {
    // Alert-status update failure is non-fatal — log + swallow
    // so the parent action returns its own result unchanged.
    console.error('[operator-notification-alert] update failed', err);
  }
}

// ============================================================
// 1. operatorSignup
// ============================================================

export type OperatorSignupResult =
  | { ok: true; operator_id: string; signup_status: 'pending' }
  | OperatorPublicActionFailure;

export async function operatorSignup(input: {
  email: string;
  password: string;
  company_name: string;
  contact_email: string;
  contact_phone: string;
  notes?: string | null;
}): Promise<OperatorSignupResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = operatorSignupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const ip = clientIp();
  if (!ip) return { ok: false, error: 'ip_required' };

  let hash: string;
  try {
    hash = await hashOperatorPassword(parsed.data.password);
  } catch (err) {
    console.error('[operators-public.operatorSignup] bcrypt failed', err);
    return { ok: false, error: 'bcrypt_failed' };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('operator_signup', {
    p_email: parsed.data.email,
    p_password_hash: hash,
    p_company_name: parsed.data.company_name,
    p_contact_email: parsed.data.contact_email,
    p_contact_phone: parsed.data.contact_phone,
    p_notes: parsed.data.notes ?? null,
    p_ip: ip,
  });
  if (error) {
    console.error('[operators-public.operatorSignup] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as
    | { ok: true; operator_id: string; signup_status: 'pending' }
    | { ok: false; error: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'unknown' };

  return result;
}

// ============================================================
// 2. operatorLogin (2-step: lookup -> Node bcrypt -> create_session)
// ============================================================

export type OperatorLoginResult =
  | {
      ok: true;
      operator_id: string;
      password_must_change: boolean;
      expires_at: string;
    }
  | OperatorPublicActionFailure;

export async function operatorLogin(input: {
  email: string;
  password: string;
  remember_me?: boolean;
}): Promise<OperatorLoginResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = operatorLoginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();

  // Step 1: lookup
  const { data: lookupData, error: lookupErr } = await client.rpc(
    'operator_login_lookup',
    { p_email: parsed.data.email }
  );
  if (lookupErr) {
    console.error('[operators-public.operatorLogin] lookup rpc error', lookupErr);
    return { ok: false, error: 'rpc_failed' };
  }
  const lookup = lookupData as
    | {
        ok: true;
        operator_id: string;
        password_hash: string;
        password_must_change: boolean;
      }
    | { ok: false; error: string };
  if (!lookup.ok) return { ok: false, error: lookup.error ?? 'invalid_credentials' };

  // Step 2: bcrypt compare in Node
  const matches = await verifyOperatorPassword(
    parsed.data.password,
    lookup.password_hash
  );
  if (!matches) return { ok: false, error: 'invalid_credentials' };

  // Step 3: create session
  const minted = mintOperatorSessionToken(parsed.data.remember_me ?? false);
  const { data: sessionData, error: sessionErr } = await client.rpc(
    'operator_login_create_session',
    {
      p_operator_id: lookup.operator_id,
      p_session_token_hash: minted.token_hash,
      p_remember_me: parsed.data.remember_me ?? false,
      p_ip: clientIp(),
      p_user_agent: clientUserAgent(),
    }
  );
  if (sessionErr) {
    console.error('[operators-public.operatorLogin] create_session rpc error', sessionErr);
    return { ok: false, error: 'rpc_failed' };
  }
  const session = sessionData as
    | { ok: true; session_id: string; expires_at: string; password_must_change: boolean }
    | { ok: false; error: string };
  if (!session.ok) return { ok: false, error: session.error ?? 'unknown' };

  // Set cookie
  setOperatorSessionCookie(minted.raw_token, parsed.data.remember_me ?? false);

  return {
    ok: true,
    operator_id: lookup.operator_id,
    password_must_change: session.password_must_change,
    expires_at: session.expires_at,
  };
}

// ============================================================
// 3. operatorLogout (authed)
// ============================================================

export type OperatorLogoutResult = { ok: true } | OperatorPublicActionFailure;

export async function operatorLogout(): Promise<OperatorLogoutResult> {
  const raw = getRawSessionTokenFromCookie();
  if (!raw) {
    // Already logged out — clear cookie just in case + return ok.
    clearOperatorSessionCookie();
    return { ok: true };
  }
  const tokenHash = hashSessionToken(raw);

  const client = createAdminClient();
  const { error } = await client.rpc('operator_logout', {
    p_session_token_hash: tokenHash,
  });
  if (error) {
    console.error('[operators-public.operatorLogout] rpc error', error);
    // Still clear the cookie so the user is locally logged out.
  }
  clearOperatorSessionCookie();
  return { ok: true };
}

// ============================================================
// 4. operatorRequestPasswordReset
// ============================================================

export type OperatorRequestPasswordResetResult =
  | { ok: true }
  | OperatorPublicActionFailure;

export async function operatorRequestPasswordReset(input: {
  email: string;
}): Promise<OperatorRequestPasswordResetResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = operatorRequestPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // Mint token first; on env failure surface a generic
  // 'rpc_failed' (don't leak env state to client).
  let minted;
  try {
    // Use a placeholder operator_id; the real RPC ignores
    // the token's payload contents since it lookups by hash.
    // We bind the token to the looked-up operator below by
    // querying inside the RPC. Token payload's operator_id
    // is informational only.
    minted = mintPasswordResetToken({ operator_id: 'pending-lookup' });
  } catch (err) {
    if (err instanceof PasswordResetTokenEnvError) {
      console.error('[operators-public.operatorRequestPasswordReset] env missing', err);
      // Return ok:true to preserve the no-leak posture (same
      // shape as the RPC's no_op:true on missing email).
      return { ok: true };
    }
    console.error('[operators-public.operatorRequestPasswordReset] mint failed', err);
    return { ok: false, error: 'token_mint_failed' };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('mint_operator_password_reset_token', {
    p_email: parsed.data.email,
    p_token_hash: minted.token_hash,
    p_expires_at: minted.expires_at.toISOString(),
    p_ip: clientIp(),
  });
  if (error) {
    console.error('[operators-public.operatorRequestPasswordReset] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as
    | { ok: true; token_id: string }
    | { ok: true; no_op: true }
    | { ok: false; error: string };

  // Look up operator + send email only if the RPC actually
  // minted a token. The no_op:true shape means "email not
  // registered" — we silently ok to prevent enumeration.
  if (result.ok && 'token_id' in result) {
    const safeEmail = escapeIlikePattern(parsed.data.email.trim());
    const { data: opRow } = await client
      .from('operators')
      .select('contact_email, company_name')
      .ilike('auth_email', safeEmail)
      .maybeSingle();
    if (opRow) {
      const resetUrl = `${siteUrl()}/operator/reset-password/${minted.raw_token}`;
      // Codex round 1 PR #42 P1 #2 fix: dedicated reset-link
      // template (was previously re-purposing the temp-password
      // template with the reset URL crammed into the
      // new_password field — produced a misleading email that
      // labelled the URL as a temporary password and sent users
      // to /login instead of /reset-password).
      const sendResult = await sendOperatorPasswordResetLinkEmail({
        to: opRow.contact_email,
        company_name: opRow.company_name,
        reset_url: resetUrl,
        expires_in_minutes: 30,
      });
      // Codex round 3 PR #42 P2 fix: reflect delivery status
      // in operator_notification_alert_status so admin sees
      // a degraded banner if env is missing / Resend fails.
      // The browser still gets the opaque ok:true below.
      await recordEmailAlertStatus(
        client,
        sendResult,
        'operatorRequestPasswordReset'
      );
    }
  }

  // Always return ok to prevent email enumeration.
  return { ok: true };
}

// ============================================================
// 5. operatorVerifyPasswordReset
// ============================================================

export type OperatorVerifyPasswordResetResult =
  | { ok: true; operator_id: string }
  | OperatorPublicActionFailure;

export async function operatorVerifyPasswordReset(input: {
  raw_token: string;
  new_password: string;
  confirm_password: string;
}): Promise<OperatorVerifyPasswordResetResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = operatorVerifyPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const verified = verifyPasswordResetToken(parsed.data.raw_token);
  if (!verified.valid) {
    if (verified.reason === 'expired') return { ok: false, error: 'token_expired' };
    return { ok: false, error: 'token_not_found' };
  }

  let hash: string;
  try {
    hash = await hashOperatorPassword(parsed.data.new_password);
  } catch (err) {
    console.error('[operators-public.operatorVerifyPasswordReset] bcrypt failed', err);
    return { ok: false, error: 'bcrypt_failed' };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('verify_operator_password_reset', {
    p_token_hash: verified.token_hash,
    p_new_password_hash: hash,
  });
  if (error) {
    console.error('[operators-public.operatorVerifyPasswordReset] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as
    | { ok: true; operator_id: string; sessions_revoked: number }
    | { ok: false; error: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'unknown' };

  return { ok: true, operator_id: result.operator_id };
}

// ============================================================
// 6. operatorVerifyOtp
// ============================================================

export type OperatorVerifyOtpResult =
  | { ok: true; operator_id: string; expires_at: string }
  | OperatorPublicActionFailure;

export async function operatorVerifyOtp(input: {
  email: string;
  code: string;
}): Promise<OperatorVerifyOtpResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = operatorVerifyOtpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();

  // Look up operator id by auth_email (case-insensitive,
  // ILIKE-wildcard-safe — Codex round 2 PR #42 P1 #2 fix).
  const safeEmail = escapeIlikePattern(parsed.data.email.trim());
  const { data: opRow, error: opErr } = await client
    .from('operators')
    .select('id')
    .ilike('auth_email', safeEmail)
    .maybeSingle();
  if (opErr) {
    console.error('[operators-public.operatorVerifyOtp] op lookup error', opErr);
    return { ok: false, error: 'rpc_failed' };
  }
  if (!opRow) return { ok: false, error: 'invalid_credentials' };

  const codeHash = createHash('sha256').update(parsed.data.code).digest('hex');

  const { data, error } = await client.rpc('verify_operator_otp', {
    p_operator_id: opRow.id,
    p_code_hash: codeHash,
  });
  if (error) {
    console.error('[operators-public.operatorVerifyOtp] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as
    | { ok: true; otp_id: string; purpose: string }
    | { ok: false; error: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'unknown' };

  // OTP verified -> create a fresh session (DB-side helper
  // expects we set it via operator_login_create_session).
  const minted = mintOperatorSessionToken(false);
  const { data: sessionData, error: sessionErr } = await client.rpc(
    'operator_login_create_session',
    {
      p_operator_id: opRow.id,
      p_session_token_hash: minted.token_hash,
      p_remember_me: false,
      p_ip: clientIp(),
      p_user_agent: clientUserAgent(),
    }
  );
  if (sessionErr) {
    console.error('[operators-public.operatorVerifyOtp] create_session rpc error', sessionErr);
    return { ok: false, error: 'rpc_failed' };
  }
  const session = sessionData as
    | { ok: true; session_id: string; expires_at: string; password_must_change: boolean }
    | { ok: false; error: string };
  if (!session.ok) return { ok: false, error: session.error ?? 'unknown' };

  setOperatorSessionCookie(minted.raw_token, false);

  return {
    ok: true,
    operator_id: opRow.id,
    expires_at: session.expires_at,
  };
}

// ============================================================
// 7. operatorConsumeWelcomeToken (public)
// ============================================================

export type OperatorConsumeWelcomeTokenResult =
  | {
      ok: true;
      operator_id: string;
      expires_at: string;
      password_must_change: boolean;
    }
  | OperatorPublicActionFailure;

export async function operatorConsumeWelcomeToken(input: {
  raw_token: string;
  remember_me?: boolean;
}): Promise<OperatorConsumeWelcomeTokenResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = operatorWelcomeConsumeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // The welcome-token verification happens in the SECURITY
  // DEFINER RPC — it lookups by sha256(rawToken). Compute the
  // hash here.
  const tokenHash = createHash('sha256').update(parsed.data.raw_token).digest('hex');
  const minted = mintOperatorSessionToken(parsed.data.remember_me ?? false);

  const client = createAdminClient();
  const { data, error } = await client.rpc('consume_operator_welcome_token', {
    p_token_hash: tokenHash,
    p_session_token_hash: minted.token_hash,
    p_remember_me: parsed.data.remember_me ?? false,
    p_ip: clientIp(),
    p_user_agent: clientUserAgent(),
  });
  if (error) {
    console.error('[operators-public.operatorConsumeWelcomeToken] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as
    | {
        ok: true;
        operator_id: string;
        session_id: string;
        expires_at: string;
        password_must_change: boolean;
      }
    | { ok: false; error: string };
  if (!result.ok) {
    if (result.error === 'already_used') return { ok: false, error: 'welcome_already_used' };
    if (result.error === 'expired') return { ok: false, error: 'welcome_expired' };
    return { ok: false, error: result.error ?? 'unknown' };
  }

  setOperatorSessionCookie(minted.raw_token, parsed.data.remember_me ?? false);

  return {
    ok: true,
    operator_id: result.operator_id,
    expires_at: result.expires_at,
    password_must_change: result.password_must_change,
  };
}

// ============================================================
// 8. operatorChangePassword (authed)
//
// Two paths:
//   - operator with `password_must_change=true` (welcome path):
//     no current_password required; just set new.
//   - normal change: verify current_password via bcrypt.compare
//     before updating.
//
// We do a direct UPDATE on operators (NOT via admin_reset RPC)
// because admin_reset revokes all sessions — that would log
// the operator out mid-flow. Operator-self-change preserves
// the current session.
// ============================================================

export type OperatorChangePasswordResult =
  | { ok: true }
  | OperatorPublicActionFailure;

export async function operatorChangePassword(input: {
  current_password?: string;
  new_password: string;
  confirm_password: string;
}): Promise<OperatorChangePasswordResult> {
  const session = await requireOperatorSession();

  const parsed = operatorChangePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { data: opRow, error: opErr } = await client
    .from('operators')
    .select('password_hash, password_must_change')
    .eq('id', session.operator_id)
    .maybeSingle();
  if (opErr || !opRow) {
    console.error('[operators-public.operatorChangePassword] op lookup', opErr);
    return { ok: false, error: 'rpc_failed' };
  }

  // If password_must_change is FALSE, the operator must prove
  // they know the current password before changing it. If it
  // is TRUE (welcome / admin reset), skip the current check.
  if (!opRow.password_must_change) {
    if (!parsed.data.current_password || parsed.data.current_password.length === 0) {
      return {
        ok: false,
        error: 'current_password_wrong',
        field_errors: { current_password: 'كلمة المرور الحالية مطلوبة' },
      };
    }
    if (!opRow.password_hash) {
      // Account had no password (admin-created without one).
      // Treat any non-empty current as wrong.
      return { ok: false, error: 'current_password_wrong' };
    }
    const matches = await verifyOperatorPassword(
      parsed.data.current_password,
      opRow.password_hash
    );
    if (!matches) return { ok: false, error: 'current_password_wrong' };
  }

  let hash: string;
  try {
    hash = await hashOperatorPassword(parsed.data.new_password);
  } catch (err) {
    console.error('[operators-public.operatorChangePassword] bcrypt failed', err);
    return { ok: false, error: 'bcrypt_failed' };
  }

  const { error: updErr } = await client
    .from('operators')
    .update({
      password_hash: hash,
      password_set_at: new Date().toISOString(),
      password_must_change: false,
    })
    .eq('id', session.operator_id);
  if (updErr) {
    console.error('[operators-public.operatorChangePassword] update error', updErr);
    return { ok: false, error: 'rpc_failed' };
  }

  revalidatePath('/operator/profile');
  revalidatePath('/operator/profile/password');
  return { ok: true };
}

// ============================================================
// 9. operatorUpdateProfile (authed)
//
// Updates company_name + contact_email + contact_phone via a
// direct UPDATE. auth_email is intentionally NOT mutable from
// here (immutable login identity per spec).
// ============================================================

export type OperatorUpdateProfileResult =
  | { ok: true }
  | OperatorPublicActionFailure;

export async function operatorUpdateProfile(input: {
  company_name: string;
  contact_email: string;
  contact_phone: string;
}): Promise<OperatorUpdateProfileResult> {
  const session = await requireOperatorSession();

  // Codex round 1 PR #42 P1 #1 fix: block authed mutations
  // (other than logout + change-password) while
  // password_must_change=true. The authed layout already
  // redirects must-change sessions to /operator/profile/password,
  // but Server Actions can be invoked from any client surface
  // (browser DevTools, malicious script) — re-check at the
  // Server Action boundary as defense in depth.
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = operatorUpdateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { error } = await client
    .from('operators')
    .update({
      company_name: parsed.data.company_name,
      contact_email: parsed.data.contact_email,
      contact_phone: parsed.data.contact_phone,
    })
    .eq('id', session.operator_id);
  if (error) {
    console.error('[operators-public.operatorUpdateProfile] update error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  revalidatePath('/operator/profile');
  revalidatePath('/operator/dashboard');
  return { ok: true };
}
