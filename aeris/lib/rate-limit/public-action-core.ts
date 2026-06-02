import { createHmac } from 'crypto';

/**
 * Public-action rate-limit pure logic.
 *
 * Mirrors the lib/admin/login-rate-limit-core.ts contract but
 * generalized to take per-action limits (so cargo's 3/15min
 * can differ from flight-request's 5/15min).
 *
 * Two windows enforced per action + actor fingerprint:
 *   - failureWindow: short window for back-to-back failures
 *     (rate_limited / validation_failed / rpc_error / honeypot)
 *   - attemptWindow: longer window for total attempts of any
 *     outcome (catches "spammer hammering with valid input")
 *
 * Returns a verdict envelope identical in shape to the admin
 * variant so the reused JSON-API surface in actions stays
 * uniform.
 */

export type PublicAction =
  | 'flight_request'
  | 'empty_leg_reserve'
  | 'cargo_intake'
  | 'medevac_intake'
  | 'client_login'
  | 'operator_login';

export type PublicActionAttemptOutcome =
  | 'success'
  | 'rate_limited'
  | 'validation_failed'
  | 'rpc_error'
  | 'honeypot'
  | 'auth_failed';

export interface PublicActionAttemptRow {
  outcome: PublicActionAttemptOutcome;
  attempted_at: string;
}

export interface PublicActionRateLimitConfig {
  /** Window length for the "back-to-back failures" cap. */
  failureWindowMs: number;
  /** Max failures in failureWindowMs before lockout. */
  maxFailures: number;
  /** Window length for the "total attempts (any outcome)" cap. */
  attemptWindowMs: number;
  /** Max attempts in attemptWindowMs before lockout. */
  maxAttempts: number;
}

export type PublicActionRateLimitVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: 'too_many_failures' | 'too_many_attempts';
      retryAfterSeconds: number;
    };

/**
 * Per-action limits. Tuned conservatively for v1 — the founder
 * can relax these once we have baseline traffic data:
 *
 * - flight_request: main lead form, moderate burst tolerance.
 * - empty_leg_reserve: hot path during Dutch auction price
 *   drops; allow more attempts for legitimate retries.
 * - cargo_intake: lower burst — cargo bookings are deliberate.
 * - medevac_intake: emergencies; slightly more permissive than
 *   cargo so a panicked user retrying isn't locked out.
 *
 * All actions: failures (any non-success) count toward
 * BOTH the short-failure cap AND the long-attempt cap. A
 * successful submission counts only toward attemptWindow.
 */
export const PUBLIC_ACTION_LIMITS: Record<
  PublicAction,
  PublicActionRateLimitConfig
> = {
  flight_request: {
    failureWindowMs: 15 * 60 * 1000,
    maxFailures: 5,
    attemptWindowMs: 60 * 60 * 1000,
    maxAttempts: 20,
  },
  empty_leg_reserve: {
    failureWindowMs: 15 * 60 * 1000,
    maxFailures: 5,
    attemptWindowMs: 60 * 60 * 1000,
    maxAttempts: 30,
  },
  cargo_intake: {
    failureWindowMs: 15 * 60 * 1000,
    maxFailures: 3,
    attemptWindowMs: 60 * 60 * 1000,
    maxAttempts: 15,
  },
  medevac_intake: {
    failureWindowMs: 15 * 60 * 1000,
    maxFailures: 5,
    attemptWindowMs: 60 * 60 * 1000,
    maxAttempts: 20,
  },
  // SEC-02 — public login forms. Stricter than intake: a legitimate
  // user rarely fails 5 times in 15 min, but this throttles
  // credential-stuffing / brute-force. `auth_failed` (bad credentials)
  // counts toward the failure cap like any non-success outcome.
  client_login: {
    failureWindowMs: 15 * 60 * 1000,
    maxFailures: 5,
    attemptWindowMs: 60 * 60 * 1000,
    maxAttempts: 10,
  },
  operator_login: {
    failureWindowMs: 15 * 60 * 1000,
    maxFailures: 5,
    attemptWindowMs: 60 * 60 * 1000,
    maxAttempts: 10,
  },
};

function secondsUntil(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

function parseAttemptTime(value: string): number | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** First IP from a comma-separated X-Forwarded-For value. */
export function firstForwardedIp(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/**
 * Builds the unique identity string for an anonymous public
 * caller. Prefers IP from Vercel/Cloudflare headers; falls back
 * to a UA-derived bucket so we never lose the throttle entirely.
 */
export function actorIdentityFromHeaders(headers: {
  forwardedFor?: string | null;
  realIp?: string | null;
  cfConnectingIp?: string | null;
  userAgent?: string | null;
}): string {
  const ip =
    firstForwardedIp(headers.forwardedFor ?? null) ??
    headers.realIp?.trim() ??
    headers.cfConnectingIp?.trim();

  if (ip && ip.length > 0) {
    return `ip:${ip}`;
  }

  const ua = headers.userAgent?.trim();
  if (ua && ua.length > 0) {
    return `unknown-ip:${ua.slice(0, 160)}`;
  }

  return 'unknown-ip:unknown-agent';
}

/**
 * HMAC-SHA256 fingerprint scoped per-action so the same caller
 * appears as different fingerprints across actions — limits the
 * blast radius if an attacker derived one fingerprint somehow.
 */
export function fingerprintPublicActionActor(
  actorIdentity: string,
  action: PublicAction,
  secret: string
): string {
  return createHmac('sha256', secret)
    .update(`${action}:${actorIdentity.trim().toLowerCase()}`, 'utf8')
    .digest('hex');
}

export function evaluatePublicActionRateLimit(
  attempts: PublicActionAttemptRow[],
  config: PublicActionRateLimitConfig,
  now: Date = new Date()
): PublicActionRateLimitVerdict {
  const nowMs = now.getTime();
  const failureCutoff = nowMs - config.failureWindowMs;
  const attemptCutoff = nowMs - config.attemptWindowMs;

  const parsed = attempts
    .map((attempt) => ({
      ...attempt,
      attemptedAtMs: parseAttemptTime(attempt.attempted_at),
    }))
    .filter(
      (
        attempt
      ): attempt is PublicActionAttemptRow & { attemptedAtMs: number } =>
        attempt.attemptedAtMs !== null && attempt.attemptedAtMs <= nowMs
    );

  const recentAttempts = parsed.filter(
    (attempt) => attempt.attemptedAtMs >= attemptCutoff
  );
  if (recentAttempts.length >= config.maxAttempts) {
    const oldest = Math.min(
      ...recentAttempts.map((attempt) => attempt.attemptedAtMs)
    );
    return {
      ok: false,
      reason: 'too_many_attempts',
      retryAfterSeconds: secondsUntil(
        oldest + config.attemptWindowMs,
        nowMs
      ),
    };
  }

  const recentFailures = parsed.filter(
    (attempt) =>
      attempt.outcome !== 'success' && attempt.attemptedAtMs >= failureCutoff
  );
  if (recentFailures.length >= config.maxFailures) {
    const newest = Math.max(
      ...recentFailures.map((attempt) => attempt.attemptedAtMs)
    );
    return {
      ok: false,
      reason: 'too_many_failures',
      retryAfterSeconds: secondsUntil(
        newest + config.failureWindowMs,
        nowMs
      ),
    };
  }

  return { ok: true };
}
