import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 14 — referral reward processing helpers for the daily cron.
 *
 * Reward amounts are env-configured (REFERRAL_REFERRER_REWARD_SAR /
 * REFERRAL_REFEREE_REWARD_SAR), defaulting to 500 SAR each. Values are
 * sanitised here and re-validated inside `reward_referral` (defence in
 * depth): a non-numeric / non-positive / over-cap env falls back to the
 * default so a typo can never grant an absurd or zero reward.
 */

const DEFAULT_REWARD_SAR = 500;
const MAX_REWARD_SAR = 10000;

export type RewardableReferral = {
  referral_id: string;
  referee_client_id: string;
};

function looseDb(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

function readReward(raw: string | undefined): number {
  if (!raw) return DEFAULT_REWARD_SAR;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_REWARD_SAR) {
    return DEFAULT_REWARD_SAR;
  }
  return n;
}

export function referralRewardAmounts(): {
  referrer: number;
  referee: number;
} {
  return {
    referrer: readReward(process.env.REFERRAL_REFERRER_REWARD_SAR),
    referee: readReward(process.env.REFERRAL_REFEREE_REWARD_SAR),
  };
}

/**
 * signed_up referrals whose referee already has a confirmed-paid
 * booking. Every row is rewardable; `reward_referral` re-checks
 * atomically. Limit clamped server-side in the RPC.
 */
export async function listRewardableReferrals(
  limit: number
): Promise<RewardableReferral[]> {
  const { data, error } = await looseDb().rpc('list_rewardable_referrals', {
    p_limit: limit,
  });
  if (error) {
    throw new Error(`listRewardableReferrals failed: ${error.message}`);
  }
  return (data ?? []) as RewardableReferral[];
}
