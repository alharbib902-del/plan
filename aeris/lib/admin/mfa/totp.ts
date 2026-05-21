import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * RFC 6238 TOTP (Time-Based One-Time Password) — pure helpers.
 *
 * No DB, no env, no 'server-only' — testable end-to-end. The
 * server binding in queries.ts handles persistence + actor
 * resolution.
 *
 * Constants:
 *   - 30-second time step (RFC 6238 §5.1, also what Google
 *     Authenticator / Authy / 1Password emit by default).
 *   - 6-digit OTP (mod 10^6).
 *   - SHA-1 HMAC (RFC 6238 default; widely supported by every
 *     authenticator app. SHA-256/512 require the otpauth URL
 *     `algorithm=` query and many apps still don't honor it).
 *   - Verification window: current step ± 1 (90-second total
 *     window centered on now) so a code that crosses a step
 *     boundary still verifies. Larger windows accept more
 *     replay risk; smaller windows reject legitimate codes
 *     entered slightly late.
 *
 * What this file deliberately does NOT do:
 *   - Used-code tracking. TOTP itself does not prevent reuse
 *     within the same step; the caller (queries.ts) is expected
 *     to update last_used_at + reject if last_used_at >= step
 *     start (covers the same-step-replay attack).
 *   - QR / otpauth URL formatting beyond `buildOtpAuthUrl` —
 *     the actual QR rendering is a UI concern.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ALGORITHM = 'sha1';
export const TOTP_WINDOW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// --------------------------------------------------------------
// Base32 — RFC 4648 (no padding)
// --------------------------------------------------------------

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(input: string): Buffer | null {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '');
  if (cleaned.length === 0) return null;
  if (!/^[A-Z2-7]+$/.test(cleaned)) return null;

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// --------------------------------------------------------------
// Secret mint
// --------------------------------------------------------------

/**
 * Generate a fresh 20-byte (160-bit) TOTP secret encoded as
 * 32-char base32. 160 bits is the RFC 6238 §5.1 recommendation
 * for SHA-1 TOTP.
 */
export function mintTotpSecret(): {
  raw: Buffer;
  base32: string;
} {
  const raw = randomBytes(20);
  return { raw, base32: base32Encode(raw) };
}

// --------------------------------------------------------------
// HOTP / TOTP core
// --------------------------------------------------------------

function counterBuffer(counter: number): Buffer {
  // 8-byte big-endian counter per RFC 4226.
  const buf = Buffer.alloc(8);
  // JS numbers are 53-bit safe — the TOTP counter for the next
  // ~250 millennia comfortably fits.
  const high = Math.floor(counter / 0x100000000);
  const low = counter % 0x100000000;
  buf.writeUInt32BE(high, 0);
  buf.writeUInt32BE(low, 4);
  return buf;
}

function hotp(secret: Buffer, counter: number): string {
  const hmac = createHmac(TOTP_ALGORITHM, secret);
  hmac.update(counterBuffer(counter));
  const digest = hmac.digest();
  // Dynamic truncation per RFC 4226 §5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const mod = 10 ** TOTP_DIGITS;
  const code = (binary % mod).toString();
  return code.padStart(TOTP_DIGITS, '0');
}

export function counterForTimestamp(unixSeconds: number): number {
  return Math.floor(unixSeconds / TOTP_STEP_SECONDS);
}

export function generateTotp(args: {
  secretBase32: string;
  nowSeconds?: number;
}): string | null {
  const secret = base32Decode(args.secretBase32);
  if (!secret) return null;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  return hotp(secret, counterForTimestamp(now));
}

// --------------------------------------------------------------
// Verification with ±N step window
// --------------------------------------------------------------

export type VerifyTotpResult =
  | { ok: true; matched_step: number }
  | { ok: false; reason: 'malformed' | 'mismatch' };

/**
 * Constant-time compare across the verification window. Returns
 * the matched step (Unix-step counter value) on success so the
 * caller can update last_used_at to prevent same-step replay.
 */
export function verifyTotp(args: {
  candidate: string;
  secretBase32: string;
  nowSeconds?: number;
  windowSteps?: number;
}): VerifyTotpResult {
  const candidate = (args.candidate ?? '').trim();
  if (!/^\d{6}$/.test(candidate)) {
    return { ok: false, reason: 'malformed' };
  }

  const secret = base32Decode(args.secretBase32);
  if (!secret) return { ok: false, reason: 'malformed' };

  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const center = counterForTimestamp(now);
  const window =
    typeof args.windowSteps === 'number' && args.windowSteps >= 0
      ? args.windowSteps
      : TOTP_WINDOW_STEPS;

  for (let delta = -window; delta <= window; delta++) {
    const expected = hotp(secret, center + delta);
    if (constantTimeStringEqual(candidate, expected)) {
      return { ok: true, matched_step: center + delta };
    }
  }
  return { ok: false, reason: 'mismatch' };
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// --------------------------------------------------------------
// otpauth URL (the string a QR code encodes)
// --------------------------------------------------------------

/**
 * RFC 6238 otpauth:// URL. Authenticator apps parse this when
 * the user scans the QR. `issuer` is the app/org name; `label`
 * is typically the admin's email so users can distinguish
 * multiple Aeris accounts.
 *
 * The secret_base32 must NOT contain padding (RFC 6238 §5.3
 * recommends no padding; most authenticator apps reject `=`).
 */
export function buildOtpAuthUrl(args: {
  issuer: string;
  label: string;
  secretBase32: string;
}): string {
  const issuer = encodeURIComponent(args.issuer.trim());
  const label = encodeURIComponent(args.label.trim());
  const secret = args.secretBase32.replace(/=+$/, '');
  return (
    `otpauth://totp/${issuer}:${label}` +
    `?secret=${secret}&issuer=${issuer}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`
  );
}
