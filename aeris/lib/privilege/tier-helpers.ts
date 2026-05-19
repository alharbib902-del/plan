/**
 * Phase 13 PR 1 — Pure tier helpers.
 *
 * JS mirrors of the SQL helpers (tier_rank, step_down_one). Used
 * client-side for UI logic (tier badges, progress bars, next-tier
 * computations) so we don't round-trip to DB for simple lookups.
 *
 * IMPORTANT: keep these in lock-step with the SQL helpers in
 * 20260519000043_phase_13_pr_1_privilege_intake.sql. Tests in
 * lib/privilege/__tests__/tier-helpers.test.ts assert the JS
 * and SQL produce the same outputs.
 */

import { TIER_RANK, TIER_ORDER, type ClientPrivilegeTier } from './types';

/**
 * Returns 1-4 for silver-diamond. Throws on unknown input — the
 * type system narrows callers, but defense-in-depth for runtime
 * JSONB envelopes.
 */
export function tierRank(t: ClientPrivilegeTier): number {
  const rank = TIER_RANK[t];
  if (rank === undefined) {
    throw new Error(`tierRank: unknown tier '${t}'`);
  }
  return rank;
}

/**
 * Step down one tier (diamond→platinum, platinum→gold, gold→silver,
 * silver→silver). Mirrors SQL step_down_one — silver is the floor.
 */
export function stepDownOne(t: ClientPrivilegeTier): ClientPrivilegeTier {
  switch (t) {
    case 'diamond':
      return 'platinum';
    case 'platinum':
      return 'gold';
    case 'gold':
      return 'silver';
    case 'silver':
      return 'silver';
  }
}

/**
 * The next tier UP (silver→gold, ..., diamond→diamond). Used in
 * /me/privilege "progress to next" UI.
 */
export function stepUpOne(t: ClientPrivilegeTier): ClientPrivilegeTier {
  switch (t) {
    case 'silver':
      return 'gold';
    case 'gold':
      return 'platinum';
    case 'platinum':
      return 'diamond';
    case 'diamond':
      return 'diamond';
  }
}

/**
 * Compare two tiers; returns -1, 0, or +1 per standard compare.
 */
export function compareTiers(
  a: ClientPrivilegeTier,
  b: ClientPrivilegeTier
): -1 | 0 | 1 {
  const ra = tierRank(a);
  const rb = tierRank(b);
  if (ra < rb) return -1;
  if (ra > rb) return 1;
  return 0;
}

/**
 * Returns true if `a` is at OR above `b` (e.g. platinum >= gold).
 */
export function tierAtOrAbove(
  a: ClientPrivilegeTier,
  b: ClientPrivilegeTier
): boolean {
  return tierRank(a) >= tierRank(b);
}

/**
 * Returns the minimum spend (in SAR) required to enter a tier.
 * These thresholds match the seeded privilege_tier_thresholds rows
 * in the PR 1 migration (D3 from spec).
 *
 * Centralised here so UI doesn't hit DB to render the static
 * tier-comparison table on /privilege.
 */
export const TIER_MIN_SPEND_SAR: Record<ClientPrivilegeTier, number> = {
  silver: 0,
  gold: 100_000,
  platinum: 500_000,
  diamond: 2_000_000,
};

/**
 * Returns the cashback % for a tier (5/8/12/15 per D4).
 */
export const TIER_CASHBACK_PCT: Record<ClientPrivilegeTier, number> = {
  silver: 5,
  gold: 8,
  platinum: 12,
  diamond: 15,
};

/**
 * Given current tier and current qualified spend, returns the
 * progress fraction (0-1) toward the next tier. Used by the
 * progress bar on /me/privilege.
 *
 * Examples:
 *   gold @ 200k spend → progress to platinum (500k) → (200-100)/(500-100) = 0.25
 *   diamond @ 5M spend → returns 1.0 (no next tier)
 */
export function progressToNextTier(
  currentTier: ClientPrivilegeTier,
  qualifiedSpendSar: number
): number {
  const nextTier = stepUpOne(currentTier);
  if (nextTier === currentTier) {
    // Already at top
    return 1.0;
  }
  const currentThreshold = TIER_MIN_SPEND_SAR[currentTier];
  const nextThreshold = TIER_MIN_SPEND_SAR[nextTier];
  const span = nextThreshold - currentThreshold;
  if (span <= 0) return 1.0;
  const climbed = Math.max(0, qualifiedSpendSar - currentThreshold);
  return Math.min(1, climbed / span);
}

