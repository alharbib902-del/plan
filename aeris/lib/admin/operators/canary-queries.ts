// Server-side ONLY — canary queries are consumed by the
// /admin/operators/canary page (server component). Same
// rationale as the existing lib/admin/operators/queries.ts:
// the queries unit-test under tsx, so 'server-only' import
// would break the test runner.

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 8 PR 2e — admin canary readout queries.
 *
 * Aggregates the three operational signals that
 * /admin/operators/canary surfaces:
 *
 *   1. Operator velocity (status breakdown + 24h-vs-7d
 *      signup deltas, computed against operators.created_at).
 *   2. Signup attempt mix (last 24h breakdown by result,
 *      driven by operator_signup_attempts).
 *   3. Cron tick health (last successful tick per job +
 *      most recent deleted_count, driven by
 *      operator_cron_tick_history).
 *
 * The notification alert singleton is intentionally NOT
 * re-fetched here — the canary page imports the existing
 * getOperatorNotificationAlertStatus from queries.ts so
 * the same row drives both the operators-list banner AND
 * the canary readout (one source of truth).
 *
 * Every query below is best-effort: a transient DB hiccup
 * returns a safe-default shape rather than throwing, so
 * the canary page can render even when one signal is
 * unavailable.
 */

// ============================================================
// 1. Signup velocity
// ============================================================

export interface OperatorSignupVelocity {
  total_pending: number;
  total_approved: number;
  total_suspended: number;
  total_rejected: number;
  signups_last_24h: number;
  signups_last_7d: number;
}

const ZERO_VELOCITY: OperatorSignupVelocity = {
  total_pending: 0,
  total_approved: 0,
  total_suspended: 0,
  total_rejected: 0,
  signups_last_24h: 0,
  signups_last_7d: 0,
};

export async function getOperatorSignupVelocity(): Promise<OperatorSignupVelocity> {
  noStore();
  const client = createAdminClient();

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000
  ).toISOString();

  // Status breakdown — 4 separate count queries. Each
  // uses Supabase's head:true count: 'exact' so no rows
  // travel the wire.
  const [pending, approved, suspended, rejected, last24h, last7d] =
    await Promise.all([
      countByStatus(client, 'pending'),
      countByStatus(client, 'approved'),
      countByStatus(client, 'suspended'),
      countByStatus(client, 'rejected'),
      countSignupsSince(client, dayAgo),
      countSignupsSince(client, weekAgo),
    ]);

  return {
    total_pending: pending,
    total_approved: approved,
    total_suspended: suspended,
    total_rejected: rejected,
    signups_last_24h: last24h,
    signups_last_7d: last7d,
  };
}

async function countByStatus(
  client: ReturnType<typeof createAdminClient>,
  status: 'pending' | 'approved' | 'suspended' | 'rejected'
): Promise<number> {
  try {
    const { count, error } = await client
      .from('operators')
      .select('id', { count: 'exact', head: true })
      .eq('signup_status', status);
    if (error) {
      console.error(`[canary] countByStatus(${status}) error`, error);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.error(`[canary] countByStatus(${status}) threw`, err);
    return 0;
  }
}

async function countSignupsSince(
  client: ReturnType<typeof createAdminClient>,
  sinceIso: string
): Promise<number> {
  try {
    const { count, error } = await client
      .from('operators')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso);
    if (error) {
      console.error('[canary] countSignupsSince error', error);
      return 0;
    }
    return count ?? 0;
  } catch (err) {
    console.error('[canary] countSignupsSince threw', err);
    return 0;
  }
}

export async function safeGetOperatorSignupVelocity(): Promise<OperatorSignupVelocity> {
  try {
    return await getOperatorSignupVelocity();
  } catch (err) {
    console.error('[canary] getOperatorSignupVelocity threw', err);
    return ZERO_VELOCITY;
  }
}

// ============================================================
// 2. Signup attempt mix (last 24h)
// ============================================================

export type SignupAttemptResult =
  | 'success'
  | 'duplicate_email'
  | 'rate_limited'
  | 'validation_failed';

export interface SignupAttemptMix {
  success: number;
  duplicate_email: number;
  rate_limited: number;
  validation_failed: number;
  // Total = sum of the 4 buckets. Convenience for the
  // page header so the UI does not have to recompute.
  total: number;
}

const ZERO_ATTEMPT_MIX: SignupAttemptMix = {
  success: 0,
  duplicate_email: 0,
  rate_limited: 0,
  validation_failed: 0,
  total: 0,
};

