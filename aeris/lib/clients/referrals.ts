import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 14 — client-surface reads for the referral program.
 *
 * The referral tables are intentionally NOT in `types/database.ts`
 * (loose-client pattern, mirrors `lib/empty-legs/alerts.ts`): the
 * service-role admin client reads them and we cast to the row shapes
 * below. Security is enforced at THIS layer — every read is pinned to
 * the session-derived `clientId`; the tables themselves are deny-all
 * RLS so anon/authenticated cannot reach them via PostgREST.
 */

export type ReferralStatus = 'signed_up' | 'rewarded';

export type MyReferralRow = {
  id: string;
  status: ReferralStatus;
  referrer_reward_sar: number | null;
  created_at: string;
  rewarded_at: string | null;
};

type RawReferralRow = {
  id: string;
  status: ReferralStatus;
  referrer_reward_sar: number | string | null;
  created_at: string;
  rewarded_at: string | null;
};

const REFERRAL_COLUMNS = 'id, status, referrer_reward_sar, created_at, rewarded_at';

function looseDb(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/**
 * Returns the client's referral code, minting one on first call.
 * Idempotent (get-or-create). Returns null only on RPC failure so the
 * page can show a soft "try later" state instead of crashing.
 */
export async function getOrCreateReferralCode(
  clientId: string
): Promise<string | null> {
  const { data, error } = await looseDb().rpc('get_or_create_referral_code', {
    p_client_id: clientId,
  });
  if (error) {
    console.error('[referrals] get_or_create_referral_code failed', error);
    return null;
  }
  return typeof data === 'string' && data.length > 0 ? data : null;
}

/**
 * The caller's referrals (as the referrer), newest first. DECIMAL
 * columns arrive as strings over PostgREST → coerced to numbers.
 * Referee identity is deliberately NOT selected (privacy).
 */
export async function listMyReferrals(
  clientId: string
): Promise<MyReferralRow[]> {
  const { data, error } = await looseDb()
    .from('client_referrals')
    .select(REFERRAL_COLUMNS)
    .eq('referrer_client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(`listMyReferrals failed: ${error.message}`);
  }
  const rows = (data ?? []) as RawReferralRow[];
  return rows.map((r): MyReferralRow => ({
    id: r.id,
    status: r.status,
    referrer_reward_sar:
      r.referrer_reward_sar == null ? null : Number(r.referrer_reward_sar),
    created_at: r.created_at,
    rewarded_at: r.rewarded_at,
  }));
}
