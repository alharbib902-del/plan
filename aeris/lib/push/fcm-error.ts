/**
 * Pure FCM HTTP v1 result classification + retry backoff + multi-device
 * aggregation (NO 'server-only', tsx-testable).
 *
 * Token-deletion is DELIBERATELY conservative (founder P1): delete a device
 * token ONLY when FCM explicitly says the registration is gone — an
 * UNREGISTERED detail, or an INVALID_ARGUMENT whose field-violation targets the
 * token field. A bare HTTP 404 (wrong project/endpoint/partial response), a
 * generic/payload INVALID_ARGUMENT, or a creds error is NEVER a token-delete —
 * so a misconfig or template bug can't mass-delete healthy tokens.
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
 *   200                                                → success
 *   401 / 403                                          → config (creds — NEVER delete)
 *   UNREGISTERED detail (any status)                   → delete
 *   400 INVALID_ARGUMENT with a token-field violation  → delete
 *   bare 404 / payload INVALID_ARGUMENT / 429 / 5xx    → transient (NO delete)
 */
export function classifyFcmResult(
  httpStatus: number,
  body: unknown
): FcmTokenOutcome {
  if (httpStatus >= 200 && httpStatus < 300) return 'success';
  if (httpStatus === 401 || httpStatus === 403) return 'config';

  // Delete ONLY when FCM's details explicitly blame the registration token
  // (UNREGISTERED, or a token-field violation). A bare 404 (wrong
  // project/endpoint/partial response) is NOT a token signal → transient.
  if (pointsAtToken(body)) return 'delete';

  // Everything else (bare 404, payload INVALID_ARGUMENT, 429, 5xx, timeouts
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
