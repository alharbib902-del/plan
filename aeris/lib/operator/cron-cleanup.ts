// Server-side ONLY — same rationale as Phase 7 matching.ts:
// the cleanup-cron unit tests run under tsx outside Next.js
// and `'server-only'` is unresolvable there. The module is
// imported only from the four /api/cron/operator/* route
// handlers, all of which are server-only by Next.js
// convention.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';

/**
 * Phase 8 PR 2e — shared cleanup-cron runner.
 *
 * The four operator-side cleanup cron routes
 * (sessions, reset-tokens, otp-codes, signup-attempts) all
 * follow the same skeleton:
 *
 *   1. Verify CRON_SECRET via the shared Phase 7 helper.
 *   2. Call the cleanup RPC (a single .rpc() per job).
 *   3. Record the run in operator_cron_tick_history (failure
 *      to record is non-fatal; the cleanup already ran).
 *   4. Return JSON { ok, deleted_count } at HTTP 200.
 *
 * This helper centralises that skeleton so each route file
 * is a one-liner export. Centralising also keeps the audit-
 * record contract uniform: every job writes one row per run
 * with the same shape, which is what the canary-readout
 * query in lib/admin/operators/canary-queries.ts depends on.
 *
 * The job name passed in MUST match BOTH the cleanup RPC
 * function name AND the
 * operator_cron_tick_history.job_name CHECK constraint —
 * the migration's CHECK lists exactly the four job names
 * used here, so a typo would surface as an INSERT error
 * that this helper logs but does not propagate (the
 * cleanup itself already happened).
 */

export type OperatorCleanupJobName =
  | 'cleanup_expired_operator_sessions'
  | 'cleanup_expired_password_reset_tokens'
  | 'cleanup_expired_otp_codes'
  | 'cleanup_old_signup_attempts';

export async function runOperatorCleanupCron(
  req: NextRequest,
  jobName: OperatorCleanupJobName
): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  const client = createAdminClient();
  // Cast jobName to bypass the Functions-map narrowing —
  // cleanup RPCs are deliberately NOT registered in
  // database.ts because the parameterless Args shape
  // poisons inference for every other RPC. The RPC name
  // existence is enforced by the migration's CREATE
  // FUNCTION + the runtime .rpc() error path.
  const rpc = client.rpc as unknown as (
    name: string
  ) => Promise<{ data: unknown; error: { code?: string } | null }>;
  const { data, error } = await rpc(jobName);

  if (error) {
    console.error(`[cron.operator.${jobName}] rpc error`, error);
    await recordTick(
      client,
      jobName,
      0,
      false,
      `rpc_error: ${error.code ?? 'unknown'}`
    );
    return NextResponse.json(
      { ok: false, error: 'rpc_failed' },
      { status: 200 }
    );
  }

  const result = data as { ok: boolean; deleted_count?: number } | null;
  const deletedCount = result?.deleted_count ?? 0;
  await recordTick(client, jobName, deletedCount, true, null);

  return NextResponse.json(
    { ok: true, deleted_count: deletedCount },
    { status: 200 }
  );
}

async function recordTick(
  client: ReturnType<typeof createAdminClient>,
  jobName: OperatorCleanupJobName,
  deletedCount: number,
  success: boolean,
  errorLabel: string | null
): Promise<void> {
  try {
    // Cast both the rpc name and the args bag — record_operator_
    // cron_tick is intentionally NOT in the Functions map (same
    // reason as the cleanup RPCs above). The runtime contract is
    // enforced by the migration's CREATE FUNCTION signature.
    const args = {
      p_job_name: jobName,
      p_deleted_count: deletedCount,
      p_success: success,
      p_error_label: errorLabel,
    };
    const rpc = client.rpc as unknown as (
      name: string,
      args: unknown
    ) => Promise<{ error: { code?: string } | null }>;
    const { error } = await rpc('record_operator_cron_tick', args);
    if (error) {
      console.error(`[cron.operator.${jobName}] history write error`, error);
    }
  } catch (err) {
    console.error(`[cron.operator.${jobName}] history write threw`, err);
  }
}
