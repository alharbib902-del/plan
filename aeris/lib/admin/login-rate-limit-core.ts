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
  | 'rate_limited'
  // PR #92 round-1 fix: password verified but MFA still owed.
  // Distinct from 'success' so the ledger truthfully reflects
  // "first factor passed, second factor pending" — the MFA
  // outcome lives in admin_mfa_challenge_attempts.
  | 'password_ok_pending_mfa';

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

/**
 * SEC-01 — per-account rate-limit identity for admin login.
 *
 * The IP bucket keys on `ip:<addr>`, so credential-stuffing the
 * founder's email from rotating IPs never trips it. This bucket
 * keys on the account instead; fed through
 * `fingerprintAdminLoginActor` it becomes an `acct:`-prefixed
 * HMAC — the raw email is NEVER stored. Returns `null` for
 * blank/missing input so the caller falls back to IP-only.
 */
export function accountActorIdentity(
  accountKey: string | null | undefined
): string | null {
  const normalized = accountKey?.trim().toLowerCase();
  if (!normalized) return null;
  return `acct:${normalized}`;
}

export function firstForwardedIp(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/**
 * Last (rightmost) IP from a comma-separated X-Forwarded-For value.
 *
 * On Vercel the platform APPENDS the real client IP as the final
 * XFF hop, so a client that injects `X-Forwarded-For: <victim>`
 * only controls the leftmost tokens — the rightmost hop is the
 * one the trusted proxy added. We key the limiter on that hop so
 * the client can't spoof its identity to dodge the throttle.
 */
export function lastForwardedIp(value: string | null): string | null {
  const parts = value?.split(',');
  const last = parts?.[parts.length - 1]?.trim();
  return last && last.length > 0 ? last : null;
}

export function actorIdentityFromHeaders(headers: {
  vercelForwardedFor?: string | null;
  forwardedFor?: string | null;
  realIp?: string | null;
  cfConnectingIp?: string | null;
  userAgent?: string | null;
}): string {
  // Derive the client IP from platform-trusted sources first.
  // `x-vercel-forwarded-for` / `x-real-ip` are set by the edge and
  // cannot be forged by the client; `cf-connecting-ip` is Cloudflare-
  // trusted. Only as a last resort do we read the raw XFF, and then
  // we take its RIGHTMOST hop (platform-appended), never the
  // client-controlled leftmost token.
  const ip =
    firstForwardedIp(headers.vercelForwardedFor ?? null) ??
    headers.realIp?.trim() ??
    headers.cfConnectingIp?.trim() ??
    lastForwardedIp(headers.forwardedFor ?? null);

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
      // 'success' AND 'password_ok_pending_mfa' both represent
      // a successful password layer; only one of them is the
      // FINAL login outcome. Neither counts toward the failure
      // cap.
      attempt.outcome !== 'success' &&
      attempt.outcome !== 'password_ok_pending_mfa' &&
      attempt.attemptedAtMs >= failureCutoff
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
