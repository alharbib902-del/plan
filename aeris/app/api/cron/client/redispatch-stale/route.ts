import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';

/**
 * Phase 9 PR 4 — `redispatch_stale_trip_requests` cron.
 *
 * Schedule: every 6 hours (vercel.json). Re-attempts
 * dispatch for two failure modes (Codex PR #58 round 1 P1
 * #3 fix):
 *
 *   - **Stale-round cleanup**: trips with status IN
 *     ('distributed','offered') whose current dispatch round
 *     has been open longer than the configured threshold
 *     with zero phase5_operator_offers. The RPC body owns
 *     the full state-cleanup transaction (cancel pending
 *     targets, close stale round with
 *     `closed_reason='stale_timeout'`, NULL
 *     `current_dispatch_round_id`) before re-calling
 *     `auto_dispatch_trip_request`. If the retry fails,
 *     the trip is moved back to `status='pending'` so
 *     the next cron tick picks it up via Phase B (Codex
 *     round 2 PR #58 P1 #3 fix).
 *   - **Pending-trip drain**: trips still in `status='pending'`
 *     with no `current_dispatch_round_id` whose
 *     `created_at` is older than the same threshold AND
 *     `client_id IS NOT NULL` AND
 *     `customer_source = 'client_portal'` (Codex round 2
 *     PR #58 P1 #2 fix — restrict to PR 2 authenticated
 *     trips; legacy guest leads + admin-held manual queue
 *     items remain untouched).
 *
 * Auth: shared CRON_SECRET via `verifyCronAuth` (Phase 7).
 *
 * Auto-dispatch kill switch (Codex round 2 PR #58 P1 #1
 * fix): the `ENABLE_TRIP_AUTO_DISTRIBUTION` flag gates the
 * PR 2 fire-and-forget path AND this cron. When the flag is
 * off the cron records a `success=true / deleted_count=0 /
 * error_label='skipped:flag_disabled'` tick and returns
 * `{ ok: true, skipped: 'flag_disabled' }` without touching
 * any trip. The probe 19 default-off rollout contract
 * survives intact.
 *
 * Stale-hours threshold (Codex round 1 PR #58 P2 #4 +
 * round 2 P2 #4 fix): read from `TRIP_REDISPATCH_STALE_HOURS`
 * env var (default 4). Parsed as FLOAT so probe 18 can pass
 * `0.01` for a fast production smoke. Threshold value < 0
 * falls back to default; `0` is allowed (immediate sweep)
 * but the SQL clamps the cutoff to NOW so it cannot overshoot
 * into the future.
 *
 * Return shape: pass-through of the RPC's
 * `{ ok, scanned, scanned_stale, scanned_pending,
 *    redispatched, declined, errors, stale_hours }`.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function readStaleHours(): number {
  const raw = process.env.TRIP_REDISPATCH_STALE_HOURS;
  if (!raw) return 4;
  // parseFloat (NOT parseInt) so probe 18 can set 0.01h
  // (~36 seconds) for a fast production smoke (Codex
  // round 2 PR #58 P2 #4 fix — parseInt clamped 0.01 to
  // 0, then the prior `< 1` guard reset it to 4).
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 4;
  return parsed;
}

function isAutoDistributionEnabled(): boolean {
  return process.env.ENABLE_TRIP_AUTO_DISTRIBUTION === 'true';
}

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

async function recordSkippedTick(
  loose: LooseRpcClient
): Promise<void> {
  try {
    const { error } = await loose.rpc('record_operator_cron_tick', {
      p_job_name: 'redispatch_stale_trip_requests',
      p_deleted_count: 0,
      p_success: true,
      p_error_label: 'skipped:flag_disabled',
    });
    if (error) {
      console.error(
        '[cron.client.redispatch-stale] skipped-tick write error',
        error
      );
    }
  } catch (err) {
    console.error(
      '[cron.client.redispatch-stale] skipped-tick write threw',
      err
    );
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  const client = createAdminClient();
  // Cast the WHOLE client so `.rpc(...)` is invoked AS A
  // METHOD on it, preserving the Supabase JS internal `this`
  // binding (Phase 8 PR 2e #51 hotfix + convention #2).
  const loose = client as unknown as LooseRpcClient;

  // Codex round 2 PR #58 P1 #1 fix — kill-switch honoured.
  if (!isAutoDistributionEnabled()) {
    await recordSkippedTick(loose);
    return NextResponse.json(
      { ok: true, skipped: 'flag_disabled' },
      { status: 200 }
    );
  }

  const staleHours = readStaleHours();

  let data: unknown;
  let error: { code?: string; message?: string } | null = null;
  try {
    const result = await loose.rpc(
      'redispatch_stale_trip_requests',
      { p_stale_hours: staleHours }
    );
    data = result.data;
    error = result.error;
  } catch (err) {
    console.error(
      '[cron.client.redispatch-stale] rpc threw',
      err
    );
    return NextResponse.json(
      { ok: false, error: 'rpc_threw' },
      { status: 200 }
    );
  }

  if (error) {
    console.error('[cron.client.redispatch-stale] rpc error', error);
    return NextResponse.json(
      { ok: false, error: 'rpc_failed' },
      { status: 200 }
    );
  }

  return NextResponse.json(data, { status: 200 });
}
