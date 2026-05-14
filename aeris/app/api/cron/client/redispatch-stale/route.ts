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
 * Schedule: every 6 hours (vercel.json). Re-attempts dispatch
 * for any trip whose current Phase 5 round has been open >4h
 * with zero offers received. The RPC body owns the full
 * state-cleanup transaction (cancel pending targets, close
 * stale round with `closed_reason='stale_timeout'`, NULL
 * `current_dispatch_round_id`) before re-calling
 * `auto_dispatch_trip_request` for each scanned trip. The RPC
 * also records its own tick into `operator_cron_tick_history`,
 * so this route is a thin auth + dispatch wrapper.
 *
 * Auth: shared CRON_SECRET via `verifyCronAuth` (Phase 7).
 *
 * Return shape: pass-through of the RPC's
 * `{ ok, scanned, redispatched, declined, errors }`.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

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
    const result = await looseClient.rpc('redispatch_stale_trip_requests');
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
