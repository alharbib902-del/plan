// Server-side ONLY. Module reads
// `EMPTY_LEGS_RESERVATION_TOKEN_SECRET` from `process.env`,
// so importing this from a client component would either
// crash or leak the secret at build time. The Next.js
// `'server-only'` import normally enforces this, but the
// PR 2d Layer-1 test (`test:empty-legs-token`) runs under
// tsx outside the Next.js bundler and cannot resolve that
// shim — keeping the import would break the test. The
// surface contract is enforced at the call-site level:
// every consumer is a Server Action or page module under
// `app/`.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Phase 7 PR 2d — public reservation token for the Empty
 * Legs marketplace.
 *
 * URL shape:  /empty-legs/<leg_number>/reserved?token=<...>
 * Wire shape: base64url(payload).base64url(signature)
 *
 * Payload (v=1):
 *   { v: 1, leg_id, issued_at, expires_at, nonce }
 *
 * 10-minute TTL. Bound to one leg row. The DB-side counterpart
 * is `empty_legs.reservation_token_hash` — set by
 * `reserve_empty_leg` to `sha256(rawToken)`. The customer's
 * "cancel my reservation" Server Action SHA256-hashes the
 * token before calling `release_empty_leg_reservation`
 * (Codex iteration-1 P1 #3 contract).
 *
 * Separate secret (`EMPTY_LEGS_RESERVATION_TOKEN_SECRET`)
 * mirrors Phase 6.2's customer-checkout-secret discipline:
 * each surface has its own rotation lifecycle so a leak
 * blast radius is contained.
 *
 * Module is fail-closed: missing/empty secret → mint throws,
 * verify returns `{ valid: false }`. Callers must surface
 * the failure as a structured error rather than a 5xx leak.
 */

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 10 * 60; // 10 minutes
const NONCE_BYTES = 16;

export class ReservationTokenEnvError extends Error {
  constructor() {
    super('EMPTY_LEGS_RESERVATION_TOKEN_SECRET is missing or empty');
    this.name = 'ReservationTokenEnvError';
  }
}

function requireSecret(): string {
  const secret = process.env.EMPTY_LEGS_RESERVATION_TOKEN_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new ReservationTokenEnvError();
  }
  return secret;
}

// ============================================================
// Payload
// ============================================================

export interface ReservationTokenPayload {
  v: 1;
  leg_id: string;
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

function base64urlDecodeToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(normalized + '='.repeat(pad), 'base64');
}

function sign(payload: string, secret: string): string {
  return base64urlEncode(createHmac('sha256', secret).update(payload).digest());
}

// ============================================================
// SHA256 hash for the DB-side reservation_token_hash. Matches
// the wire format that `reserve_empty_leg` stores.
// ============================================================

export function hashReservationToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// ============================================================
// Mint
// ============================================================

export interface MintReservationTokenOptions {
  legId: string;
  ttlSeconds?: number;
}

export interface MintedReservationToken {
  token: string;
  payload: ReservationTokenPayload;
}

export function mintReservationToken({
  legId,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}: MintReservationTokenOptions): MintedReservationToken {
  const secret = requireSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: ReservationTokenPayload = {
    v: TOKEN_VERSION,
    leg_id: legId,
    issued_at: issuedAt,
    expires_at: issuedAt + ttlSeconds,
    nonce: randomBytes(NONCE_BYTES).toString('hex'),
  };
  const encoded = base64urlEncode(JSON.stringify(payload));
  const signature = sign(encoded, secret);
  return { token: `${encoded}.${signature}`, payload };
}

// ============================================================
// Verify (Layer 1 — HMAC + payload exp)
// ============================================================

export type VerifyReservationTokenResult =
  | { valid: true; payload: ReservationTokenPayload }
  | { valid: false };

export function verifyReservationToken(
  rawToken: string | undefined
): VerifyReservationTokenResult {
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

  const expectedSig = sign(encodedPayload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return { valid: false };
  if (!timingSafeEqual(a, b)) return { valid: false };

  let parsed: unknown;
  try {
    const decoded = base64urlDecodeToBuffer(encodedPayload).toString('utf8');
    parsed = JSON.parse(decoded);
  } catch {
    return { valid: false };
  }

  if (!isV1Payload(parsed)) return { valid: false };

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.expires_at <= nowSeconds) return { valid: false };

  return { valid: true, payload: parsed };
}

function isV1Payload(value: unknown): value is ReservationTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === TOKEN_VERSION &&
    typeof v.leg_id === 'string' &&
    v.leg_id.length > 0 &&
    typeof v.issued_at === 'number' &&
    Number.isFinite(v.issued_at) &&
    typeof v.expires_at === 'number' &&
    Number.isFinite(v.expires_at) &&
    typeof v.nonce === 'string' &&
    v.nonce.length > 0
  );
}
