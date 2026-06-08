import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import { captureCronError } from '@/lib/monitoring/operational';

/**
 * Phase 7 PR 2e — Dutch-auction tick cron.
 *
 * Schedule: every 30 minutes (vercel.json).
 *
 * Body:
 *   1. Auth via shared CRON_SECRET helper.
 *   2. Claim every leg with `status = 'available'` AND
 *      (`last_price_drop_at IS NULL` OR
 *       `last_price_drop_at < NOW() − 30 minutes`).
 *   3. Call `tick_empty_leg_dutch_auction(leg_id)` per
 *      leg. Each tick recomputes the current price along
 *      the Dutch-auction curve and, if the price actually
 *      dropped, fires a `price_dropped` event into
 *      `empty_leg_events_outbox` (via the RPC's body in
 *      PR 2a + this PR's outbox writer). The match-trigger
 *      cron drains the outbox.
 *   4. Returns `{ ok: true, ticked, fired }`.
 *
 * No retry-on-failure inside the route; a leg that
 * errors stays untouched and the next 30-min tick will
 * re-attempt. Errors are logged but do not 5xx the
 * route — Vercel Cron retries the route on 5xx, which
 * would compound load.
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
  const cutoffIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: legRows, error: claimError } = await client
    .from('empty_legs')
    .select('id, last_price_drop_at')
    .eq('status', 'available')
    .or(`last_price_drop_at.is.null,last_price_drop_at.lt.${cutoffIso}`)
    .limit(500);

  if (claimError) {
    console.error('[cron.dutch-auction-tick] claim error', claimError);
    await captureCronError('empty-legs.dutch-auction-tick', claimError);
    return NextResponse.json({ ok: false, error: 'claim_failed' }, { status: 200 });
  }

  const legs = legRows ?? [];
  let ticked = 0;
  let fired = 0;

  for (const leg of legs) {
    const { data, error } = await client.rpc('tick_empty_leg_dutch_auction', {
      p_leg_id: leg.id,
    });
    if (error) {
      console.error('[cron.dutch-auction-tick] rpc error', {
        leg: leg.id,
        err: error,
      });
      continue;
    }
    ticked += 1;
    const result = data as {
      ok: boolean;
      fired_event?: boolean;
    } | null;
    if (result?.ok && result.fired_event) {
      fired += 1;
    }
  }

  return NextResponse.json(
    { ok: true, ticked, fired, total_claimed: legs.length },
    { status: 200 }
  );
}
