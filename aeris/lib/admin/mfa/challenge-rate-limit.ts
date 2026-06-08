// Server-side ONLY — same rationale as
// lib/empty-legs/matching.ts: the structural tests would
// otherwise fail under tsx outside Next.js. The
// createAdminClient import enforces the server boundary; a
// client-side import of supabase/admin throws at runtime.

import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminEnv } from '@/lib/admin/auth';
import {
  ADMIN_MFA_CHALLENGE_ADMIN_LIMIT,
  ADMIN_MFA_CHALLENGE_RATE_LIMIT,
  evaluateAdminMfaChallengeRateLimit,
  evaluateAdminMfaChallengeRateLimitAdminScope,
  fingerprintMfaChallengeActor,
  type AdminMfaChallengeAttemptRow,
  type AdminMfaChallengeOutcome,
  type AdminMfaChallengeRateLimitVerdict,
} from '@/lib/admin/mfa/challenge-rate-limit-core';
import { actorIdentityFromHeaders } from '@/lib/admin/login-rate-limit-core';

/**
 * MFA challenge rate-limit server binding.
 *
 * Mirrors lib/admin/login-rate-limit.ts but keyed by both the
 * caller's HMAC fingerprint AND the admin_user_id whose
 * pending session is being challenged. Fail-closed on storage
 * error so a Supabase availability gap doesn't open a brute-
 * force bypass.
 */

const TABLE = 'admin_mfa_challenge_attempts';

type AdminMfaChallengeAttemptStore = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        // Per-actor scope: filters on (actor_fingerprint, admin_user_id).
        eq: (column: string, value: string) => {
          gte: (
            column: string,
            value: string
          ) => Promise<{
            data: unknown[] | null;
            error: { message?: string } | null;
          }>;
        };
        // Admin scope: filters on admin_user_id alone.
        gte: (
          column: string,
          value: string
        ) => Promise<{
          data: unknown[] | null;
          error: { message?: string } | null;
        }>;
      };
    };
    insert: (
      row: Record<string, unknown>
    ) => Promise<{ error: { message?: string } | null }>;
  };
};

export type AdminMfaChallengeRateLimitCheck =
  | { ok: true; actorFingerprint: string }
  | {
      ok: false;
      actorFingerprint: string;
      reason:
        | Exclude<
            AdminMfaChallengeRateLimitVerdict,
            { ok: true }
          >['reason']
        | 'storage_error';
      retryAfterSeconds: number;
    };

function attemptStore(): AdminMfaChallengeAttemptStore {
  return createAdminClient() as unknown as AdminMfaChallengeAttemptStore;
}

async function currentActorFingerprint(
  adminUserId: string
): Promise<string> {
  const env = requireAdminEnv();
  const h = await headers();
  const identity = actorIdentityFromHeaders({
    vercelForwardedFor: h.get('x-vercel-forwarded-for'),
    forwardedFor: h.get('x-forwarded-for'),
    realIp: h.get('x-real-ip'),
    cfConnectingIp: h.get('cf-connecting-ip'),
    userAgent: h.get('user-agent'),
  });
  return fingerprintMfaChallengeActor(identity, adminUserId, env.secret);
}

function normalizeRows(
  rows: unknown[] | null
): AdminMfaChallengeAttemptRow[] {
  return (rows ?? []).flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const candidate = row as Partial<AdminMfaChallengeAttemptRow>;
    if (
      typeof candidate.outcome !== 'string' ||
      typeof candidate.attempted_at !== 'string'
    ) {
      return [];
    }
    return [
      {
        outcome: candidate.outcome as AdminMfaChallengeOutcome,
        attempted_at: candidate.attempted_at,
      },
    ];
  });
}

/**
 * Two-scope rate-limit check:
 *   1. Per-(actor_fingerprint, admin_user_id) — the dominant
 *      throttle for the common single-IP case.
 *   2. Per-admin (any actor) — round-2 hardening against
 *      distributed guessing across many IPs.
 *
 * Either scope rejecting trips the gate. We use the LARGER of
 * the two windows to size a SHARED cutoff ISO timestamp so
 * both queries scan the same time range — but the queries
 * themselves run as TWO indexed reads (one filtered by
 * `(actor_fingerprint, admin_user_id)`, one by `admin_user_id`
 * alone). The admin scope's windows are >= the actor scope's
 * by design, so the shared cutoff is wide enough for both
 * evaluators to operate on the rows their config expects.
 *
 * Storage errors on either query fail-closed.
 */
export async function checkAdminMfaChallengeRateLimit(
  adminUserId: string
): Promise<AdminMfaChallengeRateLimitCheck> {
  const actorFingerprint = await currentActorFingerprint(adminUserId);
  const cutoffMs = Math.max(
    ADMIN_MFA_CHALLENGE_RATE_LIMIT.attemptWindowMs,
    ADMIN_MFA_CHALLENGE_ADMIN_LIMIT.attemptWindowMs
  );
  const since = new Date(Date.now() - cutoffMs).toISOString();
  const store = attemptStore();

  // Per-actor scope query.
  const actorResult = await store
    .from(TABLE)
    .select('outcome, attempted_at')
    .eq('actor_fingerprint', actorFingerprint)
    .eq('admin_user_id', adminUserId)
    .gte('attempted_at', since);

  if (actorResult.error) {
    console.error(
      '[admin-mfa-challenge-rate-limit] actor-scope check failed',
      actorResult.error
    );
    return {
      ok: false,
      actorFingerprint,
      reason: 'storage_error',
      retryAfterSeconds: 60,
    };
  }

  const actorVerdict = evaluateAdminMfaChallengeRateLimit(
    normalizeRows(actorResult.data)
  );
  if (!actorVerdict.ok) {
    return { ...actorVerdict, ok: false, actorFingerprint };
  }

  // Per-admin scope query (any actor against this admin).
  // PR #92 round-2 hardening: closes the distributed-guessing
  // path that the per-actor evaluator alone cannot.
  const adminResult = await store
    .from(TABLE)
    .select('outcome, attempted_at')
    .eq('admin_user_id', adminUserId)
    .gte('attempted_at', since);

  if (adminResult.error) {
    console.error(
      '[admin-mfa-challenge-rate-limit] admin-scope check failed',
      adminResult.error
    );
    return {
      ok: false,
      actorFingerprint,
      reason: 'storage_error',
      retryAfterSeconds: 60,
    };
  }

  const adminVerdict = evaluateAdminMfaChallengeRateLimitAdminScope(
    normalizeRows(adminResult.data)
  );
  if (!adminVerdict.ok) {
    return { ...adminVerdict, ok: false, actorFingerprint };
  }

  return { ok: true, actorFingerprint };
}

export async function recordAdminMfaChallengeAttempt(
  actorFingerprint: string,
  adminUserId: string,
  outcome: AdminMfaChallengeOutcome
): Promise<void> {
  const { error } = await attemptStore().from(TABLE).insert({
    actor_fingerprint: actorFingerprint,
    admin_user_id: adminUserId,
    outcome,
  });

  if (error) {
    console.error('[admin-mfa-challenge-rate-limit] record failed', error);
  }
}
