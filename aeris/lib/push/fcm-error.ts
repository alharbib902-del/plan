/**
 * Pure FCM HTTP v1 result classification + retry backoff + multi-device
 * aggregation (NO 'server-only', tsx-testable).
 *
 * Token-deletion is DELIBERATELY conservative (founder P1): delete a device
 * token ONLY when FCM says the registration is gone — UNREGISTERED (or a 404),
 * or an INVALID_ARGUMENT whose field-violation explicitly targets the token
 * field. A generic/payload INVALID_ARGUMENT (a bad message/data) is NEVER a
 * token-delete — it's transient — so a template/payload bug can't mass-delete
 * healthy tokens.
 */

export type FcmTokenOutcome = 'success' | 'delete' | 'transient' | 'config';

interface FcmErrorDetail {
  '@type'?: string;
  errorCode?: string;
  fieldViolations?: Array<{ field?: string; description?: string }>;
}

function details(body: unknown): FcmErrorDetail[] {
  const d = (body as { error?: { details?: unknown } } | null)?.error?.details;
  return Array.isArray(d) ? (d as FcmErrorDetail[]) : [];
}

/** True only when the error details explicitly blame the registration token
 *  (an FcmError UNREGISTERED, or a BadRequest fieldViolation on a *token*
 *  field) — NOT a payload field violation. */
function pointsAtToken(body: unknown): boolean {
  for (const detail of details(body)) {
    if (detail.errorCode === 'UNREGISTERED') return true;
    for (const v of detail.fieldViolations ?? []) {
      const field = (v.field ?? '').toLowerCase();
      // ONLY the registration-token field — exact match. A broad
      // endsWith('.token') could misread a future payload field whose path
      // ends in "token" (e.g. message.data.token) as a token error and
      // wrongly delete a healthy registration.
      if (field === 'message.token' || field === 'token') return true;
    }
  }
  return false;
}

/**
 * Classify one FCM v1 per-token send result.
 *   200            → success
 *   401 / 403      → config (bad/missing creds — NEVER delete a token)
 *   404            → delete (registration gone)
 *   UNREGISTERED   → delete (any status)
 *   400 INVALID_ARGUMENT with a token-field violation → delete
 *   400 INVALID_ARGUMENT otherwise (payload) → transient (NO delete)
 *   429 / 5xx / other → transient
 */
export function classifyFcmResult(
  httpStatus: number,
  body: unknown
): FcmTokenOutcome {
  if (httpStatus >= 200 && httpStatus < 300) return 'success';
  if (httpStatus === 401 || httpStatus === 403) return 'config';

  // Token explicitly gone, regardless of the numeric status.
  if (pointsAtToken(body)) return 'delete';
  if (httpStatus === 404) return 'delete';

  // Everything else (incl. a payload INVALID_ARGUMENT, 429, 5xx, timeouts
  // surfaced as a non-2xx) is retryable without touching the token.
  return 'transient';
}

/** Exponential backoff capped at 6h: attempt 1→5m, 2→10m, 3→20m, 4→40m,
 *  5→80m. `now` is injected for deterministic tests. */
export function nextRetryAt(attempt: number, now: Date): string {
  const baseMs = 5 * 60 * 1000;
  const capMs = 6 * 60 * 60 * 1000;
  const safeAttempt = attempt >= 1 ? attempt : 1;
  const delay = Math.min(baseMs * 2 ** (safeAttempt - 1), capMs);
  return new Date(now.getTime() + delay).toISOString();
}

export interface AggregateResult {
  markStatus: 'sent' | 'failed_transient' | 'failed_permanent';
  /** A config/creds error occurred → record config_missing on the health
   *  singleton (and the row is failed_transient so a retry sweep re-tries it
   *  once creds are fixed — founder P1). */
  configMissing: boolean;
}

/**
 * Fold per-device outcomes into the single (client, leg, event) delivery
 * status. Granularity is the event, not the device:
 *   - any success            → sent
 *   - else any config        → failed_transient + configMissing (retry later)
 *   - else any transient     → failed_transient
 *   - else (all delete)      → failed_permanent
 * An empty list is the caller's concern (no tokens → mark sent).
 */
export function aggregateDeliveryStatus(
  outcomes: readonly FcmTokenOutcome[]
): AggregateResult {
  if (outcomes.includes('success')) {
    return { markStatus: 'sent', configMissing: false };
  }
  if (outcomes.includes('config')) {
    return { markStatus: 'failed_transient', configMissing: true };
  }
  if (outcomes.includes('transient')) {
    return { markStatus: 'failed_transient', configMissing: false };
  }
  return { markStatus: 'failed_permanent', configMissing: false };
}
