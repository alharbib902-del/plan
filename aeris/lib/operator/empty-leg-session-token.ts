import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Phase 7 PR 2c — operator-side session token for the
 * Empty Legs self-serve portal.
 *
 * URL shape:  /operator/empty-legs/<token>
 * Wire shape: base64url(payload).base64url(signature)
 *
 * Payload (v=1):
 *   { v: 1, operator_stub_id, issued_at, expires_at }
 *
 * Codex iteration-12 P1 #2 fix: payload field is named
 * `operator_stub_id` (not `operator_id`) so the FK target
 * is unambiguous — Phase 7 never writes into the real
 * `operators` table; the session is bound to a row in
 * `phase7_operator_stubs`.
 *
 * Separate secret (`EMPTY_LEGS_OPERATOR_TOKEN_SECRET`)
 * mirrors Phase 6.2's customer-checkout-secret discipline:
 * each surface has its own rotation lifecycle so a leak
 * blast radius is contained.
 *
 * This is the Layer-1 (HMAC + payload exp) verifier. The
 * Layer-2 (DB hash match) and Layer-3 (DB row expiry)
 * checks live in `empty-leg-session-store.ts`.
 */

const TOKEN_VERSION = 1;
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export class EmptyLegSessionTokenEnvError extends Error {
  constructor() {
    super(
      'EMPTY_LEGS_OPERATOR_TOKEN_SECRET is missing or empty'
    );
    this.name = 'EmptyLegSessionTokenEnvError';
  }
}

function requireSecret(): string {
  const secret = process.env.EMPTY_LEGS_OPERATOR_TOKEN_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new EmptyLegSessionTokenEnvError();
  }
  return secret;
}

// ============================================================
// Payload type
// ============================================================

export interface EmptyLegSessionTokenPayload {
  v: 1;
  operator_stub_id: string;
  issued_at: number;
  expires_at: number;
}

// ============================================================
// base64url + HMAC helpers
// ============================================================

function base64urlEncode(input: Buffer | string): string {
  const buf =
    typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecodeToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad =
    normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(normalized + '='.repeat(pad), 'base64');
}

function sign(payload: string, secret: string): string {
  return base64urlEncode(
    createHmac('sha256', secret).update(payload).digest()
  );
}

// ============================================================
// SHA256 hash for the DB-side Layer-2 check.
//
// `operator_empty_leg_sessions.token_hash` stores the hex
// digest of the raw token (the same wire string the
// operator URL carries). The admin sees the raw token
// once at mint time; the DB never persists the raw value.
// ============================================================

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// ============================================================
// Mint
// ============================================================

export interface MintEmptyLegSessionTokenOptions {
  operatorStubId: string;
  ttlSeconds?: number;
}

export interface MintedEmptyLegSessionToken {
  token: string;
  payload: EmptyLegSessionTokenPayload;
}

export function mintEmptyLegSessionToken({
  operatorStubId,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}: MintEmptyLegSessionTokenOptions): MintedEmptyLegSessionToken {
  const secret = requireSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: EmptyLegSessionTokenPayload = {
    v: TOKEN_VERSION,
    operator_stub_id: operatorStubId,
    issued_at: issuedAt,
    expires_at: issuedAt + ttlSeconds,
  };
  const encoded = base64urlEncode(JSON.stringify(payload));
  const signature = sign(encoded, secret);
  return { token: `${encoded}.${signature}`, payload };
}

// ============================================================
// Verify (Layer 1 only — HMAC + payload exp)
// ============================================================

export type VerifyEmptyLegSessionTokenResult =
  | { valid: true; payload: EmptyLegSessionTokenPayload }
  | { valid: false };

export function verifyEmptyLegSessionToken(
  rawToken: string | undefined
): VerifyEmptyLegSessionTokenResult {
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
    const decoded = base64urlDecodeToBuffer(encodedPayload).toString(
      'utf8'
    );
    parsed = JSON.parse(decoded);
  } catch {
    return { valid: false };
  }

  if (!isV1Payload(parsed)) return { valid: false };

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.expires_at <= nowSeconds) return { valid: false };

  return { valid: true, payload: parsed };
}

function isV1Payload(value: unknown): value is EmptyLegSessionTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === TOKEN_VERSION &&
    typeof v.operator_stub_id === 'string' &&
    v.operator_stub_id.length > 0 &&
    typeof v.issued_at === 'number' &&
    Number.isFinite(v.issued_at) &&
    typeof v.expires_at === 'number' &&
    Number.isFinite(v.expires_at)
  );
}
