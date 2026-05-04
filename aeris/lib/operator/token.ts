import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Phase 4 operator dispatch token.
 *
 * URL shape:  /operator/offer/<token>
 * Wire shape: base64url(payload).base64url(signature)
 *
 * - The whole token is URL-safe (base64url has no `/`, `+`, or `=`).
 * - HMAC-SHA256 with `OPERATOR_TOKEN_SECRET`.
 * - Bound to one `trip_request_id` and one nonce; the trip row's
 *   `dispatch_nonce` is what makes re-dispatch invalidate older
 *   tokens. The HMAC alone is necessary but not sufficient; the
 *   `submit_phase4_operator_offer` RPC re-checks the nonce inside a
 *   `FOR UPDATE` lock.
 */

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 72 * 60 * 60;
const NONCE_BYTES = 16;

export class OperatorTokenEnvError extends Error {
  constructor() {
    super('Operator token env misconfigured: OPERATOR_TOKEN_SECRET is missing or empty');
    this.name = 'OperatorTokenEnvError';
  }
}

function requireSecret(): string {
  const secret = process.env.OPERATOR_TOKEN_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new OperatorTokenEnvError();
  }
  return secret;
}

export interface OperatorTokenPayload {
  v: number;
  trip_request_id: string;
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

function base64urlDecodeToBuffer(input: string): Buffer {
  // base64 alphabet: tolerate missing padding.
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(normalized + '='.repeat(pad), 'base64');
}

function sign(payload: string, secret: string): string {
  return base64urlEncode(createHmac('sha256', secret).update(payload).digest());
}

export interface IssueOperatorTokenOptions {
  tripRequestId: string;
  ttlSeconds?: number;
}

export interface IssuedOperatorToken {
  token: string;
  payload: OperatorTokenPayload;
}

export function issueOperatorToken({
  tripRequestId,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}: IssueOperatorTokenOptions): IssuedOperatorToken {
  const secret = requireSecret();

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: OperatorTokenPayload = {
    v: TOKEN_VERSION,
    trip_request_id: tripRequestId,
    issued_at: issuedAt,
    expires_at: issuedAt + ttlSeconds,
    nonce: randomBytes(NONCE_BYTES).toString('hex'),
  };

  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return {
    token: `${encodedPayload}.${signature}`,
    payload,
  };
}

export type VerifyOperatorTokenResult =
  | { valid: true; payload: OperatorTokenPayload }
  | { valid: false };

export function verifyOperatorToken(
  rawToken: string | undefined
): VerifyOperatorTokenResult {
  if (!rawToken) return { valid: false };

  const parts = rawToken.split('.');
  if (parts.length !== 2) return { valid: false };
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return { valid: false };

  let secret: string;
  try {
    secret = requireSecret();
  } catch {
    return { valid: false };
  }

  // Constant-time signature comparison.
  const expectedSig = sign(encodedPayload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return { valid: false };
  if (!timingSafeEqual(a, b)) return { valid: false };

  // Decode + parse payload.
  let parsed: unknown;
  try {
    const decoded = base64urlDecodeToBuffer(encodedPayload).toString('utf8');
    parsed = JSON.parse(decoded);
  } catch {
    return { valid: false };
  }

  if (!isOperatorTokenPayload(parsed)) {
    return { valid: false };
  }

  // Expiry check (the RPC re-checks against trip_requests.dispatch_*).
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.expires_at <= nowSeconds) {
    return { valid: false };
  }

  return { valid: true, payload: parsed };
}

function isOperatorTokenPayload(value: unknown): value is OperatorTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.v === 'number' &&
    v.v === TOKEN_VERSION &&
    typeof v.trip_request_id === 'string' &&
    v.trip_request_id.length > 0 &&
    typeof v.issued_at === 'number' &&
    Number.isFinite(v.issued_at) &&
    typeof v.expires_at === 'number' &&
    Number.isFinite(v.expires_at) &&
    typeof v.nonce === 'string' &&
    v.nonce.length > 0
  );
}
