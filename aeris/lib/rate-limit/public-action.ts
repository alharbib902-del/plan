import 'server-only';

import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  PUBLIC_ACTION_LIMITS,
  accountActorIdentity,
  actorIdentityFromHeaders,
  evaluatePublicActionRateLimit,
  fingerprintPublicActionActor,
  type PublicAction,
  type PublicActionAttemptOutcome,
  type PublicActionAttemptRow,
  type PublicActionRateLimitVerdict,
} from '@/lib/rate-limit/public-action-core';

/**
 * Public-action rate-limit server binding. Mirrors
 * lib/admin/login-rate-limit.ts but scoped per-action.
 *
 * Fingerprint secret resolution:
 *   1. RATE_LIMIT_FINGERPRINT_SECRET (preferred, dedicated env)
 *   2. CRON_SECRET (always present in every env; safe fallback
 *      because it has the same trust boundary — only the
 *      service knows it).
 *
 * Fail-closed on storage error so an availability incident in
 * Supabase doesn't open a rate-limit bypass.
 */

const TABLE = 'public_action_attempts';

type PublicActionAttemptStore = {
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

export type PublicActionRateLimitCheck =
  | {
      ok: true;
      actorFingerprint: string;
      /**
       * SEC-01 — present only when the caller passed an
       * `accountKey`. Lets recordPublicActionAttempt write the
       * second (per-account) ledger row alongside the IP row.
       */
      accountFingerprint?: string;
    }
  | {
      ok: false;
      actorFingerprint: string;
      accountFingerprint?: string;
      reason:
        | Exclude<PublicActionRateLimitVerdict, { ok: true }>['reason']
        | 'storage_error'
        | 'secret_missing';
      retryAfterSeconds: number;
    };

function fingerprintSecret(): string | null {
  const dedicated = process.env.RATE_LIMIT_FINGERPRINT_SECRET;
  if (dedicated && dedicated.trim().length >= 16) return dedicated.trim();
  const cron = process.env.CRON_SECRET;
  if (cron && cron.trim().length >= 16) return cron.trim();
  return null;
}

function publicActionStore(): PublicActionAttemptStore {
  return createAdminClient() as unknown as PublicActionAttemptStore;
}

async function currentActorFingerprint(
  action: PublicAction
): Promise<string | null> {
  const secret = fingerprintSecret();
  if (!secret) return null;
  const h = await headers();
  const identity = actorIdentityFromHeaders({
    vercelForwardedFor: h.get('x-vercel-forwarded-for'),
    forwardedFor: h.get('x-forwarded-for'),
    realIp: h.get('x-real-ip'),
    cfConnectingIp: h.get('cf-connecting-ip'),
    userAgent: h.get('user-agent'),
  });
  return fingerprintPublicActionActor(identity, action, secret);
}

/**
 * SEC-01 — fingerprint for the per-account bucket. Derived from
 * the submitted login email via the SAME per-action HMAC helper
 * (so the same email appears as different fingerprints across
 * actions). Returns null when no usable secret or accountKey is
 * present so the caller silently degrades to IP-only throttling.
 */
function accountFingerprintFor(
  action: PublicAction,
  accountKey: string | null | undefined
): string | null {
  const secret = fingerprintSecret();
  if (!secret) return null;
  const identity = accountActorIdentity(accountKey);
  if (!identity) return null;
  return fingerprintPublicActionActor(identity, action, secret);
}

/** Single indexed read of the recent attempt ledger for one fingerprint. */
async function loadRecentAttempts(
  action: PublicAction,
  fingerprint: string,
  since: string
): Promise<
  | { ok: true; rows: PublicActionAttemptRow[] }
  | { ok: false }
> {
  const { data, error } = await publicActionStore()
    .from(TABLE)
    .select('outcome, attempted_at')
    .eq('action', action)
    .eq('actor_fingerprint', fingerprint)
    .gte('attempted_at', since);
  if (error) {
    console.error('[public-action-rate-limit] check failed', { action, error });
    return { ok: false };
  }
  return { ok: true, rows: normalizeRows(data) };
}

function normalizeRows(rows: unknown[] | null): PublicActionAttemptRow[] {
  return (rows ?? []).flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const candidate = row as Partial<PublicActionAttemptRow>;
    if (
      typeof candidate.outcome !== 'string' ||
      typeof candidate.attempted_at !== 'string'
    ) {
      return [];
    }
    return [
      {
        outcome: candidate.outcome as PublicActionAttemptOutcome,
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
 *   stuffing against ONE account from rotating IPs, which the
 *   IP-only bucket cannot catch. Omitted/blank → IP-only
 *   throttling, unchanged.
 */
export async function checkPublicActionRateLimit(
  action: PublicAction,
  accountKey?: string | null
): Promise<PublicActionRateLimitCheck> {
  const config = PUBLIC_ACTION_LIMITS[action];
  const actorFingerprint = await currentActorFingerprint(action);
  if (!actorFingerprint) {
    console.error(
      '[public-action-rate-limit] fingerprint secret missing — denying',
      { action }
    );
    return {
      ok: false,
      actorFingerprint: 'unknown',
      reason: 'secret_missing',
      retryAfterSeconds: 60,
    };
  }

  const accountFingerprint = accountFingerprintFor(action, accountKey);
  const since = new Date(Date.now() - config.attemptWindowMs).toISOString();

  // IP bucket — always evaluated (unchanged behaviour).
  const ipRows = await loadRecentAttempts(action, actorFingerprint, since);
  if (!ipRows.ok) {
    return {
      ok: false,
      actorFingerprint,
      ...(accountFingerprint ? { accountFingerprint } : {}),
      reason: 'storage_error',
      retryAfterSeconds: 60,
    };
  }
  const ipVerdict = evaluatePublicActionRateLimit(ipRows.rows, config);
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
    const acctRows = await loadRecentAttempts(action, accountFingerprint, since);
    if (!acctRows.ok) {
      return {
        ok: false,
        actorFingerprint,
        accountFingerprint,
        reason: 'storage_error',
        retryAfterSeconds: 60,
      };
    }
    const acctVerdict = evaluatePublicActionRateLimit(acctRows.rows, config);
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
 *   returned by checkPublicActionRateLimit for an accountKey
 *   call), the same outcome is ALSO recorded under the per-
 *   account bucket so its window stays in sync with the IP
 *   window. Both rows share the `action` + `outcome`; they
 *   differ only by `actor_fingerprint`, which the existing
 *   (action, actor_fingerprint, attempted_at) index already
 *   serves.
 */
export async function recordPublicActionAttempt(
  action: PublicAction,
  actorFingerprint: string,
  outcome: PublicActionAttemptOutcome,
  accountFingerprint?: string
): Promise<void> {
  const store = publicActionStore();
  if (actorFingerprint !== 'unknown') {
    const { error } = await store.from(TABLE).insert({
      action,
      actor_fingerprint: actorFingerprint,
      outcome,
    });
    if (error) {
      console.error('[public-action-rate-limit] record failed', {
        action,
        error,
      });
    }
  }

  if (accountFingerprint && accountFingerprint !== 'unknown') {
    const { error } = await store.from(TABLE).insert({
      action,
      actor_fingerprint: accountFingerprint,
      outcome,
    });
    if (error) {
      console.error('[public-action-rate-limit] account record failed', {
        action,
        error,
      });
    }
  }
}
