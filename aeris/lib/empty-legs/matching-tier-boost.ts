/**
 * Phase 13 PR 3 — Empty-Legs tier-boost eligibility (D13 + D27).
 *
 * Pure module: no DB, no env, no clock dependency unless passed.
 * Lives in the empty-legs matching engine because the boost
 * decision belongs to the matcher's per-candidate filter (per
 * spec §3.7). Caller wires the env-flag check
 * (`ENABLE_PRIVILEGE='true'`) and the candidate's
 * `privilege_tier` lookup.
 *
 * Model:
 *   - Each tier ships an `empty_legs_boost_hours` value in
 *     `privilege_tier_thresholds` (PR 1 seed):
 *       silver=0, gold=2, platinum=6, diamond=12.
 *   - `boost_hours` is the HEAD START a tier gets over Silver
 *     (FCFS). Effective opening per leg:
 *       T_fcfs        = published_at + MAX(boost_hours)
 *       T_open(tier)  = T_fcfs - boost_hours(tier)
 *     Examples (max boost = 12h):
 *       Diamond  → T_open = T0
 *       Platinum → T_open = T0 + 6h
 *       Gold     → T_open = T0 + 10h
 *       Silver   → T_open = T0 + 12h (FCFS)
 *
 * D27 (per leg, per client) UNIQUE on client_empty_leg_matches
 * guarantees one notification per (leg, client) — the cron
 * runs every 30 min, so a Silver client whose tier opens at
 * T0+12h will be picked up on the FIRST tick AFTER FCFS opens.
 * No replay/dup because the UNIQUE insert fails on the second
 * tick (the matcher's frequency-cap path also drops them).
 *
 * Test contract (Probe 47 in spec §11):
 *   - Diamond at T0+0    → eligible, boost_applied=12
 *   - Platinum at T0+5h  → NOT eligible (T_open=T0+6h)
 *   - Platinum at T0+7h  → eligible, boost_applied=6
 *   - Silver at T0+11h   → NOT eligible (T_open=T0+12h)
 *   - Silver at T0+12h   → eligible, boost_applied=0
 *   - thresholds=[] / null tier → fallback eligible (no gating)
 */

import type { ClientPrivilegeTier } from '@/lib/privilege/types';

export interface TierBoostRule {
  tier: ClientPrivilegeTier;
  empty_legs_boost_hours: number;
}

export type TierBoostDecision =
  | {
      eligible: true;
      /**
       * Boost hours recorded into `client_empty_leg_matches.boost_hours_applied`.
       * 0 = matched after FCFS opened (no head-start advantage used).
       * >0 = matched during their tier's head-start window.
       */
      boost_hours_applied: number;
      reason: 'fcfs_open' | 'tier_window_open' | 'no_gating';
    }
  | {
      eligible: false;
      reason: 'tier_window_not_yet_open';
      tier_opens_at_iso: string;
    };

function findBoostForTier(
  tier: ClientPrivilegeTier,
  thresholds: TierBoostRule[]
): number {
  for (const r of thresholds) {
    if (r.tier === tier) return r.empty_legs_boost_hours;
  }
  // Tier not present in thresholds → conservative: zero boost.
  return 0;
}

function maxBoostAcross(thresholds: TierBoostRule[]): number {
  let max = 0;
  for (const r of thresholds) {
    if (r.empty_legs_boost_hours > max) max = r.empty_legs_boost_hours;
  }
  return max;
}

export function decideTierBoostEligibility(args: {
  publishedAt: Date | string;
  now?: Date;
  clientTier: ClientPrivilegeTier | null;
  thresholds: TierBoostRule[];
}): TierBoostDecision {
  // No gating if thresholds table is empty (defensive — e.g.
  // before the PR 1 seed runs in a fresh dev DB).
  if (args.thresholds.length === 0) {
    return {
      eligible: true,
      boost_hours_applied: 0,
      reason: 'no_gating',
    };
  }

  // Null tier (client missing privilege row) → treat as silver
  // (lowest tier) so they only match in FCFS. NOT eligible if
  // FCFS hasn't opened yet.
  const tier: ClientPrivilegeTier = args.clientTier ?? 'silver';

  const publishedMs =
    args.publishedAt instanceof Date
      ? args.publishedAt.getTime()
      : new Date(args.publishedAt).getTime();
  const nowMs = (args.now ?? new Date()).getTime();

  if (!Number.isFinite(publishedMs)) {
    // Bad publishedAt → fail open (allow match). The DB UNIQUE
    // still prevents double-notify.
    return {
      eligible: true,
      boost_hours_applied: 0,
      reason: 'no_gating',
    };
  }

  const maxBoostMs = maxBoostAcross(args.thresholds) * 60 * 60 * 1000;
  const tierBoostMs = findBoostForTier(tier, args.thresholds) * 60 * 60 * 1000;

  // T_fcfs = T0 + max_boost. After this point, every tier
  // (including silver) is eligible.
  const fcfsAtMs = publishedMs + maxBoostMs;
  if (nowMs >= fcfsAtMs) {
    return {
      eligible: true,
      boost_hours_applied: 0,
      reason: 'fcfs_open',
    };
  }

  // T_open(tier) = T_fcfs - boost(tier).
  const tierOpensAtMs = fcfsAtMs - tierBoostMs;
  if (nowMs >= tierOpensAtMs) {
    return {
      eligible: true,
      // Boost hours applied = how many hours of head-start the
      // tier IS using vs FCFS. Diamond at T0 → 12h applied.
      // Platinum at T0+6h → 6h applied. Etc.
      boost_hours_applied: Math.round(tierBoostMs / (60 * 60 * 1000)),
      reason: 'tier_window_open',
    };
  }

  return {
    eligible: false,
    reason: 'tier_window_not_yet_open',
    tier_opens_at_iso: new Date(tierOpensAtMs).toISOString(),
  };
}
