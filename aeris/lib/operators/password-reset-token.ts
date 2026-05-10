// Server-side ONLY. Module reads
// `OPERATOR_PASSWORD_RESET_TOKEN_SECRET` from `process.env`.
// Same posture as `lib/operators/welcome-token.ts`.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Phase 8 PR 2c — operator password-reset token.
 *
 * URL shape:  /operator/reset-password/<token>
 * Wire shape: base64url(payload).base64url(signature)
 *
 * Payload (v=1):
 *   { v: 1, operator_id, issued_at, expires_at, nonce }
 *
 * 30-minute TTL. Single-use (DB-side guard via
 * `operator_password_reset_tokens.used_at`). The DB-side
 * counterpart is the row inserted by
 * `mint_operator_password_reset_token`'s
 * `token_hash = sha256(rawToken)`.
 *
 * Separate secret (`OPERATOR_PASSWORD_RESET_TOKEN_SECRET`)
 * mirrors the Phase 7 token-secret discipline. Module is
 * fail-closed: missing/empty secret → mint throws, verify
 * returns `{ valid: false, reason: 'env_missing' }`.
 */

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 30 * 60; // 30 minutes
const NONCE_BYTES = 16;

export class PasswordResetTokenEnvError extends Error {
  constructor() {
    super('OPERATOR_PASSWORD_RESET_TOKEN_SECRET is missing or empty');
    this.name = 'PasswordResetTokenEnvError';
  }
}

function requireSecret(): string {
  const secret = process.env.OPERATOR_PASSWORD_RESET_TOKEN_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new PasswordResetTokenEnvError();
  }
  return secret;
}

export interface PasswordResetTokenPayload {
  v: 1;
  operator_id: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
}

function base64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

function sign(payload: string, secret: string): string {
  return base64urlEncode(
    createHmac('sha256', secret).update(payload).digest()
  );
}

export interface MintPasswordResetTokenInput {
  operator_id: string;
  ttl_seconds?: number;
}

export interface MintPasswordResetTokenResult {
  raw_token: string;
  token_hash: string;
  expires_at: Date;
}

export function mintPasswordResetToken(
  input: MintPasswordResetTokenInput
): MintPasswordResetTokenResult {
  const secret = requireSecret();
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttl_seconds ?? DEFAULT_TTL_SECONDS;

  const payload: PasswordResetTokenPayload = {
    v: TOKEN_VERSION,
    operator_id: input.operator_id,
    issued_at: now,
    expires_at: now + ttl,
    nonce: randomBytes(NONCE_BYTES).toString('hex'),
  };

  const payloadEnc = base64urlEncode(JSON.stringify(payload));
  const signature = sign(payloadEnc, secret);
  const rawToken = `${payloadEnc}.${signature}`;
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  return {
    raw_token: rawToken,
    token_hash: tokenHash,
    expires_at: new Date(payload.expires_at * 1000),
  };
}

export type VerifyPasswordResetTokenResult =
  | { valid: true; payload: PasswordResetTokenPayload; token_hash: string }
  | { valid: false; reason: VerifyPasswordResetTokenFailure };

export type VerifyPasswordResetTokenFailure =
  | 'env_missing'
  | 'malformed'
  | 'signature_mismatch'
  | 'unsupported_version'
  | 'expired';

export function verifyPasswordResetToken(
  rawToken: string
): VerifyPasswordResetTokenResult {
  let secret: string;
  try {
    secret = requireSecret();
  } catch {
    return { valid: false, reason: 'env_missing' };
  }

  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    return { valid: false, reason: 'malformed' };
  }

  const parts = rawToken.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };
  const [payloadEnc, signature] = parts;

  const expected = sign(payloadEnc, secret);
  let signatureMatches = false;
  try {
    const expectedBuf = base64urlDecode(expected);
    const actualBuf = base64urlDecode(signature);
    signatureMatches =
      expectedBuf.length === actualBuf.length &&
      timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (!signatureMatches) return { valid: false, reason: 'signature_mismatch' };

  let payload: PasswordResetTokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadEnc).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (payload.v !== TOKEN_VERSION) {
    return { valid: false, reason: 'unsupported_version' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.expires_at !== 'number' || payload.expires_at <= now) {
    return { valid: false, reason: 'expired' };
  }

  if (typeof payload.operator_id !== 'string' || payload.operator_id.length === 0) {
    return { valid: false, reason: 'malformed' };
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  return { valid: true, payload, token_hash: tokenHash };
}
