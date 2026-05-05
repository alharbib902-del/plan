import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Aeris operator dispatch token.
 *
 * URL shape:  /operator/offer/<token>
 * Wire shape: base64url(payload).base64url(signature)
 *
 * Two payload versions coexist:
 *   - v=1 (Phase 4 — single-operator dispatch). Bound to one
 *     trip_request_id and one nonce. The trip row's
 *     `dispatch_nonce` is what makes re-dispatch invalidate
 *     older v=1 tokens.
 *   - v=2 (Phase 5 — multi-operator dispatch). Bound to one
 *     trip_request_id AND one dispatch_target_id (a row in
 *     `trip_dispatch_targets`) AND one per-target nonce. Re-
 *     dispatch closes the prior round and cancels its
 *     pending targets, which invalidates every v=2 token
 *     bound to that round.
 *
 * Both versions:
 *   - Use the same `OPERATOR_TOKEN_SECRET` for HMAC-SHA256
 *     signing.
 *   - Are URL-safe (base64url has no `/`, `+`, or `=`).
 *   - Are the necessary half of the auth check; the SQL RPCs
 *     re-verify state under FOR UPDATE before any DB write.
 */

const TOKEN_VERSION_V1 = 1;
const TOKEN_VERSION_V2 = 2;
const DEFAULT_TTL_SECONDS = 72 * 60 * 60;
const NONCE_BYTES = 16;

