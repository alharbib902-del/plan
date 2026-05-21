// Server-side ONLY — same rationale as
// lib/empty-legs/matching.ts: the structural tests would
// otherwise fail under tsx outside Next.js. The
// createAdminClient import enforces the server boundary; a
// client-side import of supabase/admin throws at runtime.

import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminEnv } from '@/lib/admin/auth';
import {
  ADMIN_MFA_CHALLENGE_RATE_LIMIT,
  evaluateAdminMfaChallengeRateLimit,
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
        eq: (column: string, value: string) => {
          gte: (
            column: string,
            value: string
          ) => Promise<{
            data: unknown[] | null;
            error: { message?: string } | null;
          }>;
        };
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

function currentActorFingerprint(adminUserId: string): string {
  const env = requireAdminEnv();
  const h = headers();
  const identity = actorIdentityFromHeaders({
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

export async function checkAdminMfaChallengeRateLimit(
  adminUserId: string
): Promise<AdminMfaChallengeRateLimitCheck> {
  const actorFingerprint = currentActorFingerprint(adminUserId);
  const since = new Date(
    Date.now() - ADMIN_MFA_CHALLENGE_RATE_LIMIT.attemptWindowMs
  ).toISOString();

  const { data, error } = await attemptStore()
    .from(TABLE)
    .select('outcome, attempted_at')
    .eq('actor_fingerprint', actorFingerprint)
    .eq('admin_user_id', adminUserId)
    .gte('attempted_at', since);

  if (error) {
    console.error('[admin-mfa-challenge-rate-limit] check failed', error);
    return {
      ok: false,
      actorFingerprint,
      reason: 'storage_error',
      retryAfterSeconds: 60,
    };
  }

  const verdict = evaluateAdminMfaChallengeRateLimit(normalizeRows(data));
  return verdict.ok
    ? { ok: true, actorFingerprint }
    : { ...verdict, ok: false, actorFingerprint };
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
