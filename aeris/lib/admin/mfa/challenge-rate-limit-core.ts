import { createHmac } from 'crypto';

/**
 * Pure rate-limit logic for the MFA challenge endpoint.
 *
 * Mirrors lib/admin/login-rate-limit-core.ts but scoped per
 * (actor_fingerprint, admin_user_id) tuple — by the time we
 * reach the MFA challenge we already know which admin's
 * pending session we're verifying for, so the throttle keys
 * on both axes.
 *
 * Limits tuned for the 6-digit TOTP brute-force threat model:
 *   - 5 failures in 15 min → after 5 wrong tries the actor is
 *     locked out of THIS admin's MFA for the next 15 min
 *   - 20 attempts in 60 min → catches a slow trickle from a
 *     well-paced attacker
 *
 * The actor MUST already have a `mfa_pending=true` session
 * (i.e. they passed the password layer). Without that, the
 * MFA challenge action 401s before this throttle is checked.
 *
 * Same anti-enumeration property as the login throttle:
 * `rate_limited` is one of the outcomes, so subsequent
 * over-cap requests don't drain the budget further.
 */

/**
 * Per-(actor_fingerprint, admin_user_id) caps. The dominant
 * throttle in the common case — same browser/IP fingerprinted
 * via HMAC against the per-admin scope.
 */
export const ADMIN_MFA_CHALLENGE_RATE_LIMIT = {
  failureWindowMs: 15 * 60 * 1000,
  maxFailures: 5,
  attemptWindowMs: 60 * 60 * 1000,
  maxAttempts: 20,
} as const;

/**
 * Round-2 hardening on PR #92: per-admin cap that ignores the
 * actor fingerprint. Closes the distributed-guessing path —
 * an attacker rotating across many IPs (botnet, residential
 * proxies) would otherwise stay under the per-actor cap on
 * each IP yet rack up hundreds of attempts on a single
 * pending admin session.
 *
 * Sizing rationale (assumes 6-digit TOTP with ±1 step window
 * = ~3 valid OTPs at any moment):
 *   - 15 failures / 30 min × 3 valid OTPs = 45 guesses against
 *     10^6 keyspace per 30-min window
 *   - 50% break-in expectation requires ~11,000 such windows
 *     = ~225 days of continuous distributed brute-force
 *
 * Numbers stricter than the per-actor cap because this scope
 * legitimately includes multiple devices (a founder may log
 * in from laptop + phone). Set higher than per-actor max so a
 * single-IP burst still trips the per-actor cap first and
 * never reaches this layer.
 */
export const ADMIN_MFA_CHALLENGE_ADMIN_LIMIT = {
  failureWindowMs: 30 * 60 * 1000,
  maxFailures: 15,
  attemptWindowMs: 60 * 60 * 1000,
  maxAttempts: 50,
} as const;

interface RateLimitConfig {
  failureWindowMs: number;
  maxFailures: number;
  attemptWindowMs: number;
  maxAttempts: number;
}

export type AdminMfaChallengeOutcome =
  | 'success'
  | 'invalid_otp'
  | 'invalid_recovery'
  | 'replay_same_step'
  | 'rate_limited'
  | 'no_active_mfa'
  | 'invalid_input'
  | 'storage_error';

export interface AdminMfaChallengeAttemptRow {
  outcome: AdminMfaChallengeOutcome;
  attempted_at: string;
}

export type AdminMfaChallengeRateLimitVerdict =
  | { ok: true }
  | {
      ok: false;
      reason: 'too_many_failures' | 'too_many_attempts';
      retryAfterSeconds: number;
    };

function secondsUntil(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

function parseAttemptTime(value: string): number | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/**
 * Per-admin fingerprint: HMAC over the actor identity AND the
 * admin_user_id. Same identity hitting two different admin
 * accounts gets two different fingerprints — limits the blast
 * radius if a fingerprint is ever leaked, and makes per-admin
 * throttle ledgers naturally isolated.
 */
export function fingerprintMfaChallengeActor(
  actorIdentity: string,
  adminUserId: string,
  secret: string
): string {
  return createHmac('sha256', secret)
    .update(`mfa:${adminUserId}:${actorIdentity.trim().toLowerCase()}`, 'utf8')
    .digest('hex');
}

/**
 * Generic per-config evaluator. Both per-actor and per-admin
 * scopes call this with their own limits + their own attempt
 * ledger slice. Anti-enumeration: returns a uniform verdict
 * shape regardless of scope.
 */
function evaluateWithConfig(
  attempts: AdminMfaChallengeAttemptRow[],
  config: RateLimitConfig,
  now: Date
): AdminMfaChallengeRateLimitVerdict {
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
      ): attempt is AdminMfaChallengeAttemptRow & {
        attemptedAtMs: number;
      } => attempt.attemptedAtMs !== null && attempt.attemptedAtMs <= nowMs
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

/**
 * Per-(actor_fingerprint, admin_user_id) scope evaluator.
 * Stays in place as the legacy entry point so existing tests +
 * call sites don't shift.
 */
export function evaluateAdminMfaChallengeRateLimit(
  attempts: AdminMfaChallengeAttemptRow[],
  now: Date = new Date()
): AdminMfaChallengeRateLimitVerdict {
  return evaluateWithConfig(attempts, ADMIN_MFA_CHALLENGE_RATE_LIMIT, now);
}

/**
 * Round-2 admin-scope evaluator (any actor against this admin).
 * Closes the distributed-guessing path that the per-actor
 * evaluator alone cannot — see ADMIN_MFA_CHALLENGE_ADMIN_LIMIT
 * sizing notes above.
 */
export function evaluateAdminMfaChallengeRateLimitAdminScope(
  attempts: AdminMfaChallengeAttemptRow[],
  now: Date = new Date()
): AdminMfaChallengeRateLimitVerdict {
  return evaluateWithConfig(
    attempts,
    ADMIN_MFA_CHALLENGE_ADMIN_LIMIT,
    now
  );
}
