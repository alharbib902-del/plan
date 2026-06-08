'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  AdminEnvError,
  clearAdminCookieAndSession,
  issueAdminSession,
  requireAdminEnv,
  requireAdminSession,
} from '@/lib/admin/auth';
import {
  checkAdminLoginRateLimit,
  recordAdminLoginAttempt,
} from '@/lib/admin/login-rate-limit';
import {
  stampAdminUserLogin,
  verifyAdminCredentials,
} from '@/lib/admin/users/queries';
import { tryFounderSeed } from '@/lib/admin/users/founder-seed';
import { adminHasActiveMfa } from '@/lib/admin/mfa/queries';
import {
  actorIdentityFromHeaders,
  fingerprintAdminLoginActor,
} from '@/lib/admin/login-rate-limit-core';
import { adminLoginSchema } from '@/lib/validators/admin';

/**
 * Admin Server Actions — login + logout.
 *
 * PR-2 (cutover) rewrite: the shared ADMIN_INBOX_PASSWORD path
 * is gone. Login now takes email + password against admin_users
 * and issues a DB-backed session token cookie.
 *
 * Auto-seed: when the admin_users table is empty AND the email
 * matches ADMIN_FOUNDER_EMAIL env AND the password matches the
 * still-present ADMIN_INBOX_PASSWORD env, lib/admin/users/
 * founder-seed.ts inserts the founder row inline (with
 * must_change_password=true) before continuing with the normal
 * verifyAdminCredentials path. The founder's first login then
 * completes transparently.
 *
 * Rate-limit + audit ledger contracts unchanged from PR #86:
 * we still HMAC-fingerprint the caller identity (IP-based,
 * never raw IP) and record each attempt outcome.
 */

export type SignInResult =
  | {
      ok: true;
      must_change_password: boolean;
      /**
       * PR-3b — when true, the password verified but the admin
       * has MFA enrolled. The session was issued in mfa_pending
       * state; the UI must navigate to /admin/login/mfa for the
       * challenge step.
       */
      mfa_required: boolean;
    }
  | {
      ok: false;
      error:
        | 'env'
        | 'invalid_credentials'
        | 'invalid_input'
        | 'rate_limited';
    };

async function ipFingerprintFromHeaders(secret: string): Promise<string> {
  const h = await headers();
  const identity = actorIdentityFromHeaders({
    vercelForwardedFor: h.get('x-vercel-forwarded-for'),
    forwardedFor: h.get('x-forwarded-for'),
    realIp: h.get('x-real-ip'),
    cfConnectingIp: h.get('cf-connecting-ip'),
    userAgent: h.get('user-agent'),
  });
  return fingerprintAdminLoginActor(identity, secret);
}

export async function signIn(formData: FormData): Promise<SignInResult> {
  let env;
  try {
    env = requireAdminEnv();
  } catch (err) {
    if (err instanceof AdminEnvError) {
      console.error('[admin-auth] sign-in blocked by env error', err.message);
      return { ok: false, error: 'env' };
    }
    throw err;
  }

  const rateLimit = await checkAdminLoginRateLimit();
  if (!rateLimit.ok) {
    await recordAdminLoginAttempt(rateLimit.actorFingerprint, 'rate_limited');
    return { ok: false, error: 'rate_limited' };
  }

  const parsed = adminLoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    await recordAdminLoginAttempt(rateLimit.actorFingerprint, 'invalid_input');
    return { ok: false, error: 'invalid_input' };
  }

  // Auto-seed branch: only fires when admin_users is empty AND
  // the env-bound founder bootstrap conditions all pass. Every
  // other outcome falls through silently to verifyAdminCredentials.
  // The seed itself does NOT count as a login attempt; the
  // subsequent verifyAdminCredentials call does.
  await tryFounderSeed({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  const verdict = await verifyAdminCredentials(
    parsed.data.email,
    parsed.data.password
  );
  if (!verdict.ok) {
    await recordAdminLoginAttempt(
      rateLimit.actorFingerprint,
      'invalid_password'
    );
    return { ok: false, error: 'invalid_credentials' };
  }

  const userAgent = (await headers()).get('user-agent');
  const ipFingerprint = await ipFingerprintFromHeaders(env.secret);

  // PR-3b — if the admin has active MFA enrollment, issue the
  // session in mfa_pending state. requireAdminSession() then
  // routes the user to /admin/login/mfa for the challenge step
  // before any other admin surface becomes accessible.
  const mfaActive = await adminHasActiveMfa(verdict.user.id);

  const issued = await issueAdminSession({
    adminUserId: verdict.user.id,
    userAgent,
    ipFingerprint,
    mfaPending: mfaActive,
  });
  if (!issued) {
    // createAdminUserSession failed — fail-closed. Reported as
    // invalid_credentials to match the anti-enumeration contract.
    await recordAdminLoginAttempt(
      rateLimit.actorFingerprint,
      'invalid_password'
    );
    return { ok: false, error: 'invalid_credentials' };
  }

  // PR #92 round-1 P1 fix: only stamp last_login_at + record
  // the final 'success' attempt once the FULL login completes
  // (post-MFA). For mfa_pending=true sessions, record a
  // dedicated 'password_ok_pending_mfa' outcome so the
  // admin_login_attempts ledger truthfully reflects "first
  // factor passed, second factor pending" instead of
  // misleadingly marking the whole flow successful.
  //
  // The MFA challenge action records its own outcomes to the
  // admin_mfa_challenge_attempts ledger; the final 'success'
  // for the full login is written there when MFA verifies.
  if (!issued.mfaPending) {
    await stampAdminUserLogin(verdict.user.id);
    await recordAdminLoginAttempt(rateLimit.actorFingerprint, 'success');
  } else {
    await recordAdminLoginAttempt(
      rateLimit.actorFingerprint,
      'password_ok_pending_mfa'
    );
  }

  return {
    ok: true,
    must_change_password: verdict.user.must_change_password,
    mfa_required: issued.mfaPending,
  };
}

export async function signOut(): Promise<void> {
  // Even sign-out requires a valid session — otherwise an
  // unauthenticated request can spam this endpoint. The
  // requireAdminSession call also fail-closes on revoked /
  // disabled users so a stale cookie can't trigger revoke loops.
  //
  // Opt-in to BOTH the must_change_password AND mfa_pending
  // bypasses — letting a user log out without completing
  // rotation or MFA challenge is the right UX. Without these
  // flags, an admin mid-MFA-challenge who wants to walk away
  // would get the logout request redirected back to the
  // challenge page.
  await requireAdminSession({
    allowMustChangePassword: true,
    allowMfaPending: true,
  });
  await clearAdminCookieAndSession();
  redirect('/admin/login');
}
