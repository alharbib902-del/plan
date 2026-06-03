import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import { captureCronError } from '@/lib/monitoring/operational';

/**
 * Phase 7 PR 2e — expire-reservations cron.
 *
 * Schedule: every 5 minutes (vercel.json). Tighter than
 * the dutch-auction-tick cron because a held leg is
 * unsellable until the reservation expires.
 *
 * Body:
 *   1. Auth via shared CRON_SECRET helper.
 *   2. Claim every leg with `status = 'reserved'` AND
 *      `reservation_expires_at <= NOW()`.
 *   3. Call `expire_empty_leg_reservation(leg_id)` per leg.
 *      The RPC clears reservation columns and flips status
 *      back to 'available' (Codex iteration-1 P1 #3 +
 *      iteration-3 P1 #2 contracts: cron-only path).
 *   4. Returns `{ ok: true, expired }`.
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
  const nowIso = new Date().toISOString();

  const { data: legRows, error: claimError } = await client
    .from('empty_legs')
    .select('id')
    .eq('status', 'reserved')
    .lte('reservation_expires_at', nowIso)
    .limit(500);

  if (claimError) {
    console.error('[cron.expire-reservations] claim error', claimError);
    await captureCronError('empty-legs.expire-reservations', claimError);
    return NextResponse.json(
      { ok: false, error: 'claim_failed' },
      { status: 200 }
    );
  }

  const legs = legRows ?? [];
  let expired = 0;

  for (const leg of legs) {
    const { data, error } = await client.rpc('expire_empty_leg_reservation', {
      p_leg_id: leg.id,
    });
    if (error) {
      console.error('[cron.expire-reservations] rpc error', {
        leg: leg.id,
        err: error,
      });
      continue;
    }
    const result = data as { ok: boolean; no_op?: boolean } | null;
    if (result?.ok && !result.no_op) {
      expired += 1;
    }
  }

  return NextResponse.json(
    { ok: true, expired, total_claimed: legs.length },
    { status: 200 }
  );
}
