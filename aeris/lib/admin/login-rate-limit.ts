import 'server-only';

import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminEnv } from '@/lib/admin/auth';
import {
  ADMIN_LOGIN_RATE_LIMIT,
  actorIdentityFromHeaders,
  evaluateAdminLoginRateLimit,
  fingerprintAdminLoginActor,
  type AdminLoginAttemptOutcome,
  type AdminLoginAttemptRow,
  type AdminLoginRateLimitVerdict,
} from '@/lib/admin/login-rate-limit-core';

const TABLE = 'admin_login_attempts';

type AdminLoginAttemptStore = {
  from: (table: string) => {
    select: (columns: string) => {
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
    insert: (
      row: Record<string, unknown>
    ) => Promise<{ error: { message?: string } | null }>;
  };
};

export type AdminLoginRateLimitCheck =
  | { ok: true; actorFingerprint: string }
  | {
      ok: false;
      actorFingerprint: string;
      reason:
        | Exclude<AdminLoginRateLimitVerdict, { ok: true }>['reason']
        | 'storage_error';
      retryAfterSeconds: number;
    };

function adminLoginAttemptStore(): AdminLoginAttemptStore {
  return createAdminClient() as unknown as AdminLoginAttemptStore;
}

async function currentActorFingerprint(): Promise<string> {
  const env = requireAdminEnv();
  const h = await headers();
  const identity = actorIdentityFromHeaders({
    vercelForwardedFor: h.get('x-vercel-forwarded-for'),
    forwardedFor: h.get('x-forwarded-for'),
    realIp: h.get('x-real-ip'),
    cfConnectingIp: h.get('cf-connecting-ip'),
    userAgent: h.get('user-agent'),
  });
  return fingerprintAdminLoginActor(identity, env.secret);
}

function normalizeRows(rows: unknown[] | null): AdminLoginAttemptRow[] {
  return (rows ?? []).flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const candidate = row as Partial<AdminLoginAttemptRow>;
    if (
      typeof candidate.outcome !== 'string' ||
      typeof candidate.attempted_at !== 'string'
    ) {
      return [];
    }
    return [
      {
        outcome: candidate.outcome as AdminLoginAttemptOutcome,
        attempted_at: candidate.attempted_at,
      },
    ];
  });
}

export async function checkAdminLoginRateLimit(): Promise<AdminLoginRateLimitCheck> {
  const actorFingerprint = await currentActorFingerprint();
  const since = new Date(
    Date.now() - ADMIN_LOGIN_RATE_LIMIT.attemptWindowMs
  ).toISOString();

  const { data, error } = await adminLoginAttemptStore()
    .from(TABLE)
    .select('outcome, attempted_at')
    .eq('actor_fingerprint', actorFingerprint)
    .gte('attempted_at', since);

  if (error) {
    console.error('[admin-login-rate-limit] check failed', error);
    return {
      ok: false,
      actorFingerprint,
      reason: 'storage_error',
      retryAfterSeconds: 60,
    };
  }

  const verdict = evaluateAdminLoginRateLimit(normalizeRows(data));
  return verdict.ok
    ? { ok: true, actorFingerprint }
    : { ...verdict, ok: false, actorFingerprint };
}

export async function recordAdminLoginAttempt(
  actorFingerprint: string,
  outcome: AdminLoginAttemptOutcome
): Promise<void> {
  const { error } = await adminLoginAttemptStore().from(TABLE).insert({
    actor_fingerprint: actorFingerprint,
    outcome,
  });

  if (error) {
    console.error('[admin-login-rate-limit] record failed', error);
  }
}
