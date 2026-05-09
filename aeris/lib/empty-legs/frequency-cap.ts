// Server-side ONLY — same rationale as matching.ts.
import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 7 PR 2e — frequency cap reader for the matching
 * engine.
 *
 * Two checks (Codex iteration-2 P1 #2 + iteration-6 P2 #2
 * fixes — reads from `empty_leg_notifications`, NOT the
 * legacy `notifications` table whose `user_id NOT NULL`
 * shape cannot key on guest `lead_inquiries`):
 *
 *   1. **24h rate cap** — count notifications sent to the
 *      same `lead_inquiry_id` in the last 24h. The matcher
 *      excludes a candidate when this count is >= the cap
 *      (default 1 — one notification per 24h per lead).
 *
 *   2. **Per-leg dedupe** — never notify the same customer
 *      twice on the same leg, even on `price_dropped`
 *      re-matching. Implemented via the unique
 *      `(lead_inquiry_id, leg_id)` index from PR 1 §13;
 *      this module exposes a fast EXISTS check so the
 *      matcher can filter before the INSERT (the unique
 *      index is the authoritative second line of defense
 *      per Codex iteration-5 P2 #1).
 *
 * Both helpers run under the admin client so the matcher
 * sees every row regardless of RLS posture.
 */

const NOTIFICATIONS_TABLE = 'empty_leg_notifications';
const DEFAULT_CAP_PER_24H = 1;

export interface CountInLast24hOptions {
  leadInquiryId: string;
  /** Optional override of the default cap; the matcher
   *  uses the constant DEFAULT_CAP_PER_24H. */
  capPer24h?: number;
}

export async function countNotificationsInLast24h(
  leadInquiryId: string
): Promise<number> {
  noStore();
  const client = createAdminClient();
  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from(NOTIFICATIONS_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('lead_inquiry_id', leadInquiryId)
    .gt('sent_at', cutoffIso);

  if (error) {
    console.error('[frequency-cap] count failed', error);
    throw new Error(`countNotificationsInLast24h failed: ${error.message}`);
  }
  return count ?? 0;
}

export async function isLeadOverFrequencyCap({
  leadInquiryId,
  capPer24h = DEFAULT_CAP_PER_24H,
}: CountInLast24hOptions): Promise<boolean> {
  const recent = await countNotificationsInLast24h(leadInquiryId);
  return recent >= capPer24h;
}

export async function hasNotifiedLeadOnLeg(
  leadInquiryId: string,
  legId: string
): Promise<boolean> {
  noStore();
  const client = createAdminClient();
  const { count, error } = await client
    .from(NOTIFICATIONS_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('lead_inquiry_id', leadInquiryId)
    .eq('leg_id', legId);

  if (error) {
    console.error('[frequency-cap] dedupe lookup failed', error);
    throw new Error(`hasNotifiedLeadOnLeg failed: ${error.message}`);
  }
  return (count ?? 0) > 0;
}

/**
 * Combined gate the matcher calls per (lead, leg) pair
 * before scoring it into the top-N. Returns `true` when
 * the candidate should be EXCLUDED.
 */
export async function shouldSkipCandidate(
  leadInquiryId: string,
  legId: string
): Promise<boolean> {
  const [overCap, alreadyOnLeg] = await Promise.all([
    isLeadOverFrequencyCap({ leadInquiryId }),
    hasNotifiedLeadOnLeg(leadInquiryId, legId),
  ]);
  return overCap || alreadyOnLeg;
}

export const FREQUENCY_CAP_PER_24H = DEFAULT_CAP_PER_24H;
