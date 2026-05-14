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
 * dispatch for two failure modes (Codex round 1 PR #58 P1
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
 *     `auto_dispatch_trip_request`.
 *   - **Pending-trip drain**: trips still in `status='pending'`
 *     with no `current_dispatch_round_id` whose
 *     `created_at` is older than the same threshold. These
 *     are trips whose initial fire-and-forget POST from
 *     `createAuthenticatedTripRequest` either timed out,
 *     returned non-2xx, or was skipped because
 *     `CRON_SECRET` was missing on that deploy. Without
 *     this drain a single failed initial POST stranded the
 *     trip in `pending` forever.
 *
 * Auth: shared CRON_SECRET via `verifyCronAuth` (Phase 7).
 *
 * Stale-hours threshold (Codex round 1 PR #58 P2 #4 fix):
 * read from `TRIP_REDISPATCH_STALE_HOURS` env var (default
 * 4). Pinned at the route boundary so probe 18 can lower
 * it for a fast production smoke without a migration.
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
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 4;
  return parsed;
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  const staleHours = readStaleHours();

  const client = createAdminClient();
  // Cast the WHOLE client so `.rpc(...)` is invoked AS A
  // METHOD on it, preserving the Supabase JS internal `this`
  // binding (Phase 8 PR 2e #51 hotfix discipline + convention #2).
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
    const result = await looseClient.rpc(
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
