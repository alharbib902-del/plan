'use server';

import { z } from 'zod';

import { requireAdminSession } from '@/lib/admin/auth';
import { buildOtpAuthUrl } from '@/lib/admin/mfa/totp';
import {
  beginAdminMfaEnrollment,
  confirmAdminMfaEnrollment,
  consumeAdminMfaRecoveryCode,
  disableAdminMfa,
  loadAdminMfaSecret,
  verifyAdminMfaOtpChallenge,
} from '@/lib/admin/mfa/queries';
import { clearAdminUserSessionMfaPending } from '@/lib/admin/users/sessions';
import { verifyAdminCurrentPassword } from '@/lib/admin/users/queries';
import { isWellFormedRawRecoveryCode } from '@/lib/admin/mfa/recovery-codes';

/**
 * Admin MFA Server Actions — PR-3b cutover.
 *
 * Four surfaces:
 *   1. startEnrollment       → mint seed, return otpauth URL.
 *      Requires a fully-authenticated session (NOT mfa_pending,
 *      NOT must_change_password) so we don't enroll an admin
 *      who hasn't even rotated their seed password.
 *   2. confirmEnrollment     → verify first OTP, flip
 *      enrolled_at, mint + return 10 recovery codes ONCE.
 *   3. verifyChallenge       → during login (mfa_pending session).
 *      Verifies OTP or recovery code + atomically clears the
 *      mfa_pending flag on the current session.
 *   4. disable               → wipes secret + recovery codes.
 *      Requires re-verification of password + current OTP so a
 *      session hijacker can't strip MFA from a stolen cookie.
 */

// ============================================================
// 1. startEnrollment
// ============================================================

const ISSUER = 'Aeris';

export type StartEnrollmentResult =
  | {
      ok: true;
      secret_base32: string;
      otpauth_url: string;
    }
  | {
      ok: false;
      error: 'already_enrolled' | 'storage_error';
    };

export async function startMfaEnrollment(): Promise<StartEnrollmentResult> {
  const session = await requireAdminSession();

  const begin = await beginAdminMfaEnrollment(session.adminUserId);
  if (!begin.ok) {
    return { ok: false, error: begin.reason };
  }

  return {
    ok: true,
    secret_base32: begin.secret_base32,
    otpauth_url: buildOtpAuthUrl({
      issuer: ISSUER,
      label: session.email,
      secretBase32: begin.secret_base32,
    }),
  };
}

// ============================================================
// 2. confirmEnrollment
// ============================================================

const otpSchema = z.object({
  otp: z
    .string({ required_error: 'otp_required' })
    .trim()
    .regex(/^\d{6}$/, 'otp_format'),
});

export type ConfirmEnrollmentResult =
  | {
      ok: true;
      recovery_codes: string[];
    }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'no_pending_enrollment'
        | 'invalid_otp'
        | 'storage_error';
    };

export async function confirmMfaEnrollment(input: {
  otp: string;
}): Promise<ConfirmEnrollmentResult> {
  const session = await requireAdminSession();

  const parsed = otpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  const result = await confirmAdminMfaEnrollment({
    admin_user_id: session.adminUserId,
    otp_candidate: parsed.data.otp,
  });
  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  return { ok: true, recovery_codes: result.recovery_codes };
}

// ============================================================
// 3. verifyChallenge (used during login when mfa_pending=true)
// ============================================================

const challengeSchema = z
  .object({
    kind: z.enum(['otp', 'recovery']),
    code: z
      .string({ required_error: 'code_required' })
      .trim()
      .min(1, 'code_required')
      .max(40, 'code_too_long'),
  })
  .refine(
    (d) =>
      d.kind === 'otp'
        ? /^\d{6}$/.test(d.code)
        : isWellFormedRawRecoveryCode(d.code),
    { path: ['code'], message: 'code_format' }
  );

export type VerifyMfaChallengeResult =
  | {
      ok: true;
      must_change_password: boolean;
      recovery_codes_remaining?: number;
    }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'no_active_mfa'
        | 'invalid_code'
        | 'replay_same_step'
        | 'storage_error';
    };