/**
 * SAR amount remaining to reach the next tier. Returns 0 for diamond
 * (or for spends already past the next threshold — caller should
 * combine with `progressToNextTier` to decide what to render).
 */
export function spendRemainingToNextTier(
  currentTier: ClientPrivilegeTier,
  qualifiedSpendSar: number
): number {
  const nextTier = stepUpOne(currentTier);
  if (nextTier === currentTier) return 0;
  const nextThreshold = TIER_MIN_SPEND_SAR[nextTier];
  return Math.max(0, nextThreshold - qualifiedSpendSar);
}

/**
 * Given a candidate qualified spend, returns the tier they would
 * land on per the threshold table. Used by admin "preview" tools
 * and by the JS-side spend-window unit tests that simulate the
 * SQL evaluate_client_privilege_tier branching.
 */
export function tierForSpend(qualifiedSpendSar: number): ClientPrivilegeTier {
  if (qualifiedSpendSar >= TIER_MIN_SPEND_SAR.diamond) return 'diamond';
  if (qualifiedSpendSar >= TIER_MIN_SPEND_SAR.platinum) return 'platinum';
  if (qualifiedSpendSar >= TIER_MIN_SPEND_SAR.gold) return 'gold';
  return 'silver';
}

/**
 * Returns true if this tier is grace-eligible for downgrade (i.e.,
 * not at the silver floor). Silver clients never enter a grace
 * window because there's no lower tier (F3 fix).
 */
export function tierGraceEligible(t: ClientPrivilegeTier): boolean {
  return t !== 'silver';
}

/**
 * Cashback compute helper. Used by client-side preview ("you'd
 * earn 1,200 SAR back on this booking") and by the
 * post-redemption recompute in the accept-offer UI.
 *
 * Mirrors SQL formula: ROUND(amount_paid * cashback_pct / 100, 2).
 * `amount_paid` = total_amount - cashback_redemption_sar (D23).
 */
export function computeCashbackAmount(
  tier: ClientPrivilegeTier,
  amountPaidSar: number
): number {
  const pct = TIER_CASHBACK_PCT[tier];
  return Math.round(amountPaidSar * pct) / 100;
}

/**
 * D7 cap validators. Used at form-submission time before calling
 * the redeem RPC, so the user gets immediate feedback rather than
 * the RPC error envelope.
 */
export interface RedemptionValidationResult {
  ok: boolean;
  error?:
    | 'redemption_amount_invalid'
    | 'insufficient_balance'
    | 'redemption_exceeds_cap'
    | 'redemption_leaves_no_cash_payment';
  maxAllowed?: number;
}

export function validateRedemption(args: {
  requestedSar: number;
  bookingTotalSar: number;
  currentBalanceSar: number;
}): RedemptionValidationResult {
  const { requestedSar, bookingTotalSar, currentBalanceSar } = args;
  if (!Number.isFinite(requestedSar) || requestedSar <= 0) {
    return { ok: false, error: 'redemption_amount_invalid' };
  }
  if (requestedSar > currentBalanceSar) {
    return { ok: false, error: 'insufficient_balance' };
  }
  const maxAllowed = bookingTotalSar * 0.5;
  if (requestedSar > maxAllowed) {
    return {
      ok: false,
      error: 'redemption_exceeds_cap',
      maxAllowed,
    };
  }
  if (bookingTotalSar - requestedSar < 1) {
    return { ok: false, error: 'redemption_leaves_no_cash_payment' };
  }
  return { ok: true };
}

/**
 * For UI translation: tier ENUM → Arabic display label. Used by
 * tier-badge component and the marketing /privilege page.
 */
export const TIER_ARABIC_LABEL: Record<ClientPrivilegeTier, string> = {
  silver: 'فضي',
  gold: 'ذهبي',
  platinum: 'بلاتيني',
  diamond: 'ماسي',
};

/**
 * Returns the full tier order (silver, gold, platinum, diamond)
 * for iteration in UI.
 */
export function allTiers(): readonly ClientPrivilegeTier[] {
  return TIER_ORDER;
}
