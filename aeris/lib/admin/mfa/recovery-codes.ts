import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * MFA recovery codes — pure helpers.
 *
 * 10 codes per enrollment. Each code is a 12-character
 * crockford-base32 string in 3 groups of 4 (e.g. "ABCD-EFGH-JKLM")
 * for readability. ~60 bits of entropy per code — well above
 * the practical brute-force ceiling for an authenticated
 * endpoint that records every attempt against the rate-limit
 * ledger.
 *
 * The CALLER persists `sha256(raw_code)` to admin_mfa_recovery_codes
 * with consumed_at NULL; the raw code is shown to the admin
 * ONCE at enrollment and never persisted.
 *
 * Consumption flow (PR-3b):
 *   1. Admin enters a code at the MFA challenge page.
 *   2. Server hashes the canonicalized input.
 *   3. Server SELECTs the row with that hash AND consumed_at IS NULL.
 *   4. On hit: UPDATE consumed_at = NOW() + log session_id.
 *   5. On miss: rate-limit penalty + same generic error.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // crockford-style
// 12 chars × log2(32) = 60 bits, formatted as 4-4-4.
const CODE_CHARS = 12;
export const RECOVERY_CODE_COUNT = 10;

function mintCode(): string {
  // 9 bytes = 72 bits → 12 base32 chars after truncation.
  const bytes = randomBytes(9);
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length && out.length < CODE_CHARS; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5 && out.length < CODE_CHARS) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  // Format ABCD-EFGH-JKLM.
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export function mintRecoveryCodes(
  count: number = RECOVERY_CODE_COUNT
): string[] {
  // Generate + de-dup defensively (the entropy makes a collision
  // astronomically unlikely, but stripping defensively guards
  // against a future RNG-degraded environment).
  const seen = new Set<string>();
  while (seen.size < count) {
    seen.add(mintCode());
  }
  return Array.from(seen);
}

/** Canonicalize a code: uppercase, strip dashes/spaces, trim. */
export function canonicalizeRecoveryCode(input: string): string {
  if (typeof input !== 'string') return '';
  return input.trim().toUpperCase().replace(/[\s-]/g, '');
}

/** sha256 hex of the canonicalized code — what we persist. */
export function hashRecoveryCode(rawCode: string): string {
  const canonical = canonicalizeRecoveryCode(rawCode);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const HEX_RE = /^[a-f0-9]{64}$/;

export function constantTimeRecoveryCodeHashEqual(
  a: string,
  b: string
): boolean {
  if (!HEX_RE.test(a) || !HEX_RE.test(b)) return false;
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Format-check the raw input BEFORE hashing — saves a wasted DB
 * lookup on obviously-malformed submissions (e.g. someone pasted
 * a TOTP 6-digit code by mistake). The canonical form is 12
 * characters of the recovery alphabet.
 */
export function isWellFormedRawRecoveryCode(input: string): boolean {
  const canonical = canonicalizeRecoveryCode(input);
  if (canonical.length !== CODE_CHARS) return false;
  for (const ch of canonical) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}
