import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Aeris customer checkout-prep token (Phase 6.2).
 *
 * URL shape:  /booking/<token>/checkout-prep
 * Wire shape: base64url(payload).base64url(signature)
 *
 * Mirrors Phase 6.0's operator portal token regime
 * (`lib/operator/token.ts`) in shape:
 *   - HMAC-SHA256, base64url-encoded.
 *   - Payload is a JSON object with a `v` discriminator.
 *   - Single signed envelope; signature mismatch is the
 *     terminal rejection (no fallback decoding).
 *
 * Differences from the operator regime:
 *   - Separate secret (`CUSTOMER_CHECKOUT_SECRET`) so secret
 *     rotation independence: a leak of one does not invalidate
 *     the other (Codex iteration-2 Q4 fix on the spec).
 *   - Only v=2 is defined for customer tokens — there's no
 *     v=1 history to preserve here.
 *   - Payload is `{ v: 2, booking_id, exp }`. No nonce
 *     because the booking row's `checkout_token_hash` plays
 *     the rotation role (re-issuing a token writes a new
 *     hash; the old token's signature still verifies but the
 *     hash check fails — see the three-layer validation in
 *     S5 of the Phase 6.2 spec).
 *   - **Fail-closed posture** (Codex iteration-3 P1 #3 fix):
 *     - `mintCheckoutToken` THROWS when the secret env var
 *       is missing or empty. Caught by the admin Server
 *       Action; surfaces a "secret not set" config error to
 *       the founder UI, leaves the bookings row untouched.
 *     - `verifyCheckoutToken` RETURNS `null` (NOT throws)
 *       when the secret is missing. The customer page treats
 *       `null` identically to expired/invalid/hash-mismatch
 *       — same "expired or not-issued" surface, no 5xx
 *       leak, no stack trace, no failure-mode disclosure.
 *
 *   - The secret is read **lazily** on every call (NOT
 *     cached at module load) so a runtime env var change
 *     does not require a server restart.
 *
 * Phase 6.2 PR 1 ships this module + the admin-guarded +
 * feature-gated debug smoke route at
 * `/admin/(protected)/_debug/customer-token-smoke`. No
 * customer page consumes it yet (PR 2b is the consumer).
 */

const TOKEN_VERSION_V2 = 2;
const DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60;

export class CustomerTokenEnvError extends Error {
  constructor() {
    super(
      'Customer token env misconfigured: CUSTOMER_CHECKOUT_SECRET is missing or empty'
    );
    this.name = 'CustomerTokenEnvError';
  }
}

function readSecretOrNull(): string | null {
  const secret = process.env.CUSTOMER_CHECKOUT_SECRET;
  if (!secret || secret.trim().length === 0) return null;
  return secret;
}

function requireSecret(): string {
  const secret = readSecretOrNull();
  if (secret === null) throw new CustomerTokenEnvError();
  return secret;
}

// ============================================================================
// Payload type
// ============================================================================

export interface CustomerCheckoutTokenPayload {
  v: 2;
  /** UUID of the bookings row this token grants checkout-prep access to. */
  booking_id: string;
  /** Issuance time (unix seconds). */
  issued_at: number;
  /** Expiry (unix seconds). Verified against NOW() at every check. */
  exp: number;
}

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
// mint
// ============================================================================

export interface MintCheckoutTokenOptions {
  bookingId: string;
  /** Defaults to 14 days. Override for the smoke route's 60-second sentinel. */
  ttlSeconds?: number;
  /** Override `issued_at` for deterministic tests. Defaults to NOW. */
  issuedAt?: number;
}

export interface MintedCheckoutToken {
  token: string;
  payload: CustomerCheckoutTokenPayload;
}

/**
 * Mint a v=2 customer checkout token.
 *
 * Throws `CustomerTokenEnvError` when
 * `CUSTOMER_CHECKOUT_SECRET` is missing or empty (fail-
 * closed). The admin Server Action that calls this should
 * catch the error and surface a clear config-error message
 * to the founder UI; the bookings row's `checkout_token_*`
 * columns must stay NULL when minting fails.
 */
export function mintCheckoutToken({
  bookingId,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  issuedAt,
}: MintCheckoutTokenOptions): MintedCheckoutToken {
  const secret = requireSecret();

  const issued = issuedAt ?? Math.floor(Date.now() / 1000);
  const payload: CustomerCheckoutTokenPayload = {
    v: TOKEN_VERSION_V2,
    booking_id: bookingId,
    issued_at: issued,
    exp: issued + ttlSeconds,
  };

  return {
    token: buildToken(payload, secret),
    payload,
  };
}

// ============================================================================
// verify
// ============================================================================

/**
 * Verify a v=2 customer checkout token.
 *
 * Returns the decoded payload on success; returns `null` on:
 *   - Missing/empty secret (fail-closed; same surface as
 *     other failure modes by design — defense in depth, the
 *     customer cannot tell which check failed).
 *   - Malformed token shape (missing `.`, missing parts).
 *   - HMAC signature mismatch.
 *   - JSON parse failure on the payload.
 *   - `v` discriminator missing or != 2.
 *   - Payload shape mismatch.
 *   - `payload.exp <= NOW()` (signed expiry).
 *
 * NOTE: this is layer 1 of the three-layer token validation
 * the Phase 6.2 spec mandates (Codex iteration-4 P2 #3 fix).
 * Layers 2 + 3 (DB hash match + DB expiry) live in the
 * Server Actions / page lookup that call this function.
 */
export function verifyCheckoutToken(
  rawToken: string | undefined
): CustomerCheckoutTokenPayload | null {
  if (!rawToken) return null;

  const parts = rawToken.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return null;

  const secret = readSecretOrNull();
  if (secret === null) return null;

  // HMAC compare (constant-time).
  const expectedSig = sign(encodedPayload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  // Decode + parse payload.
  let parsed: unknown;
  try {
    const decoded = base64urlDecodeToBuffer(encodedPayload).toString('utf8');
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }

  if (!isV2Payload(parsed)) return null;

  // Signed-expiry check (layer 1 of the three-layer
  // validation; layers 2 + 3 are DB-side and live in the
  // calling Server Action / page).
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.exp <= nowSeconds) return null;

  return parsed;
}

function isV2Payload(value: unknown): value is CustomerCheckoutTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === TOKEN_VERSION_V2 &&
    typeof v.booking_id === 'string' &&
    v.booking_id.length > 0 &&
    typeof v.issued_at === 'number' &&
    Number.isFinite(v.issued_at) &&
    typeof v.exp === 'number' &&
    Number.isFinite(v.exp)
  );
}

// ============================================================================
// SHA-256 hex of the raw token, for the DB `checkout_token_hash` column.
//
// Layer 2 of the three-layer validation: after
// verifyCheckoutToken returns a payload, the calling Server
// Action looks up `bookings.checkout_token_hash` and asserts
// it equals `hashCheckoutToken(rawToken)`. The DB stores
// only the hash (defense in depth — minimizes blast radius
// if RLS is ever misconfigured).
// ============================================================================

export function hashCheckoutToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}
