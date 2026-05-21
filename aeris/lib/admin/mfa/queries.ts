import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  base32Decode,
  generateTotp,
  mintTotpSecret,
  verifyTotp,
  type VerifyTotpResult,
} from '@/lib/admin/mfa/totp';
import {
  hashRecoveryCode,
  mintRecoveryCodes,
} from '@/lib/admin/mfa/recovery-codes';

/**
 * Server-only DB layer for admin MFA (Option B Phase 1c).
 *
 * No Server Actions wire these helpers yet — PR-3b will. The
 * surface is designed so PR-3b's enrollment + challenge actions
 * are one-liners on top.
 *
 * Notes on enrolled_at:
 *   - A row with enrolled_at = NULL is a PENDING enrollment.
 *     The login challenge MUST treat such admins as
 *     "no MFA configured" so an in-progress setup never locks
 *     the admin out (e.g. they reload the enrollment page
 *     before scanning the QR).
 *   - confirmEnrollment flips enrolled_at to NOW() on the first
 *     successful OTP entry.
 *
 * Same-step replay defense:
 *   - On verify success we record `last_used_at` AND the
 *     `matched_step`. A subsequent verify with the same step
 *     within the same admin row is rejected (covers an attacker
 *     who sniffed the live OTP from a network MITM and tries to
 *     reuse it within 30s).
 */

const SECRETS_TABLE = 'admin_mfa_secrets';
const CODES_TABLE = 'admin_mfa_recovery_codes';

type LooseStore = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        maybeSingle: () => Promise<{
          data: unknown;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
    insert: (
      rows: Record<string, unknown> | Record<string, unknown>[]
    ) => Promise<{ error: { code?: string; message?: string } | null }>;
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => Promise<{
        error: { message?: string } | null;
      }>;
    };
    upsert: (
      row: Record<string, unknown>,
      opts: { onConflict: string }
    ) => Promise<{ error: { code?: string; message?: string } | null }>;
    delete: () => {
      eq: (col: string, val: unknown) => Promise<{
        error: { message?: string } | null;
      }>;
    };
  };
};

function store(): LooseStore {
  return createAdminClient() as unknown as LooseStore;
}

// --------------------------------------------------------------
// 1. Lookup
// --------------------------------------------------------------

export interface AdminMfaSecretRow {
  admin_user_id: string;
  secret_base32: string;
  enrolled_at: string | null;
  last_used_at: string | null;
}

export async function loadAdminMfaSecret(
  adminUserId: string
): Promise<AdminMfaSecretRow | null> {
  const { data, error } = await store()
    .from(SECRETS_TABLE)
    .select('admin_user_id, secret_base32, enrolled_at, last_used_at')
    .eq('admin_user_id', adminUserId)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[admin-mfa.loadSecret] read failed', error);
    }
    return null;
  }
  return (data as AdminMfaSecretRow | null) ?? null;
}

/**
 * Convenience: is this admin enrolled in MFA (PR-3b's login
 * challenge predicate)?
 */
export async function adminHasActiveMfa(
  adminUserId: string
): Promise<boolean> {
  const row = await loadAdminMfaSecret(adminUserId);
  return row !== null && row.enrolled_at !== null;
}

// --------------------------------------------------------------
// 2. Begin enrollment — overwrites any pending secret
// --------------------------------------------------------------

export type BeginEnrollmentResult =
  | {
      ok: true;
      secret_base32: string;
      // 8-second freshness counter for the QR display — the UI
      // can show "this code refreshes in N seconds" hint.
      generated_at: string;
    }
  | { ok: false; reason: 'already_enrolled' | 'storage_error' };

export async function beginAdminMfaEnrollment(
  adminUserId: string
): Promise<BeginEnrollmentResult> {
  const existing = await loadAdminMfaSecret(adminUserId);
  if (existing && existing.enrolled_at !== null) {
    return { ok: false, reason: 'already_enrolled' };
  }

  const minted = mintTotpSecret();
  const now = new Date().toISOString();

  const { error } = await store()
    .from(SECRETS_TABLE)
    .upsert(
      {
        admin_user_id: adminUserId,
        secret_base32: minted.base32,
        enrolled_at: null,
        last_used_at: null,
        updated_at: now,
      },
      { onConflict: 'admin_user_id' }
    );
  if (error) {
    console.error('[admin-mfa.beginEnrollment] upsert failed', error);
    return { ok: false, reason: 'storage_error' };
  }

  return { ok: true, secret_base32: minted.base32, generated_at: now };
}

