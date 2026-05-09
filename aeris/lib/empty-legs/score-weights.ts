/**
 * Phase 7 PR 2e — empty-legs candidate score weights.
 *
 * Pure constants — exported separately so the matching engine
 * + the matching unit test can import without dragging the
 * full matcher tree.
 *
 * Contract (sums to 100):
 *   - GEO_WEIGHT      = 40 — proximity match between the
 *                            customer's prior origin/destination
 *                            and the leg's route (exact IATA
 *                            overlap = full points; same city,
 *                            different airport = partial; no
 *                            overlap = 0).
 *   - TIME_WEIGHT     = 30 — overlap between the customer's
 *                            preferred departure_date window
 *                            and the leg's
 *                            departure_window_start/end +
 *                            flexibility_hours.
 *   - CAPACITY_WEIGHT = 20 — leg's `max_passengers` >= the
 *                            customer's requested `passengers`.
 *                            Binary-ish: full points when met,
 *                            zero otherwise.
 *   - DISCOUNT_WEIGHT = 10 — leg's `current_discount_pct`
 *                            scaled into 0..10 (50% discount =
 *                            5 points, 70% = 7, etc.).
 *
 * Score is integer 0..100. The matcher takes the top 50 per
 * cycle (Phase 7 spec §7.6 §matching engine).
 *
 * Future phases may swap to AI scoring behind
 * `ENABLE_EMPTY_LEGS_AI_SCORING` — these constants then
 * become the rule-based fallback weights only.
 */

export const GEO_WEIGHT = 40;
export const TIME_WEIGHT = 30;
export const CAPACITY_WEIGHT = 20;
export const DISCOUNT_WEIGHT = 10;

export const TOTAL_WEIGHT =
  GEO_WEIGHT + TIME_WEIGHT + CAPACITY_WEIGHT + DISCOUNT_WEIGHT;

// Compile-time sanity check: the four weights must sum to
// 100. If a future edit drifts, the test file
// `__tests__/matching.test.ts` re-asserts at runtime.
if (TOTAL_WEIGHT !== 100) {
  throw new Error(
    `score-weights: weights must sum to 100, got ${TOTAL_WEIGHT}`
  );
}

export const TOP_N = 50;
