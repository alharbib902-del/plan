// Server-side ONLY — same rationale as the Phase 7
// lib/empty-legs/matching.ts module: the
// `test:notifications-whatsapp-provider` Layer-1 test runs
// under tsx outside Next.js where the `'server-only'` shim
// is not resolvable. Surface contract is enforced at the
// call site (this module is only imported from
// `lib/notifications/operator-whatsapp.ts` which IS
// `import 'server-only'`).
/**
 * Phase 8.1 — wasenderapi.com WhatsApp provider.
 *
 * Mirrors the EmailDeliveryResult pattern from operator-email.ts
 * so the calling Server Actions can record both channels via a
 * single uniform shape. The provider is best-effort and never
 * throws: callers route the result into recordWhatsAppAlertStatus
 * and surface degraded states via the admin banner.
 *
 * API contract (per https://wasenderapi.com/api-docs):
 *   POST https://www.wasenderapi.com/api/send-message
 *   Headers: Authorization: Bearer <WASENDER_API_KEY>
 *            Content-Type: application/json
 *   Body:    { "to": "+966...", "text": "..." }
 *   200:     { "success": true, "data": { "msgId", "jid", "status" } }
 *   4xx/5xx: { "success": false, "message": "...", "errors"?: {...} }
 *
 * Trial limits (per founder onboarding notes):
 *   - 3-day trial validity
 *   - 1 message per minute
 *   - "Trial Bulk Limit" enforced server-side
 *
 * Defense in depth: the in-memory rate-limit guard short-circuits
 * before the network call so a misbehaving caller (or a Server
 * Action accidentally fired twice) cannot burn the trial budget.
 * Vercel serverless instances are ephemeral and the guard is
 * per-instance — this is acceptable for trial mode (worst case:
 * two instances each send one message in the same minute, hitting
 * the wasender server-side limit which returns 'rate_limited'
 * properly). For production we'd promote this to a Postgres
 * advisory lock.
 */

const WASENDER_API_BASE_URL_DEFAULT = 'https://www.wasenderapi.com';
const SEND_MESSAGE_PATH = '/api/send-message';
const RATE_LIMIT_WINDOW_MS = 60_000;

export type WhatsAppFailureReason =
  | 'config_missing'
  | 'invalid_phone'
  | 'rate_limited'
  | 'send_failed';

export type WhatsAppDeliveryResult =
  | { ok: true; provider_msg_id: string | number | null; jid: string | null }
  | { ok: false; reason: WhatsAppFailureReason; detail: string };

export interface SendWhatsAppMessageInput {
  to: string;
  text: string;
}

interface WasenderEnv {
  apiKey: string;
  baseUrl: string;
}

function readEnv(): WasenderEnv | null {
  const apiKey = process.env.WASENDER_API_KEY;
  if (!apiKey) return null;
  const baseUrl =
    process.env.WASENDER_API_BASE_URL || WASENDER_API_BASE_URL_DEFAULT;
  return { apiKey, baseUrl };
}

/**
 * Normalise a phone number to E.164 with leading '+'.
 *
 * Accepts:
 *   - "+966500000014" (already E.164)         → "+966500000014"
 *   - "00966500000014" (00 international prefix) → "+966500000014"
 *   - "966500000014" (raw country code)       → "+966500000014"
 *   - "0500000014" (Saudi local 0-prefix)     → "+966500000014"
 *
 * Rejects strings with no digits or with fewer than 8 digits
 * (Saudi mobile numbers are 9 digits after the country code).
 */
export function normaliseSaudiPhoneE164(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Strip everything except digits and a leading '+'.
  const hasLeadingPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/[^\d]/g, '');
  if (digitsOnly.length === 0) return null;

  let candidate: string;
  if (hasLeadingPlus) {
    candidate = digitsOnly;
  } else if (digitsOnly.startsWith('00')) {
    candidate = digitsOnly.slice(2);
  } else if (digitsOnly.startsWith('966')) {
    candidate = digitsOnly;
  } else if (digitsOnly.startsWith('0')) {
    // Saudi local format: "0500000014" → "966500000014".
    candidate = '966' + digitsOnly.slice(1);
  } else {
    // Bare digits (e.g. "500000014") — assume Saudi.
    candidate = '966' + digitsOnly;
  }

  // E.164 minimum after normalisation: country code (1-3) +
  // subscriber number. Saudi specifically: 966 + 9 digits = 12.
  if (candidate.length < 10 || candidate.length > 15) return null;

  return '+' + candidate;
}