// --------------------------------------------------------------
// 3. Confirm enrollment — verify the first OTP, flip enrolled_at,
//    mint + store recovery codes.
// --------------------------------------------------------------

export type ConfirmEnrollmentResult =
  | {
      ok: true;
      // RAW codes shown to admin ONCE. Caller renders them +
      // discards them; they are never persisted.
      recovery_codes: string[];
    }
  | {
      ok: false;
      reason: 'no_pending_enrollment' | 'invalid_otp' | 'storage_error';
    };

export async function confirmAdminMfaEnrollment(args: {
  admin_user_id: string;
  otp_candidate: string;
}): Promise<ConfirmEnrollmentResult> {
  const secret = await loadAdminMfaSecret(args.admin_user_id);
  if (!secret) return { ok: false, reason: 'no_pending_enrollment' };
  if (secret.enrolled_at !== null) {
    // The admin already finished enrollment via another tab —
    // treat as success-but-no-new-codes? Safer to reject so they
    // see something happened.
    return { ok: false, reason: 'no_pending_enrollment' };
  }

  const verdict = verifyTotp({
    candidate: args.otp_candidate,
    secretBase32: secret.secret_base32,
  });
  if (!verdict.ok) {
    return { ok: false, reason: 'invalid_otp' };
  }

  // Mint recovery codes BEFORE flipping enrolled_at so we can
  // bail without partial enrollment if the INSERT fails.
  const rawCodes = mintRecoveryCodes();
  const rows = rawCodes.map((raw) => ({
    admin_user_id: args.admin_user_id,
    code_hash: hashRecoveryCode(raw),
  }));

  const codesInsert = await store().from(CODES_TABLE).insert(rows);
  if (codesInsert.error) {
    console.error(
      '[admin-mfa.confirm] recovery insert failed',
      codesInsert.error
    );
    return { ok: false, reason: 'storage_error' };
  }

  const now = new Date().toISOString();
  const { error: flipError } = await store()
    .from(SECRETS_TABLE)
    .update({
      enrolled_at: now,
      last_used_at: now,
    })
    .eq('admin_user_id', args.admin_user_id);

  if (flipError) {
    console.error('[admin-mfa.confirm] enrolled_at flip failed', flipError);
    // Best-effort cleanup of the recovery codes so a future
    // begin-enrollment can start fresh.
    await store()
      .from(CODES_TABLE)
      .delete()
      .eq('admin_user_id', args.admin_user_id);
    return { ok: false, reason: 'storage_error' };
  }

  return { ok: true, recovery_codes: rawCodes };
}

// --------------------------------------------------------------
// 4. Challenge — verify an OTP from an already-enrolled admin
// --------------------------------------------------------------

export type ChallengeOtpResult =
  | { ok: true; matched_step: number }
  | {
      ok: false;
      reason:
        | 'no_active_mfa'
        | 'invalid_otp'
        | 'replay_same_step'
        | 'storage_error';
    };

export async function verifyAdminMfaOtpChallenge(args: {
  admin_user_id: string;
  otp_candidate: string;
}): Promise<ChallengeOtpResult> {
  const secret = await loadAdminMfaSecret(args.admin_user_id);
  if (!secret || secret.enrolled_at === null) {
    return { ok: false, reason: 'no_active_mfa' };
  }

  const verdict: VerifyTotpResult = verifyTotp({
    candidate: args.otp_candidate,
    secretBase32: secret.secret_base32,
  });
  if (!verdict.ok) {
    return { ok: false, reason: 'invalid_otp' };
  }

  // Same-step replay defense: reject if last_used_at falls into
  // the SAME step we just matched.
  if (secret.last_used_at) {
    const lastUsedSeconds = Math.floor(
      new Date(secret.last_used_at).getTime() / 1000
    );
    const lastUsedStep = Math.floor(lastUsedSeconds / 30);
    if (lastUsedStep >= verdict.matched_step) {
      return { ok: false, reason: 'replay_same_step' };
    }
  }

  const { error } = await store()
    .from(SECRETS_TABLE)
    .update({ last_used_at: new Date().toISOString() })
    .eq('admin_user_id', args.admin_user_id);
  if (error) {
    console.error('[admin-mfa.challenge] last_used_at update failed', error);
    return { ok: false, reason: 'storage_error' };
  }

  return { ok: true, matched_step: verdict.matched_step };
}

