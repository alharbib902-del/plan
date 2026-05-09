// Server-side ONLY. Module reads
// `OPERATOR_WELCOME_TOKEN_SECRET` from `process.env`,
// so importing this from a client component would either
// crash or leak the secret at build time. The Next.js
// `'server-only'` import normally enforces this, but token
// modules in this codebase intentionally avoid it so the
// shared test runner (tsx) can resolve them outside the
// Next.js bundler. The surface contract is enforced at
// the call-site level: every consumer is a Server Action
// or page module under `app/`.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Phase 8 PR 2b — admin-approval welcome token.
 *
 * URL shape:  /operator/welcome/<token>
 * Wire shape: base64url(payload).base64url(signature)
 *
 * Payload (v=1):
 *   { v: 1, operator_id, issued_at, expires_at, nonce }
 *
 * 7-day TTL. Bound to one operator row. The DB-side
 * counterpart is `operators.welcome_token_hash` — set by
 * `admin_approve_operator` to `sha256(rawToken)`. The
 * `consume_operator_welcome_token` RPC SHA256-hashes the
 * token before lookup.
 *
 * Separate secret (`OPERATOR_WELCOME_TOKEN_SECRET`) mirrors
 * the Phase 7 token-secret discipline: each surface has its
 * own rotation lifecycle so a leak blast radius is contained.
 *
 * Module is fail-closed: missing/empty secret → mint throws,
 * verify returns `{ valid: false }`. Callers must surface
 * the failure as a structured error rather than a 5xx leak.
 */

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const NONCE_BYTES = 16;

export class WelcomeTokenEnvError extends Error {
  constructor() {
    super('OPERATOR_WELCOME_TOKEN_SECRET is missing or empty');
    this.name = 'WelcomeTokenEnvError';
  }
}

function requireSecret(): string {
  const secret = process.env.OPERATOR_WELCOME_TOKEN_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new WelcomeTokenEnvError();
  }
  return secret;
}

// ============================================================
// Payload
// ============================================================

export interface WelcomeTokenPayload {
  v: 1;
  operator_id: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
}

// ============================================================
// base64url + HMAC helpers
// ============================================================

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

// ============================================================
// Mint
// ============================================================

export interface MintWelcomeTokenInput {
  operator_id: string;
  ttl_seconds?: number;
}

export interface MintWelcomeTokenResult {
  raw_token: string;
  token_hash: string;
  expires_at: Date;
}

/**
 * Mint a welcome token bound to the supplied operator.
 *
 * Returns BOTH the raw token (for the email body URL) AND
 * the sha256 hex hash (for `admin_approve_operator`'s
 * `p_welcome_token_hash` argument). The raw token never
 * touches the DB.
 */
export function mintWelcomeToken(
  input: MintWelcomeTokenInput
): MintWelcomeTokenResult {
  const secret = requireSecret();
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttl_seconds ?? DEFAULT_TTL_SECONDS;

  const payload: WelcomeTokenPayload = {
    v: TOKEN_VERSION,
    operator_id: input.operator_id,
    issued_at: now,
    expires_at: now + ttl,
    nonce: randomBytes(NONCE_BYTES).toString('hex'),
  };

  const payloadJson = JSON.stringify(payload);
  const payloadEnc = base64urlEncode(payloadJson);
  const signature = sign(payloadEnc, secret);
  const rawToken = `${payloadEnc}.${signature}`;
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  return {
    raw_token: rawToken,
    token_hash: tokenHash,
    expires_at: new Date(payload.expires_at * 1000),
  };
}

// ============================================================
// Verify
// ============================================================

export type VerifyWelcomeTokenResult =
  | { valid: true; payload: WelcomeTokenPayload; token_hash: string }
  | { valid: false; reason: VerifyWelcomeTokenFailure };

export type VerifyWelcomeTokenFailure =
  | 'env_missing'
  | 'malformed'
  | 'signature_mismatch'
  | 'unsupported_version'
  | 'expired';

/**
 * Verify a raw welcome token. Returns the payload + the
 * sha256 hex hash (so the caller can pass the same hash to
 * `consume_operator_welcome_token`'s `p_token_hash` arg).
 *
 * Fail-closed semantics: any signature mismatch / expiry /
 * malformed payload returns `{ valid: false }` with a
 * structured reason. Never throws.
 */
export function verifyWelcomeToken(
  rawToken: string
): VerifyWelcomeTokenResult {
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
  if (parts.length !== 2) {
    return { valid: false, reason: 'malformed' };
  }
  const [payloadEnc, signature] = parts;

  // Constant-time signature compare.
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
  if (!signatureMatches) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  // Decode payload.
  let payload: WelcomeTokenPayload;
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

  if (
    typeof payload.operator_id !== 'string' ||
    payload.operator_id.length === 0
  ) {
    return { valid: false, reason: 'malformed' };
  }

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  return { valid: true, payload, token_hash: tokenHash };
}
