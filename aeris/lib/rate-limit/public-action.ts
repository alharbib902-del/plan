import 'server-only';

import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  PUBLIC_ACTION_LIMITS,
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
  | { ok: true; actorFingerprint: string }
  | {
      ok: false;
      actorFingerprint: string;
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

export async function checkPublicActionRateLimit(
  action: PublicAction
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

  const since = new Date(Date.now() - config.attemptWindowMs).toISOString();

  const { data, error } = await publicActionStore()
    .from(TABLE)
    .select('outcome, attempted_at')
    .eq('action', action)
    .eq('actor_fingerprint', actorFingerprint)
    .gte('attempted_at', since);

  if (error) {
    console.error('[public-action-rate-limit] check failed', { action, error });
    return {
      ok: false,
      actorFingerprint,
      reason: 'storage_error',
      retryAfterSeconds: 60,
    };
  }

  const verdict = evaluatePublicActionRateLimit(normalizeRows(data), config);
  return verdict.ok
    ? { ok: true, actorFingerprint }
    : { ...verdict, ok: false, actorFingerprint };
}

export async function recordPublicActionAttempt(
  action: PublicAction,
  actorFingerprint: string,
  outcome: PublicActionAttemptOutcome
): Promise<void> {
  if (actorFingerprint === 'unknown') return;
  const { error } = await publicActionStore().from(TABLE).insert({
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
