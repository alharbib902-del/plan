import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import { isUuid } from '@/lib/utils/uuid';

/**
 * Phase 9 PR 4 — internal trip-distribution dispatch endpoint.
 *
 * POST receiver for the PR 2 `fireAndForgetTripDispatch`
 * helper. Synchronous wrapper around
 * `auto_dispatch_trip_request(p_trip_request_id, p_min_fanout)`.
 * The Server Action that fires this is best-effort; this
 * route owns durability — it logs structured rows + records
 * its own observability via the RPC's return shape (which
 * also writes `trip_distribution_log` on success).
 *
 * Auth: shared CRON_SECRET via the Phase 7 helper. The PR 2
 * fire-and-forget caller mints `Authorization: Bearer
 * ${CRON_SECRET}` so this and the cron drain share one
 * boundary.
 *
 * Auto-dispatch kill switch (Codex round 3 PR #58 P2 #2 fix +
 * convention #24 — "every entry point"): the
 * `ENABLE_TRIP_AUTO_DISTRIBUTION` flag also gates this
 * endpoint, not just the cron drain. When the flag is off
 * the route returns `{ ok: true, skipped: 'flag_disabled' }`
 * (200, so the fire-and-forget caller stays idempotent)
 * without touching any trip. The probe 19 default-off rollout
 * contract survives intact even if a stray caller already
 * has the CRON_SECRET — there is no longer a back door
 * around the rollout flag.
 *
 * Body: `{ trip_request_id: string, event: 'created' | 'redispatch' }`.
 *
 * Min fanout: read from `PHASE_9_MIN_DISPATCH_FANOUT` env
 * var (default 2). Pinned at the route boundary so the SQL
 * RPC stays a pure function of its arguments.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function readMinFanout(): number {
  const raw = process.env.PHASE_9_MIN_DISPATCH_FANOUT;
  if (!raw) return 2;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 2;
  return parsed;
}

function isAutoDistributionEnabled(): boolean {
  return process.env.ENABLE_TRIP_AUTO_DISTRIBUTION === 'true';
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  // Codex round 3 PR #58 P2 #2 fix — kill-switch covers
  // every entry point (convention #24). Even with a valid
  // CRON_SECRET, the dispatcher does NOT run while the
  // rollout flag is off.
  if (!isAutoDistributionEnabled()) {
    return NextResponse.json(
      { ok: true, skipped: 'flag_disabled' },
      { status: 200 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    console.error(
      '[trip-distribution.dispatch] body parse failed',
      err
    );
    return NextResponse.json(
      { ok: false, error: 'invalid_body' },
      { status: 400 }
    );
  }

  const tripRequestId = (body as { trip_request_id?: unknown })
    ?.trip_request_id;
  if (!isUuid(tripRequestId)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_trip_request_id' },
      { status: 400 }
    );
  }

  const minFanout = readMinFanout();

  const client = createAdminClient();
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
    const result = await looseClient.rpc('auto_dispatch_trip_request', {
      p_trip_request_id: tripRequestId,
      p_min_fanout: minFanout,
    });
    data = result.data;
    error = result.error;
  } catch (err) {
    console.error(
      '[trip-distribution.dispatch] rpc threw',
      err
    );
    return NextResponse.json(
      { ok: false, error: 'rpc_threw' },
      { status: 500 }
    );
  }

  if (error) {
    console.error('[trip-distribution.dispatch] rpc error', error);
    return NextResponse.json(
      { ok: false, error: 'rpc_failed' },
      { status: 500 }
    );
  }

  // The RPC's structured failures (e.g.
  // insufficient_unique_operators) are NOT HTTP failures —
  // they are valid business outcomes. Log them so the
  // founder triage path (Vercel Functions logs) catches the
  // rare ones, but return 200 with the RPC payload so the
  // caller stays idempotent.
  const result = data as
    | {
        ok: true;
        dispatched_count: number;
        round_id: string;
        targets: Array<unknown>;
      }
    | { ok: false; error: string; [key: string]: unknown };

  if (!result.ok) {
    console.error(
      `[trip-distribution.dispatch] structured decline: ${result.error} for trip ${tripRequestId}`,
      result
    );
  }

  return NextResponse.json(result, { status: 200 });
}