export async function verifyMfaChallenge(input: {
  kind: 'otp' | 'recovery';
  code: string;
}): Promise<VerifyMfaChallengeResult> {
  // Opt in to the mfa_pending gate — this action IS the
  // challenge. Without the flag the gate would redirect the
  // request back to /admin/login/mfa in a loop.
  const session = await requireAdminSession({
    allowMfaPending: true,
    allowMustChangePassword: true,
  });

  if (!session.mfaPending) {
    // Defensive: the session no longer needs MFA. Could mean a
    // double-submit after a successful challenge in another
    // tab. Surface as already-cleared and let the UI redirect.
    return {
      ok: true,
      must_change_password: session.mustChangePassword,
    };
  }

  const parsed = challengeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  let remaining: number | undefined;

  if (parsed.data.kind === 'otp') {
    const verdict = await verifyAdminMfaOtpChallenge({
      admin_user_id: session.adminUserId,
      otp_candidate: parsed.data.code,
    });
    if (!verdict.ok) {
      return {
        ok: false,
        error:
          verdict.reason === 'no_active_mfa'
            ? 'no_active_mfa'
            : verdict.reason === 'replay_same_step'
              ? 'replay_same_step'
              : verdict.reason === 'storage_error'
                ? 'storage_error'
                : 'invalid_code',
      };
    }
  } else {
    const verdict = await consumeAdminMfaRecoveryCode({
      admin_user_id: session.adminUserId,
      raw_code: parsed.data.code,
      consumed_session_id: session.sessionId,
    });
    if (!verdict.ok) {
      return {
        ok: false,
        error:
          verdict.reason === 'no_active_mfa'
            ? 'no_active_mfa'
            : verdict.reason === 'storage_error'
              ? 'storage_error'
              : 'invalid_code',
      };
    }
    remaining = verdict.recovery_codes_remaining;
  }

  // Atomically clear mfa_pending on THIS session. The clear is
  // scoped to mfa_pending=true so a race with another browser
  // tab can't bring it back.
  const cleared = await clearAdminUserSessionMfaPending(session.sessionId);
  if (!cleared) {
    // The session row may have been revoked or already cleared
    // by a concurrent challenge. Either way the next request
    // will re-evaluate the gate; surface ok to the UI so it
    // navigates forward.
    return {
      ok: true,
      must_change_password: session.mustChangePassword,
      ...(remaining !== undefined && { recovery_codes_remaining: remaining }),
    };
  }

  return {
    ok: true,
    must_change_password: session.mustChangePassword,
    ...(remaining !== undefined && { recovery_codes_remaining: remaining }),
  };
}

// ============================================================
// 4. disable
// ============================================================

const disableSchema = z.object({
  current_password: z
    .string({ required_error: 'current_required' })
    .min(1, 'current_required')
    .max(128, 'current_too_long'),
  otp: z
    .string({ required_error: 'otp_required' })
    .trim()
    .regex(/^\d{6}$/, 'otp_format'),
});

export type DisableMfaResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'current_invalid'
        | 'invalid_otp'
        | 'replay_same_step'
        | 'no_active_mfa'
        | 'storage_error';
    };

export async function disableMfaForCurrentAdmin(input: {
  current_password: string;
  otp: string;
}): Promise<DisableMfaResult> {
  const session = await requireAdminSession();

  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  // Re-verify password to defeat session-hijack: a stolen
  // cookie alone cannot disable MFA.
  const passwordCheck = await verifyAdminCurrentPassword({
    admin_user_id: session.adminUserId,
    current_password: parsed.data.current_password,
  });
  if (!passwordCheck.ok) {
    return { ok: false, error: 'current_invalid' };
  }

  // Must also pass a live OTP — proves possession of the
  // device. Otherwise an attacker who phished the password
  // could strip MFA without the second factor.
  const otpCheck = await verifyAdminMfaOtpChallenge({
    admin_user_id: session.adminUserId,
    otp_candidate: parsed.data.otp,
  });
  if (!otpCheck.ok) {
    return {
      ok: false,
      error:
        otpCheck.reason === 'no_active_mfa'
          ? 'no_active_mfa'
          : otpCheck.reason === 'replay_same_step'
            ? 'replay_same_step'
            : otpCheck.reason === 'storage_error'
              ? 'storage_error'
              : 'invalid_otp',
    };
  }

  const cleared = await disableAdminMfa(session.adminUserId);
  if (!cleared) return { ok: false, error: 'storage_error' };
  return { ok: true };
}

// ============================================================
// Read-only status (for the manage page)
// ============================================================

export type MfaStatusResult =
  | { ok: true; enrolled: boolean; enrolled_at: string | null }
  | { ok: false };

export async function getMfaStatus(): Promise<MfaStatusResult> {
  const session = await requireAdminSession();
  const row = await loadAdminMfaSecret(session.adminUserId);
  return {
    ok: true,
    enrolled: row !== null && row.enrolled_at !== null,
    enrolled_at: row?.enrolled_at ?? null,
  };
}
