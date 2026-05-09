import { timingSafeEqual } from 'crypto';

/**
 * Phase 7 PR 2e — shared cron-route auth helper.
 *
 * Every `/api/cron/empty-legs/...` route guards against
 * unauthorized invocation by requiring
 * `Authorization: Bearer $CRON_SECRET`. Vercel Cron sets
 * this header automatically when invoking scheduled
 * routes; external callers (smoke tests) need to pass it
 * manually.
 *
 * Module is pure — accepts the request, returns a
 * verdict. The route handlers consume the verdict and
 * return 401 Response on failure.
 */

export type CronAuthVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing_header' | 'malformed' | 'mismatch' | 'env_missing' };

export function verifyCronAuth(headers: Headers): CronAuthVerdict {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.trim().length === 0) {
    return { ok: false, reason: 'env_missing' };
  }

  const headerValue = headers.get('authorization');
  if (!headerValue) return { ok: false, reason: 'missing_header' };

  // Expect `Bearer <token>` (case-insensitive Bearer
  // prefix per RFC 6750).
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!match) return { ok: false, reason: 'malformed' };

  const presented = match[1].trim();
  if (presented.length !== secret.trim().length) {
    return { ok: false, reason: 'mismatch' };
  }

  // Constant-time compare via Buffer + timingSafeEqual.
  const a = Buffer.from(presented);
  const b = Buffer.from(secret.trim());
  if (a.length !== b.length) {
    return { ok: false, reason: 'mismatch' };
  }
  return timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}

export function unauthorizedJsonResponse(): Response {
  return new Response(
    JSON.stringify({ ok: false, error: 'unauthorized' }),
    {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }
  );
}
