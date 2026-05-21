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

export const ADMIN_MFA_CHALLENGE_RATE_LIMIT = {
  failureWindowMs: 15 * 60 * 1000,
  maxFailures: 5,
  attemptWindowMs: 60 * 60 * 1000,
  maxAttempts: 20,
} as const;

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

export function evaluateAdminMfaChallengeRateLimit(
  attempts: AdminMfaChallengeAttemptRow[],
  now: Date = new Date()
): AdminMfaChallengeRateLimitVerdict {
  const nowMs = now.getTime();
  const failureCutoff =
    nowMs - ADMIN_MFA_CHALLENGE_RATE_LIMIT.failureWindowMs;
  const attemptCutoff =
    nowMs - ADMIN_MFA_CHALLENGE_RATE_LIMIT.attemptWindowMs;

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
  if (recentAttempts.length >= ADMIN_MFA_CHALLENGE_RATE_LIMIT.maxAttempts) {
    const oldest = Math.min(
      ...recentAttempts.map((attempt) => attempt.attemptedAtMs)
    );
    return {
      ok: false,
      reason: 'too_many_attempts',
      retryAfterSeconds: secondsUntil(
        oldest + ADMIN_MFA_CHALLENGE_RATE_LIMIT.attemptWindowMs,
        nowMs
      ),
    };
  }

  const recentFailures = parsed.filter(
    (attempt) =>
      attempt.outcome !== 'success' && attempt.attemptedAtMs >= failureCutoff
  );
  if (recentFailures.length >= ADMIN_MFA_CHALLENGE_RATE_LIMIT.maxFailures) {
    const newest = Math.max(
      ...recentFailures.map((attempt) => attempt.attemptedAtMs)
    );
    return {
      ok: false,
      reason: 'too_many_failures',
      retryAfterSeconds: secondsUntil(
        newest + ADMIN_MFA_CHALLENGE_RATE_LIMIT.failureWindowMs,
        nowMs
      ),
    };
  }

  return { ok: true };
}