// ============================================================
// In-memory account-wide rate-limit guard
//
// Codex round 1 PR #46 P2 fix: the wasender trial caps at 1
// message per minute PER ACCOUNT (not per recipient). The
// previous per-recipient keying let two back-to-back sends to
// different phones (e.g. welcome to operator A + reset to
// operator B in the same minute) pass the local guard and hit
// the wasender server-side 429 — which still consumes a slot
// from the trial budget. Keying the guard globally short-
// circuits the second send before the network call so the
// trial slot is preserved and the alert banner explains why.
//
// Vercel serverless instances are ephemeral and the guard is
// per-instance, so two cold instances can each fire one
// message in the same minute. That's still strictly safer
// than per-recipient keying, and the wasender server-side
// limit cleans up the rest. For production we'd promote
// this to a Postgres advisory lock keyed on a global
// 'wasender_send' resource.
//
// The 60s window matches the trial cap exactly; subscription
// upgrades remove the cap on wasender's side and this guard
// becomes a no-op (the per-account limit is gone, sends fire
// freely until the next downstream throttle).
// ============================================================

let lastSendAt: number | null = null;

export function isRateLimited(now: number = Date.now()): boolean {
  if (lastSendAt === null) return false;
  return now - lastSendAt < RATE_LIMIT_WINDOW_MS;
}

function recordSend(now: number = Date.now()): void {
  lastSendAt = now;
}

/**
 * Test-only: clear the in-memory rate-limit timestamp.
 * Production callers MUST NOT use this — the guard exists to
 * protect the trial budget. Exported under a deliberately
 * verbose name so accidental imports stand out in code review.
 */
export function __test_resetWhatsAppRateLimitGuard(): void {
  lastSendAt = null;
}

// ============================================================
// sendWhatsAppMessage
// ============================================================

export async function sendWhatsAppMessage(
  input: SendWhatsAppMessageInput
): Promise<WhatsAppDeliveryResult> {
  const env = readEnv();
  if (!env) {
    return {
      ok: false,
      reason: 'config_missing',
      detail: 'WASENDER_API_KEY is not set',
    };
  }

  const phone = normaliseSaudiPhoneE164(input.to);
  if (!phone) {
    return {
      ok: false,
      reason: 'invalid_phone',
      detail: 'phone number is empty or malformed',
    };
  }

  const text = input.text.trim();
  if (text.length === 0) {
    return {
      ok: false,
      reason: 'send_failed',
      detail: 'text body is empty',
    };
  }

  if (isRateLimited()) {
    return {
      ok: false,
      reason: 'rate_limited',
      detail: 'local guard: 1 message per minute (account-wide trial cap)',
    };
  }

  const url = `${env.baseUrl.replace(/\/$/, '')}${SEND_MESSAGE_PATH}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ to: phone, text }),
      // Defensive: short timeout so a hanging wasender call
      // does not block the calling Server Action past Vercel's
      // 10s function budget.
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'send_failed',
      detail:
        err instanceof Error
          ? `network error: ${err.message}`
          : 'network error',
    };
  }

  // Record the send attempt regardless of outcome — the trial
  // cap counts attempts, not successes, so a 5xx still consumes
  // the per-minute slot from wasender's perspective.
  recordSend();

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.status === 429) {
    return {
      ok: false,
      reason: 'rate_limited',
      detail: extractMessage(body) ?? 'wasender returned 429',
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: 'send_failed',
      detail:
        extractMessage(body) ??
        `wasender returned HTTP ${response.status}`,
    };
  }

  const success = extractSuccess(body);
  if (!success.ok) {
    return {
      ok: false,
      reason: 'send_failed',
      detail: success.detail,
    };
  }

  return {
    ok: true,
    provider_msg_id: success.msgId,
    jid: success.jid,
  };
}

// ============================================================
// Response body helpers
// ============================================================

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractMessage(body: unknown): string | null {
  if (!isObject(body)) return null;
  const message = body.message;
  if (typeof message === 'string' && message.length > 0) return message;
  return null;
}

interface ExtractedSuccess {
  ok: true;
  msgId: string | number | null;
  jid: string | null;
}

interface ExtractedFailure {
  ok: false;
  detail: string;
}

function extractSuccess(body: unknown): ExtractedSuccess | ExtractedFailure {
  if (!isObject(body)) {
    return { ok: false, detail: 'wasender response was not JSON' };
  }
  if (body.success !== true) {
    return {
      ok: false,
      detail: extractMessage(body) ?? 'wasender response missing success=true',
    };
  }
  const data = isObject(body.data) ? body.data : null;
  const msgIdRaw = data?.msgId;
  const jidRaw = data?.jid;
  const msgId =
    typeof msgIdRaw === 'string' || typeof msgIdRaw === 'number'
      ? msgIdRaw
      : null;
  const jid = typeof jidRaw === 'string' ? jidRaw : null;
  return { ok: true, msgId, jid };
}
