// Server-side ONLY. Module reads
// `CLIENT_PASSWORD_RESET_TOKEN_SECRET` from `process.env`.
// Mirror of `lib/operators/password-reset-token.ts`.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Phase 9 PR 1 — client password-reset token.
 *
 * URL shape:  /reset-password/<token>
 * Wire shape: base64url(payload).base64url(signature)
 *
 * Payload (v=1):
 *   { v: 1, client_id, issued_at, expires_at, nonce }
 *
 * 30-minute TTL. Single-use (DB-side guard via
 * `client_password_reset_tokens.used_at`). Separate secret
 * `CLIENT_PASSWORD_RESET_TOKEN_SECRET` (NOT shared with the
 * operator counterpart — distinct populations, distinct
 * blast radius if one secret leaks).
 */

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 30 * 60;
const NONCE_BYTES = 16;

export class ClientPasswordResetTokenEnvError extends Error {
  constructor() {
    super('CLIENT_PASSWORD_RESET_TOKEN_SECRET is missing or empty');
    this.name = 'ClientPasswordResetTokenEnvError';
  }
}

function requireSecret(): string {
  const secret = process.env.CLIENT_PASSWORD_RESET_TOKEN_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new ClientPasswordResetTokenEnvError();
  }
  return secret;
}

export interface ClientPasswordResetTokenPayload {
  v: 1;
  client_id: string;
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

export interface MintClientPasswordResetTokenInput {
  client_id: string;
  ttl_seconds?: number;
}

export interface MintClientPasswordResetTokenResult {
  raw_token: string;
  token_hash: string;
  expires_at: Date;
}

export function mintClientPasswordResetToken(
  input: MintClientPasswordResetTokenInput
): MintClientPasswordResetTokenResult {
  const secret = requireSecret();
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttl_seconds ?? DEFAULT_TTL_SECONDS;

  const payload: ClientPasswordResetTokenPayload = {
    v: TOKEN_VERSION,
    client_id: input.client_id,
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

export type VerifyClientPasswordResetTokenResult =
  | {
      valid: true;
      payload: ClientPasswordResetTokenPayload;
      token_hash: string;
    }
  | { valid: false; reason: VerifyClientPasswordResetTokenFailure };

export type VerifyClientPasswordResetTokenFailure =
  | 'env_missing'
  | 'malformed'
  | 'signature_mismatch'
  | 'unsupported_version'
  | 'expired';

export function verifyClientPasswordResetToken(
  rawToken: string
): VerifyClientPasswordResetTokenResult {
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

  let payload: ClientPasswordResetTokenPayload;
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

  if (typeof payload.client_id !== 'string' || payload.client_id.length === 0) {
    return { valid: false, reason: 'malformed' };
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  return { valid: true, payload, token_hash: tokenHash };
}
