import 'server-only';

import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminEnv } from '@/lib/admin/auth';
import {
  ADMIN_LOGIN_RATE_LIMIT,
  accountActorIdentity,
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
  | {
      ok: true;
      actorFingerprint: string;
      /**
       * SEC-01 — present only when the caller passed an
       * `accountKey`. Lets recordAdminLoginAttempt write the
       * second (per-account) ledger row alongside the IP row.
       */
      accountFingerprint?: string;
    }
  | {
      ok: false;
      actorFingerprint: string;
      accountFingerprint?: string;
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

/**
 * SEC-01 — fingerprint for the per-account (email) bucket.
 * Reuses the same admin-login HMAC helper. Returns null when no
 * accountKey is supplied so the caller degrades to IP-only.
 */
function accountFingerprintFor(
  accountKey: string | null | undefined
): string | null {
  const identity = accountActorIdentity(accountKey);
  if (!identity) return null;
  const env = requireAdminEnv();
  return fingerprintAdminLoginActor(identity, env.secret);
}

/** Single indexed read of the recent attempt ledger for one fingerprint. */
async function loadRecentAttempts(
  fingerprint: string,
  since: string
): Promise<
  | { ok: true; rows: AdminLoginAttemptRow[] }
  | { ok: false }
> {
  const { data, error } = await adminLoginAttemptStore()
    .from(TABLE)
    .select('outcome, attempted_at')
    .eq('actor_fingerprint', fingerprint)
    .gte('attempted_at', since);
  if (error) {
    console.error('[admin-login-rate-limit] check failed', error);
    return { ok: false };
  }
  return { ok: true, rows: normalizeRows(data) };
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

/**
 * @param accountKey SEC-01 — optional normalized account
 *   identifier (the submitted login email). When present, a
 *   SECOND bucket keyed on its `acct:`-prefixed HMAC fingerprint
 *   is evaluated and the STRICTER of the two verdicts (IP-bucket
 *   AND account-bucket) is returned. This closes credential-
 *   stuffing against ONE admin account from rotating IPs.
 *   Omitted/blank → IP-only throttling, unchanged.
 */
export async function checkAdminLoginRateLimit(
  accountKey?: string | null
): Promise<AdminLoginRateLimitCheck> {
  const actorFingerprint = await currentActorFingerprint();
  const accountFingerprint = accountFingerprintFor(accountKey);
  const since = new Date(
    Date.now() - ADMIN_LOGIN_RATE_LIMIT.attemptWindowMs
  ).toISOString();

  // IP bucket — always evaluated (unchanged behaviour).
  const ipRows = await loadRecentAttempts(actorFingerprint, since);
  if (!ipRows.ok) {
    return {
      ok: false,
      actorFingerprint,
      ...(accountFingerprint ? { accountFingerprint } : {}),
      reason: 'storage_error',
      retryAfterSeconds: 60,
    };
  }
  const ipVerdict = evaluateAdminLoginRateLimit(ipRows.rows);
  if (!ipVerdict.ok) {
    return {
      ...ipVerdict,
      ok: false,
      actorFingerprint,
      ...(accountFingerprint ? { accountFingerprint } : {}),
    };
  }

  // Account bucket — only when an accountKey was supplied.
  if (accountFingerprint) {
    const acctRows = await loadRecentAttempts(accountFingerprint, since);
    if (!acctRows.ok) {
      return {
        ok: false,
        actorFingerprint,
        accountFingerprint,
        reason: 'storage_error',
        retryAfterSeconds: 60,
      };
    }
    const acctVerdict = evaluateAdminLoginRateLimit(acctRows.rows);
    if (!acctVerdict.ok) {
      return {
        ...acctVerdict,
        ok: false,
        actorFingerprint,
        accountFingerprint,
      };
    }
  }

  return {
    ok: true,
    actorFingerprint,
    ...(accountFingerprint ? { accountFingerprint } : {}),
  };
}

/**
 * @param accountFingerprint SEC-01 — when present (the value
 *   returned by checkAdminLoginRateLimit for an accountKey
 *   call), the same outcome is ALSO recorded under the per-
 *   account bucket so its window stays in sync with the IP
 *   window. Both rows differ only by `actor_fingerprint`.
 */
export async function recordAdminLoginAttempt(
  actorFingerprint: string,
  outcome: AdminLoginAttemptOutcome,
  accountFingerprint?: string
): Promise<void> {
  const store = adminLoginAttemptStore();
  const { error } = await store.from(TABLE).insert({
    actor_fingerprint: actorFingerprint,
    outcome,
  });
  if (error) {
    console.error('[admin-login-rate-limit] record failed', error);
  }

  if (accountFingerprint) {
    const { error: acctError } = await store.from(TABLE).insert({
      actor_fingerprint: accountFingerprint,
      outcome,
    });
    if (acctError) {
      console.error('[admin-login-rate-limit] account record failed', acctError);
    }
  }
}
