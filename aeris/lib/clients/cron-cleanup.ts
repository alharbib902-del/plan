// Server-side ONLY — same rationale as Phase 8 PR 2e
// lib/operator/cron-cleanup.ts: the module is imported only
// from the three /api/cron/client/* route handlers, all of
// which are server-only by Next.js convention.

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';

/**
 * Phase 9 PR 1 — shared cleanup-cron runner for client-side
 * cleanup RPCs.
 *
 * Mirror of `lib/operator/cron-cleanup.ts` (Phase 8 PR 2e
 * hotfix #2). Same posture:
 *
 *   1. Verify CRON_SECRET via the shared Phase 7 helper.
 *   2. Call the cleanup RPC. The cast goes through the
 *      WHOLE client (not by extracting `client.rpc`) so the
 *      Supabase JS internal `this` binding is preserved
 *      (Phase 8 PR #51 round-1 fix).
 *   3. Record the run in `operator_cron_tick_history` via
 *      `record_operator_cron_tick` — same audit table as
 *      the operator-side cleanup jobs; the table name keeps
 *      `operator_` prefix for historical accuracy
 *      (PR 9 spec §3.9).
 *   4. Return JSON `{ ok, deleted_count }` at HTTP 200.
 *
 * The job name passed in MUST match BOTH the cleanup RPC
 * function name AND the operator_cron_tick_history.job_name
 * CHECK constraint (extended in the PR 1 migration).
 */

export type ClientCleanupJobName =
  | 'cleanup_expired_client_sessions'
  | 'cleanup_expired_client_password_reset_tokens'
  | 'cleanup_old_client_signup_attempts';

export async function runClientCleanupCron(
  req: NextRequest,
  jobName: ClientCleanupJobName
): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  const client = createAdminClient();
  // Cast the WHOLE client so `.rpc(...)` is invoked AS A
  // METHOD on it, preserving the Supabase JS internal `this`
  // binding (Phase 8 PR #51 hotfix discipline).
  const looseClient = client as unknown as {
    rpc: (
      name: string,
      args?: Record<string, unknown>
    ) => Promise<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>;
  };

  let data: unknown;
  let error: { code?: string; message?: string } | null = null;
  try {
    const result = await looseClient.rpc(jobName);
    data = result.data;
    error = result.error;
  } catch (err) {
    console.error(`[cron.client.${jobName}] rpc threw`, err);
    await recordTick(
      client,
      jobName,
      0,
      false,
      `rpc_threw: ${err instanceof Error ? err.message : 'unknown'}`
    );
    return NextResponse.json(
      { ok: false, error: 'rpc_threw' },
      { status: 200 }
    );
  }

  if (error) {
    console.error(`[cron.client.${jobName}] rpc error`, error);
    await recordTick(
      client,
      jobName,
      0,
      false,
      `rpc_error: ${error.code ?? error.message ?? 'unknown'}`
    );
    return NextResponse.json(
      { ok: false, error: 'rpc_failed' },
      { status: 200 }
    );
  }

  const rpcResult = data as { ok: boolean; deleted_count?: number } | null;
  const deletedCount = rpcResult?.deleted_count ?? 0;
  await recordTick(client, jobName, deletedCount, true, null);

  return NextResponse.json(
    { ok: true, deleted_count: deletedCount },
    { status: 200 }
  );
}

async function recordTick(
  client: ReturnType<typeof createAdminClient>,
  jobName: ClientCleanupJobName,
  deletedCount: number,
  success: boolean,
  errorLabel: string | null
): Promise<void> {
  try {
    const looseClient = client as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>
      ) => Promise<{ error: { code?: string } | null }>;
    };
    const { error } = await looseClient.rpc('record_operator_cron_tick', {
      p_job_name: jobName,
      p_deleted_count: deletedCount,
      p_success: success,
      p_error_label: errorLabel,
    });
    if (error) {
      console.error(`[cron.client.${jobName}] history write error`, error);
    }
  } catch (err) {
    console.error(`[cron.client.${jobName}] history write threw`, err);
  }
}
