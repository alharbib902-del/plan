// Server-side ONLY — same rationale as the
// reservation-token sibling: the Layer-1 token test runs
// under tsx outside Next.js, and the `'server-only'` shim
// is not resolvable there. Surface contract is enforced
// at the call-site level.
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Phase 7 PR 2d — opt-out token for the Empty Legs
 * marketplace.
 *
 * URL shape:  /empty-legs/opt-out/<token>
 * Wire shape: base64url(payload).base64url(signature)
 *
 * Payload (v=1):
 *   { v: 1, lead_inquiry_id, issued_at }
 *
 * **No expiry.** Opt-out links never expire — a customer who
 * decides three months later to opt out should still land on
 * the lander successfully. The token is single-purpose
 * (flips `lead_inquiries.empty_legs_opt_in` to FALSE) so
 * eternal validity is the right tradeoff.
 *
 * Embedded in every WhatsApp prefilled text / wa.me
 * notification body that the matching engine emits
 * (Codex iteration-3 P2 #1 fix).
 *
 * Separate secret (`EMPTY_LEGS_OPT_OUT_TOKEN_SECRET`)
 * mirrors the reservation-token discipline. Module is
 * fail-closed: missing/empty secret → mint throws,
 * verify returns `{ valid: false }`.
 */

const TOKEN_VERSION = 1;

export class OptOutTokenEnvError extends Error {
  constructor() {
    super('EMPTY_LEGS_OPT_OUT_TOKEN_SECRET is missing or empty');
    this.name = 'OptOutTokenEnvError';
  }
}

function requireSecret(): string {
  const secret = process.env.EMPTY_LEGS_OPT_OUT_TOKEN_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new OptOutTokenEnvError();
  }
  return secret;
}

// ============================================================
// Payload
// ============================================================

export interface OptOutTokenPayload {
  v: 1;
  lead_inquiry_id: string;
  issued_at: number;
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
// Mint
// ============================================================

export interface MintOptOutTokenOptions {
  leadInquiryId: string;
}

export interface MintedOptOutToken {
  token: string;
  payload: OptOutTokenPayload;
}

export function mintOptOutToken({
  leadInquiryId,
}: MintOptOutTokenOptions): MintedOptOutToken {
  const secret = requireSecret();
  const payload: OptOutTokenPayload = {
    v: TOKEN_VERSION,
    lead_inquiry_id: leadInquiryId,
    issued_at: Math.floor(Date.now() / 1000),
  };
  const encoded = base64urlEncode(JSON.stringify(payload));
  const signature = sign(encoded, secret);
  return { token: `${encoded}.${signature}`, payload };
}

// ============================================================
// Verify (HMAC only — no expiry check)
// ============================================================

export type VerifyOptOutTokenResult =
  | { valid: true; payload: OptOutTokenPayload }
  | { valid: false };

export function verifyOptOutToken(
  rawToken: string | undefined
): VerifyOptOutTokenResult {
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

  return { valid: true, payload: parsed };
}

function isV1Payload(value: unknown): value is OptOutTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === TOKEN_VERSION &&
    typeof v.lead_inquiry_id === 'string' &&
    v.lead_inquiry_id.length > 0 &&
    typeof v.issued_at === 'number' &&
    Number.isFinite(v.issued_at)
  );
}
