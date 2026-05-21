'use server';

import { z } from 'zod';

import { requireAdminSession } from '@/lib/admin/auth';
import {
  hashAdminPassword,
  validateAdminPassword,
} from '@/lib/admin/users/credentials';
import {
  rotateAdminUserPassword,
  verifyAdminCurrentPassword,
} from '@/lib/admin/users/queries';
import { revokeOtherActiveAdminUserSessions } from '@/lib/admin/users/sessions';

/**
 * Admin account Server Actions — password rotation.
 *
 * Round-1 fix for PR #89 P1: must_change_password was only
 * enforced in the client form. The new (protected)/layout.tsx
 * gate redirects authenticated admins with the flag set to
 * /admin/account/password (this route, OUTSIDE the protected
 * group). This Server Action does the actual rotation:
 *   1. Re-verifies the current password (no privilege escalation
 *      via session theft).
 *   2. Validates the new password against the same strength
 *      rules used at user creation (12-128 chars, lower+upper+
 *      digit; NIST 800-63B style).
 *   3. Rejects new=current (forces a real rotation).
 *   4. Hashes via bcrypt + UPDATEs admin_users
 *      (password_hash + must_change_password=false).
 *   5. Revokes EVERY OTHER active session for this admin so a
 *      leaked-cookie scenario doesn't keep impersonating after
 *      the rotation completes.
 *
 * Returns a uniform error envelope for the form to translate.
 */

const changePasswordSchema = z
  .object({
    current_password: z
      .string({ required_error: 'current_required' })
      .min(1, 'current_required')
      .max(128, 'current_too_long'),
    new_password: z
      .string({ required_error: 'new_required' })
      .min(1, 'new_required')
      .max(128, 'new_too_long'),
    confirm_password: z
      .string({ required_error: 'confirm_required' })
      .min(1, 'confirm_required'),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    path: ['confirm_password'],
    message: 'confirm_mismatch',
  });

export type ChangePasswordResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'current_invalid'
        | 'new_weak'
        | 'new_too_short'
        | 'new_too_long'
        | 'new_same_as_current'
        | 'storage_error';
      detail?: string;
    };

export async function changePassword(
  input: unknown
): Promise<ChangePasswordResult> {
  // Opt-in to the must_change_password bypass — this action IS
  // the rotation, so the gate must not redirect us back to
  // /admin/account/password infinitely.
  const session = await requireAdminSession({
    allowMustChangePassword: true,
  });

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  const data = parsed.data;

  // Step 1: verify current password against the stored hash.
  const currentCheck = await verifyAdminCurrentPassword({
    admin_user_id: session.adminUserId,
    current_password: data.current_password,
  });
  if (!currentCheck.ok) {
    return { ok: false, error: 'current_invalid' };
  }

  // Step 2: new password strength.
  const strength = validateAdminPassword(data.new_password);
  if (!strength.ok) {
    return {
      ok: false,
      error:
        strength.error === 'password_too_short'
          ? 'new_too_short'
          : strength.error === 'password_too_long'
            ? 'new_too_long'
            : 'new_weak',
    };
  }

  // Step 3: reject no-op rotations.
  if (data.new_password === data.current_password) {
    return { ok: false, error: 'new_same_as_current' };
  }

  // Step 4: hash + persist.
  const hash = await hashAdminPassword(data.new_password);
  const rotated = await rotateAdminUserPassword({
    admin_user_id: session.adminUserId,
    new_password_hash: hash,
  });
  if (!rotated.ok) {
    return { ok: false, error: 'storage_error' };
  }

  // Step 5: revoke OTHER sessions. Kept fire-and-fail-soft —
  // a transient error here doesn't fail the rotation (the
  // primary security goal — preventing future logins with the
  // old password — is already achieved by step 4).
  await revokeOtherActiveAdminUserSessions({
    admin_user_id: session.adminUserId,
    keep_session_id: session.sessionId,
    revoked_by_admin_user_id: session.adminUserId,
  });

  return { ok: true };
}