// --------------------------------------------------------------
// 5. Recovery code consume — one-time use
// --------------------------------------------------------------

export type ConsumeRecoveryCodeResult =
  | { ok: true; recovery_codes_remaining: number }
  | {
      ok: false;
      reason: 'no_active_mfa' | 'invalid_or_consumed' | 'storage_error';
    };

type LooseCountStore = {
  from: (table: string) => {
    select: (
      cols: string,
      opts: { count: 'exact'; head: boolean }
    ) => {
      eq: (col: string, val: unknown) => {
        is: (col: string, val: null) => Promise<{
          count: number | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

type LooseConsumeStore = {
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => {
        is: (col: string, val: null) => Promise<{
          count: number | null;
          error: { message?: string } | null;
          data: unknown;
        }>;
      };
    };
  };
};

export async function consumeAdminMfaRecoveryCode(args: {
  admin_user_id: string;
  raw_code: string;
  consumed_session_id: string | null;
}): Promise<ConsumeRecoveryCodeResult> {
  const enrolled = await adminHasActiveMfa(args.admin_user_id);
  if (!enrolled) return { ok: false, reason: 'no_active_mfa' };

  const codeHash = hashRecoveryCode(args.raw_code);

  // Conditional UPDATE — flip consumed_at only if the row is
  // still unconsumed AND belongs to this admin. Zero rows
  // updated = either wrong hash, wrong owner, or already
  // consumed; all surface as `invalid_or_consumed` so the
  // attacker doesn't learn which.
  const consume = store() as unknown as LooseConsumeStore;
  const { error: updateError } = await consume
    .from(CODES_TABLE)
    .update({
      consumed_at: new Date().toISOString(),
      consumed_session_id: args.consumed_session_id,
    })
    .eq('code_hash', codeHash)
    .is('consumed_at', null);
  if (updateError) {
    console.error('[admin-mfa.recovery.consume] failed', updateError);
    return { ok: false, reason: 'storage_error' };
  }

  // Verify the update actually flipped a row OWNED by this admin
  // (the UPDATE above can match a code that belongs to a
  // different admin too — defense-in-depth check):
  const owned = await store()
    .from(CODES_TABLE)
    .select('admin_user_id, consumed_at')
    .eq('code_hash', codeHash)
    .maybeSingle();
  if (owned.error || !owned.data) {
    return { ok: false, reason: 'invalid_or_consumed' };
  }
  const ownedRow = owned.data as {
    admin_user_id: string;
    consumed_at: string | null;
  };
  if (ownedRow.admin_user_id !== args.admin_user_id) {
    return { ok: false, reason: 'invalid_or_consumed' };
  }
  if (ownedRow.consumed_at === null) {
    return { ok: false, reason: 'invalid_or_consumed' };
  }

  // Count remaining codes for the UI.
  const counter = store() as unknown as LooseCountStore;
  const { count } = await counter
    .from(CODES_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('admin_user_id', args.admin_user_id)
    .is('consumed_at', null);

  return {
    ok: true,
    recovery_codes_remaining: typeof count === 'number' && count >= 0 ? count : 0,
  };
}

// --------------------------------------------------------------
// 6. Disable MFA — wipe both tables for this admin
//    (PR-3b: only callable after the admin re-verifies their
//    password + current OTP / recovery code in the same request)
// --------------------------------------------------------------

export async function disableAdminMfa(adminUserId: string): Promise<boolean> {
  const s = store();
  const { error: codesErr } = await s
    .from(CODES_TABLE)
    .delete()
    .eq('admin_user_id', adminUserId);
  if (codesErr) {
    console.error('[admin-mfa.disable] codes delete failed', codesErr);
    return false;
  }
  const { error: secretErr } = await s
    .from(SECRETS_TABLE)
    .delete()
    .eq('admin_user_id', adminUserId);
  if (secretErr) {
    console.error('[admin-mfa.disable] secret delete failed', secretErr);
    return false;
  }
  return true;
}

// --------------------------------------------------------------
// Re-export the pure helpers callers will need alongside DB ops
// --------------------------------------------------------------

export { base32Decode, generateTotp };
