import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';

/**
 * Phase 7 PR 2e — expire-windows cron.
 *
 * Schedule: hourly (vercel.json). The auction window
 * boundary is a soft signal — a leg sitting at the floor
 * with status='available' for an extra hour is harmless.
 *
 * Body:
 *   1. Auth via shared CRON_SECRET helper.
 *   2. Claim every leg with `status = 'available'` AND
 *      `auction_window_end_at <= NOW()`.
 *   3. Call `expire_empty_leg_window(leg_id)` per leg.
 *      The 12th SECURITY DEFINER public (PR 2e migration
 *      §3) flips `status = 'expired'` only for legs still
 *      `available`; idempotent on any non-available state.
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
    .eq('status', 'available')
    .lte('auction_window_end_at', nowIso)
    .limit(500);

  if (claimError) {
    console.error('[cron.expire-windows] claim error', claimError);
    return NextResponse.json(
      { ok: false, error: 'claim_failed' },
      { status: 200 }
    );
  }

  const legs = legRows ?? [];
  let expired = 0;

  for (const leg of legs) {
    const { data, error } = await client.rpc('expire_empty_leg_window', {
      p_leg_id: leg.id,
    });
    if (error) {
      console.error('[cron.expire-windows] rpc error', {
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
