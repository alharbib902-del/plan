import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import {
  listRewardableReferrals,
  referralRewardAmounts,
} from '@/lib/clients/referral-rewards';

/**
 * Referral reward cron.
 *
 * Schedule: daily (vercel.json). Finds `signed_up` referrals whose
 * referee has completed their FIRST confirmed-paid booking and grants
 * BOTH parties cashback via `reward_referral`.
 *
 * Idempotency is intrinsic, NOT claim-based: `reward_referral` locks
 * the referral row, guards on status='rewarded', and flips it to
 * 'rewarded' in the same transaction as the two ledger writes — so a
 * second run (or an overlapping invocation) is a no-op, never a double
 * grant. No email is sent in this PR; the reward surfaces on
 * /me/referrals + the client's cashback balance.
 *
 * Auth: shared CRON_SECRET (Authorization: Bearer …) set by Vercel Cron.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const BATCH_LIMIT = 500;

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function GET(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  let candidates;
  try {
    candidates = await listRewardableReferrals(BATCH_LIMIT);
  } catch (err) {
    console.error('[cron.referral-rewards] load failed', err);
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 200 });
  }

  const amounts = referralRewardAmounts();
  const rpc = createAdminClient() as unknown as LooseRpcClient;
  let rewarded = 0;
  let skipped = 0;

  for (const c of candidates) {
    const { data, error } = await rpc.rpc('reward_referral', {
      p_referral_id: c.referral_id,
      p_referrer_reward_sar: amounts.referrer,
      p_referee_reward_sar: amounts.referee,
    });
    if (error) {
      console.error('[cron.referral-rewards] reward failed', {
        referral: c.referral_id,
        err: error,
      });
      skipped += 1;
      continue;
    }
    // reward_referral returns { ok: true } only when THIS call did the
    // grant. ok:false (not_qualified / already_rewarded race) is benign.
    const result = data as { ok?: boolean } | null;
    if (result && result.ok === true) {
      rewarded += 1;
    } else {
      skipped += 1;
    }
  }

  return NextResponse.json(
    { ok: true, candidates: candidates.length, rewarded, skipped },
    { status: 200 }
  );
}
