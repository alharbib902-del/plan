import { createHmac } from 'crypto';

export const ADMIN_LOGIN_RATE_LIMIT = {
  failureWindowMs: 15 * 60 * 1000,
  maxFailures: 5,
  attemptWindowMs: 60 * 60 * 1000,
  maxAttempts: 30,
} as const;

export type AdminLoginAttemptOutcome =
  | 'success'
  | 'invalid_password'
  | 'invalid_input'
  | 'rate_limited';

export interface AdminLoginAttemptRow {
  outcome: AdminLoginAttemptOutcome;
  attempted_at: string;
}

export type AdminLoginRateLimitVerdict =
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

export function fingerprintAdminLoginActor(
  actorIdentity: string,
  secret: string
): string {
  return createHmac('sha256', secret)
    .update(actorIdentity.trim().toLowerCase(), 'utf8')
    .digest('hex');
}

export function firstForwardedIp(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

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

export function evaluateAdminLoginRateLimit(
  attempts: AdminLoginAttemptRow[],
  now: Date = new Date()
): AdminLoginRateLimitVerdict {
  const nowMs = now.getTime();
  const failureCutoff = nowMs - ADMIN_LOGIN_RATE_LIMIT.failureWindowMs;
  const attemptCutoff = nowMs - ADMIN_LOGIN_RATE_LIMIT.attemptWindowMs;

  const parsed = attempts
    .map((attempt) => ({
      ...attempt,
      attemptedAtMs: parseAttemptTime(attempt.attempted_at),
    }))
    .filter(
      (attempt): attempt is AdminLoginAttemptRow & { attemptedAtMs: number } =>
        attempt.attemptedAtMs !== null && attempt.attemptedAtMs <= nowMs
    );

  const recentAttempts = parsed.filter(
    (attempt) => attempt.attemptedAtMs >= attemptCutoff
  );
  if (recentAttempts.length >= ADMIN_LOGIN_RATE_LIMIT.maxAttempts) {
    const oldest = Math.min(
      ...recentAttempts.map((attempt) => attempt.attemptedAtMs)
    );
    return {
      ok: false,
      reason: 'too_many_attempts',
      retryAfterSeconds: secondsUntil(
        oldest + ADMIN_LOGIN_RATE_LIMIT.attemptWindowMs,
        nowMs
      ),
    };
  }

  const recentFailures = parsed.filter(
    (attempt) =>
      attempt.outcome !== 'success' && attempt.attemptedAtMs >= failureCutoff
  );
  if (recentFailures.length >= ADMIN_LOGIN_RATE_LIMIT.maxFailures) {
    const newest = Math.max(
      ...recentFailures.map((attempt) => attempt.attemptedAtMs)
    );
    return {
      ok: false,
      reason: 'too_many_failures',
      retryAfterSeconds: secondsUntil(
        newest + ADMIN_LOGIN_RATE_LIMIT.failureWindowMs,
        nowMs
      ),
    };
  }

  return { ok: true };
}
