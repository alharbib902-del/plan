import type { AdminUserRole } from '@/lib/admin/users/queries';
import { adminRoleAllowed } from '@/lib/admin/rbac';

/**
 * Pure decision table behind requireAdminSession() (lib/admin/auth.ts),
 * kept free of cookies/redirects/DB so the gate ORDER is unit-testable.
 *
 * Order (first match wins):
 *   1. mfa_pending        → /admin/login/mfa          (finish the challenge)
 *   2. must_change_password → /admin/account/password (rotate the seed password)
 *   3. no enrolled TOTP   → /admin/account/mfa/enroll (MFA is mandatory)
 *   4. role not allowed   → /admin/forbidden
 *
 * The enrolment gate (3) is skipped while 1 or 2 is pending — even
 * when the caller opted past them — so the challenge page, the
 * rotation page/action and signOut never bounce into enrolment
 * (which itself requires a fully rotated session) and loop.
 */

export type AdminMfaEnrollmentState = 'enrolled' | 'not_enrolled' | 'unknown';

export interface AdminSessionGateOptions {
  allowMfaPending?: boolean;
  allowMustChangePassword?: boolean;
  /**
   * Opt-in for the enrolment surfaces only (enrol page, start/confirm
   * enrolment actions, signOut). Everything else requires a confirmed
   * TOTP enrolment.
   */
  allowMfaUnenrolled?: boolean;
  roles?: readonly AdminUserRole[];
}

export interface AdminSessionGateState {
  mfaPending: boolean;
  mustChangePassword: boolean;
  role: AdminUserRole;
  /** null = not loaded (only load it when mfaEnrollmentGateApplies). */
  mfaEnrollment: AdminMfaEnrollmentState | null;
}

export const ADMIN_MFA_CHALLENGE_PATH = '/admin/login/mfa';
export const ADMIN_PASSWORD_ROTATION_PATH = '/admin/account/password';
export const ADMIN_MFA_ENROLL_PATH = '/admin/account/mfa/enroll';
export const ADMIN_FORBIDDEN_PATH = '/admin/forbidden';

export type AdminSessionGateVerdict =
  | { kind: 'allow' }
  | {
      kind: 'redirect';
      to:
        | typeof ADMIN_MFA_CHALLENGE_PATH
        | typeof ADMIN_PASSWORD_ROTATION_PATH
        | typeof ADMIN_MFA_ENROLL_PATH
        | typeof ADMIN_FORBIDDEN_PATH;
    }
  // Enrolment state could not be read — deny rather than guess.
  | { kind: 'mfa_state_unavailable' };

export function mfaEnrollmentGateApplies(
  state: Pick<AdminSessionGateState, 'mfaPending' | 'mustChangePassword'>,
  opts: AdminSessionGateOptions
): boolean {
  return (
    !state.mfaPending &&
    !state.mustChangePassword &&
    opts.allowMfaUnenrolled !== true
  );
}

export function evaluateAdminSessionGate(
  state: AdminSessionGateState,
  opts: AdminSessionGateOptions
): AdminSessionGateVerdict {
  if (state.mfaPending && opts.allowMfaPending !== true) {
    return { kind: 'redirect', to: ADMIN_MFA_CHALLENGE_PATH };
  }

  if (state.mustChangePassword && opts.allowMustChangePassword !== true) {
    return { kind: 'redirect', to: ADMIN_PASSWORD_ROTATION_PATH };
  }

  if (mfaEnrollmentGateApplies(state, opts)) {
    if (state.mfaEnrollment === null || state.mfaEnrollment === 'unknown') {
      return { kind: 'mfa_state_unavailable' };
    }
    if (state.mfaEnrollment === 'not_enrolled') {
      return { kind: 'redirect', to: ADMIN_MFA_ENROLL_PATH };
    }
  }

  if (opts.roles && !adminRoleAllowed(state.role, opts.roles)) {
    return { kind: 'redirect', to: ADMIN_FORBIDDEN_PATH };
  }

  return { kind: 'allow' };
}