export async function getSignupAttemptMix(): Promise<SignupAttemptMix> {
  noStore();
  const client = createAdminClient();
  const dayAgo = new Date(
    Date.now() - 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    const { data, error } = await client
      .from('operator_signup_attempts')
      .select('result')
      .gte('attempted_at', dayAgo);

    if (error) {
      console.error('[canary] getSignupAttemptMix error', error);
      return ZERO_ATTEMPT_MIX;
    }

    const rows = (data ?? []) as { result: SignupAttemptResult }[];
    const mix: SignupAttemptMix = { ...ZERO_ATTEMPT_MIX, total: rows.length };
    for (const row of rows) {
      // Defensive: if the SQL ever ships a value outside the
      // four-result CHECK constraint (schema drift), it is
      // counted in `total` but skipped from the buckets so
      // the UI doesn't crash on `mix[unknown_key]`.
      if (
        row.result === 'success' ||
        row.result === 'duplicate_email' ||
        row.result === 'rate_limited' ||
        row.result === 'validation_failed'
      ) {
        mix[row.result] += 1;
      }
    }
    return mix;
  } catch (err) {
    console.error('[canary] getSignupAttemptMix threw', err);
    return ZERO_ATTEMPT_MIX;
  }
}

// ============================================================
// 3. Cron tick health
// ============================================================

export type OperatorCleanupJobName =
  | 'cleanup_expired_operator_sessions'
  | 'cleanup_expired_password_reset_tokens'
  | 'cleanup_expired_otp_codes'
  | 'cleanup_old_signup_attempts';

export const OPERATOR_CLEANUP_JOBS: readonly OperatorCleanupJobName[] = [
  'cleanup_expired_operator_sessions',
  'cleanup_expired_password_reset_tokens',
  'cleanup_expired_otp_codes',
  'cleanup_old_signup_attempts',
] as const;

export interface CronTickHealth {
  job_name: OperatorCleanupJobName;
  last_run_at: string | null;
  last_deleted_count: number | null;
  last_success: boolean | null;
  last_error_label: string | null;
  // Computed: a job is considered "stale" when its last
  // successful run is older than ~2x its expected interval.
  // The page formatter uses this to flip the row badge to
  // amber. Returns null when the job has never run.
  is_stale: boolean | null;
}

// Expected interval (in minutes) per job, used to compute
// the stale flag. Kept in sync with vercel.json.
//
// Exported so the unit-test fixture can assert the stale
// computation against the same source of truth instead of
// duplicating the constant.
export const EXPECTED_INTERVAL_MINUTES: Record<
  OperatorCleanupJobName,
  number
> = {
  cleanup_expired_operator_sessions: 360,        // every 6h
  cleanup_expired_password_reset_tokens: 360,    // every 6h
  cleanup_expired_otp_codes: 30,                 // every 30 min
  cleanup_old_signup_attempts: 360,              // every 6h
};

/**
 * Pure helper extracted from getCronTickHealth so unit tests
 * can assert the stale-flag contract without spinning up a
 * Supabase client mock. A job is "stale" when its last
 * successful run is older than 2x its expected interval —
 * one missed cron tick is normal jitter, two missed ticks
 * indicates a real outage worth surfacing in the canary.
 */
export function computeIsStale(
  job: OperatorCleanupJobName,
  ranAtIso: string,
  now: number = Date.now()
): boolean {
  const ageMs = now - new Date(ranAtIso).getTime();
  if (Number.isNaN(ageMs) || ageMs < 0) return false;
  const expectedMs = EXPECTED_INTERVAL_MINUTES[job] * 60 * 1000;
  return ageMs > 2 * expectedMs;
}

export async function getCronTickHealth(): Promise<CronTickHealth[]> {
  noStore();
  const client = createAdminClient();

  // Fetch the most recent row per job. Supabase JS client
  // does not natively support DISTINCT ON, so we fan out
  // four queries in parallel — each one ORDER BY ran_at DESC
  // LIMIT 1 with the (job_name, ran_at DESC) index.
  const results = await Promise.all(
    OPERATOR_CLEANUP_JOBS.map(async (job): Promise<CronTickHealth> => {
      try {
        const { data, error } = await client
          .from('operator_cron_tick_history')
          .select('ran_at, deleted_count, success, error_label')
          .eq('job_name', job)
          .order('ran_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error(`[canary] cron health(${job}) error`, error);
          return emptyHealthRow(job);
        }

        if (!data) return emptyHealthRow(job);

        // Cast pattern mirrors lib/admin/operators/queries.ts —
        // the hand-maintained database.ts narrows column-
        // projection results to `never`, so a structural cast
        // is needed to read the row. Same posture used by every
        // Phase 7/8 query that projects columns.
        const row = data as unknown as {
          ran_at: string;
          deleted_count: number | null;
          success: boolean;
          error_label: string | null;
        };
        const ranAtIso = String(row.ran_at);

        return {
          job_name: job,
          last_run_at: ranAtIso,
          last_deleted_count: Number(row.deleted_count ?? 0),
          last_success: Boolean(row.success),
          last_error_label:
            typeof row.error_label === 'string' ? row.error_label : null,
          is_stale: computeIsStale(job, ranAtIso),
        };
      } catch (err) {
        console.error(`[canary] cron health(${job}) threw`, err);
        return emptyHealthRow(job);
      }
    })
  );

  return results;
}

function emptyHealthRow(job: OperatorCleanupJobName): CronTickHealth {
  return {
    job_name: job,
    last_run_at: null,
    last_deleted_count: null,
    last_success: null,
    last_error_label: null,
    is_stale: null,
  };
}