export class OperatorTokenEnvError extends Error {
  constructor() {
    super(
      'Operator token env misconfigured: OPERATOR_TOKEN_SECRET is missing or empty'
    );
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

// ============================================================================
// Payload types
// ============================================================================

export interface OperatorTokenV1Payload {
  v: 1;
  trip_request_id: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
}

export interface OperatorTokenV2Payload {
  v: 2;
  trip_request_id: string;
  dispatch_target_id: string;
  issued_at: number;
  expires_at: number;
  nonce: string;
}

/**
 * Backwards-compatibility alias: existing Phase 4 imports of
 * `OperatorTokenPayload` continue to resolve to the v=1 shape.
 * New code should import the version-specific names directly.
 */
export type OperatorTokenPayload = OperatorTokenV1Payload;

// ============================================================================
// base64url + HMAC helpers
// ============================================================================

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

function buildToken(payload: object, secret: string): string {
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

// ============================================================================
// v=1 issuance (Phase 4 — single-operator dispatch)
// ============================================================================

export interface IssueOperatorTokenOptions {
  tripRequestId: string;
  ttlSeconds?: number;
}

export interface IssuedOperatorToken {
  token: string;
  payload: OperatorTokenV1Payload;
}

export function issueOperatorToken({
  tripRequestId,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}: IssueOperatorTokenOptions): IssuedOperatorToken {
  const secret = requireSecret();

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: OperatorTokenV1Payload = {
    v: TOKEN_VERSION_V1,
    trip_request_id: tripRequestId,
    issued_at: issuedAt,
    expires_at: issuedAt + ttlSeconds,
    nonce: randomBytes(NONCE_BYTES).toString('hex'),
  };

  return {
    token: buildToken(payload, secret),
    payload,
  };
}

// ============================================================================
// v=2 issuance (Phase 5 — multi-operator dispatch)
// ============================================================================
//
// The Phase 5 dispatch Server Action pre-builds target_id, nonce, sent_at,
// and expires_at locally before calling open_phase5_dispatch_round. Those
// same values feed both the persisted target row AND the HMAC token. The
// rebuild path (issueOperatorTokenFromTarget) reads the persisted row and
// reproduces the same token byte-for-byte. (Spec iteration-3 P1 fix.)

export interface IssueOperatorTokenV2Options {
  tripRequestId: string;
  /** dispatch_target_id — the UUID the Server Action generates and persists. */
  targetId: string;
  /** 32-hex per-target nonce. */
  nonce: string;
  /**
   * Canonical issued_at AND persisted sent_at on the target row. Pass the
   * SAME Date instance that the Server Action will write into the RPC's
   * p_targets array; the byte-identical-rebuild contract depends on this.
   */
  sentAt: Date;
  /** Token / row expiry. */
  expiresAt: Date;
}

export interface IssuedOperatorTokenV2 {
  token: string;
  payload: OperatorTokenV2Payload;
}

export function issueOperatorTokenV2({
  tripRequestId,
  targetId,
  nonce,
  sentAt,
  expiresAt,
}: IssueOperatorTokenV2Options): IssuedOperatorTokenV2 {
  const secret = requireSecret();

  const payload: OperatorTokenV2Payload = {
    v: TOKEN_VERSION_V2,
    trip_request_id: tripRequestId,
    dispatch_target_id: targetId,
    issued_at: Math.floor(sentAt.getTime() / 1000),
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    nonce,
  };

  return {
    token: buildToken(payload, secret),
    payload,
  };
}

/**
 * Refresh-durability rebuild helper (spec acceptance #14a).
 *
 * Accepts a persisted `trip_dispatch_targets` row and reproduces the same
 * v=2 HMAC token that `issueOperatorTokenV2` emitted at dispatch time. This
 * is the function the trip detail page calls on every render to re-create
 * the N operator URLs without storing the token itself.
 *
 * Determinism: the token is a function of (trip_request_id,
 * dispatch_target_id, sent_at, expires_at, nonce, OPERATOR_TOKEN_SECRET).
 * Two calls with the same target row produce the same byte-identical
 * token, regardless of when they're called (within the target's TTL).
 *
 * The helper does NOT read `Date.now()`; `issued_at` is derived from the
 * row's `sent_at` exclusively.
 */
export function issueOperatorTokenFromTarget(target: {
  trip_request_id: string;
  /** dispatch_target_id from `trip_dispatch_targets.id`. */
  id: string;
  nonce: string;
  /** ISO-8601, exactly as persisted. */
  sent_at: string;
  /** ISO-8601, exactly as persisted. */
  expires_at: string;
}): IssuedOperatorTokenV2 {
  return issueOperatorTokenV2({
    tripRequestId: target.trip_request_id,
    targetId: target.id,
    nonce: target.nonce,
    sentAt: new Date(target.sent_at),
    expiresAt: new Date(target.expires_at),
  });
}

// ============================================================================
// Verification (single-pass, version-discriminated)
// ============================================================================

export type VerifyOperatorTokenResult =
  | { valid: true; version: 1; payload: OperatorTokenV1Payload }
  | { valid: true; version: 2; payload: OperatorTokenV2Payload }
  | { valid: false };

/**
 * Verify a token in a single pass:
 *   1. Split into encodedPayload + signature.
 *   2. Recompute HMAC over encodedPayload with OPERATOR_TOKEN_SECRET and
 *      timing-safe-compare against signature. (Same secret signs every
 *      version; the payload is an opaque base64url blob to HMAC.)
 *   3. Signature mismatch → {valid: false}. NO fallback, no retry against
 *      a different payload shape. (Spec iteration-2 P2 fix.)
 *   4. Decode + JSON-parse the payload.
 *   5. Branch by `payload.v`:
 *      - 1 → validate v=1 shape, return {valid:true, version:1, payload}
 *      - 2 → validate v=2 shape, return {valid:true, version:2, payload}
 *      - other (missing/unknown/future) → {valid: false}
 *   6. Final expiry guard: expires_at <= now → {valid: false}.
 *
 * The SQL RPCs re-check state under FOR UPDATE on submit, so this verifier
 * is necessary but never sufficient. The discriminated return shape lets
 * the page route dispatch to the correct submit RPC without re-decoding
 * the payload.
 */
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

  // Step 2-3: constant-time HMAC compare. No fallback.
  const expectedSig = sign(encodedPayload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return { valid: false };
  if (!timingSafeEqual(a, b)) return { valid: false };

  // Step 4: decode + parse payload.
  let parsed: unknown;
  try {
    const decoded = base64urlDecodeToBuffer(encodedPayload).toString('utf8');
    parsed = JSON.parse(decoded);
  } catch {
    return { valid: false };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { valid: false };
  }

  const v = (parsed as { v?: unknown }).v;
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Step 5-6: branch by v, validate shape, then expiry.
  if (v === TOKEN_VERSION_V1) {
    if (!isV1Payload(parsed)) return { valid: false };
    if (parsed.expires_at <= nowSeconds) return { valid: false };
    return { valid: true, version: 1, payload: parsed };
  }

  if (v === TOKEN_VERSION_V2) {
    if (!isV2Payload(parsed)) return { valid: false };
    if (parsed.expires_at <= nowSeconds) return { valid: false };
    return { valid: true, version: 2, payload: parsed };
  }

  // Unknown / missing / future v.
  return { valid: false };
}

function isV1Payload(value: unknown): value is OperatorTokenV1Payload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === TOKEN_VERSION_V1 &&
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

function isV2Payload(value: unknown): value is OperatorTokenV2Payload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === TOKEN_VERSION_V2 &&
    typeof v.trip_request_id === 'string' &&
    v.trip_request_id.length > 0 &&
    typeof v.dispatch_target_id === 'string' &&
    v.dispatch_target_id.length > 0 &&
    typeof v.issued_at === 'number' &&
    Number.isFinite(v.issued_at) &&
    typeof v.expires_at === 'number' &&
    Number.isFinite(v.expires_at) &&
    typeof v.nonce === 'string' &&
    v.nonce.length > 0
  );
}
