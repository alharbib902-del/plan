import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Pure credential helpers for admin_users (Option B Phase 1a).
 *
 * No DB, no env, no 'server-only'. The TS layer above this
 * (lib/admin/users/queries.ts) does the DB hit; this module
 * just normalizes inputs + verifies the password format +
 * exposes the bcrypt verify wrapper for testability.
 *
 * Why bcrypt vs argon2: the repo already pulls bcryptjs for
 * other auth surfaces (Phase 9 client auth). Reusing it keeps
 * dependency surface small. Cost factor pegged at 12 — standard
 * 2026 baseline that takes ~250ms on modern hardware.
 */

import bcrypt from 'bcryptjs';

export const BCRYPT_COST = 12;

// Format: local@domain.tld — same as the SQL CHECK in §1.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

export function normalizeAdminEmail(value: string): string {
  return value.trim().toLowerCase();
}

export type EmailValidation =
  | { ok: true; email: string }
  | { ok: false; error: 'email_empty' | 'email_format' | 'email_too_long' };

export function validateAdminEmail(raw: string): EmailValidation {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'email_empty' };
  }
  const normalized = normalizeAdminEmail(raw);
  if (normalized.length === 0) {
    return { ok: false, error: 'email_empty' };
  }
  if (normalized.length > 254) {
    return { ok: false, error: 'email_too_long' };
  }
  if (!EMAIL_RE.test(normalized)) {
    return { ok: false, error: 'email_format' };
  }
  return { ok: true, email: normalized };
}

export type PasswordValidation =
  | { ok: true }
  | {
      ok: false;
      error: 'password_too_short' | 'password_too_long' | 'password_weak';
    };

/**
 * Strength rules — deliberately conservative for admin accounts:
 *   - 12-128 chars
 *   - Must contain at least one lowercase, one uppercase, one digit
 *
 * Symbol requirement intentionally omitted (NIST 800-63B guidance
 * — length matters more than composition). Long passphrases pass.
 */
export function validateAdminPassword(raw: string): PasswordValidation {
  if (typeof raw !== 'string' || raw.length < PASSWORD_MIN) {
    return { ok: false, error: 'password_too_short' };
  }
  if (raw.length > PASSWORD_MAX) {
    return { ok: false, error: 'password_too_long' };
  }
  const hasLower = /[a-z]/.test(raw);
  const hasUpper = /[A-Z]/.test(raw);
  const hasDigit = /\d/.test(raw);
  if (!hasLower || !hasUpper || !hasDigit) {
    return { ok: false, error: 'password_weak' };
  }
  return { ok: true };
}

export async function hashAdminPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyAdminPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  if (typeof plain !== 'string' || typeof hash !== 'string') return false;
  if (plain.length === 0 || hash.length === 0) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch (err) {
    console.error('[admin-credentials] bcrypt compare threw', err);
    return false;
  }
}

// --------------------------------------------------------------
// Session token helpers
// --------------------------------------------------------------

/**
 * Mint a 256-bit random session token. The raw token goes into
 * the cookie ONCE; the DB stores only sha256(token). Lookups
 * compare hashes (timing-safe) so a DB read never leaks the
 * raw secret.
 */
export function mintSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = sessionTokenHash(token);
  return { token, hash };
}

export function sessionTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// --------------------------------------------------------------
// Combined create-input pre-validation (used by queries.ts to
// enforce email + password + full_name strength BEFORE bcrypt).
// PR #88 round-1 P2 fix: createAdminUserWithPassword previously
// hashed any string a caller handed in; now the pure validator
// gates the whole helper.
// --------------------------------------------------------------

const FULL_NAME_MIN = 2;
const FULL_NAME_MAX = 120;

export type CreateInputValidation =
  | {
      ok: true;
      email: string;
      full_name: string;
    }
  | {
      ok: false;
      error:
        | 'email_empty'
        | 'email_format'
        | 'email_too_long'
        | 'password_too_short'
        | 'password_too_long'
        | 'password_weak'
        | 'full_name_too_short'
        | 'full_name_too_long';
    };

export function validateAdminUserCreateInput(input: {
  email: string;
  password: string;
  full_name: string;
}): CreateInputValidation {
  const emailV = validateAdminEmail(input.email);
  if (!emailV.ok) return { ok: false, error: emailV.error };

  const passwordV = validateAdminPassword(input.password);
  if (!passwordV.ok) return { ok: false, error: passwordV.error };

  const trimmed = (input.full_name ?? '').trim();
  if (trimmed.length < FULL_NAME_MIN) {
    return { ok: false, error: 'full_name_too_short' };
  }
  if (trimmed.length > FULL_NAME_MAX) {
    return { ok: false, error: 'full_name_too_long' };
  }

  return { ok: true, email: emailV.email, full_name: trimmed };
}

const HEX_RE = /^[0-9a-fA-F]+$/;

export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  // Buffer.from(..., 'hex') silently TRUNCATES non-hex chars
  // (returns a zero-length buffer for entirely invalid input),
  // which would make timingSafeEqual('zzzz', 'zzzz') return true.
  // Reject anything that isn't strictly hex up-front.
  if (!HEX_RE.test(a) || !HEX_RE.test(b)) return false;
  try {
    const ab = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}
