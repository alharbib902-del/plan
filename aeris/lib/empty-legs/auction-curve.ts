/**
 * Phase 7 — Dutch-auction curve formula (TypeScript port).
 *
 * The plpgsql RPC `_recompute_empty_leg_price` (PR 2a) ports
 * the same formula in SQL. Both ports MUST stay in lockstep;
 * the parity test in `__tests__/auction-curve.test.ts`
 * (Layer-1, no DB) asserts identical outputs at fixed sample
 * points (0%, 25%, 50%, 75%, 100% elapsed-pct).
 *
 * Curve definition (per spec §Resolved Decisions §3):
 *
 *     pct = floor + (initial − floor) × (1 − elapsed)^2
 *         where elapsed = clamp((NOW − start) / (end − start), 0, 1)
 *
 * - At elapsed = 0 → pct = initial (e.g., 40% off).
 * - At elapsed = 1 → pct = floor (e.g., 70% off).
 * - The (1 − elapsed)^2 term means the discount accelerates
 *   as the auction window closes (small price moves early,
 *   big drops near departure).
 *
 * The `'linear'` curve variant interpolates linearly between
 * `initial` and `floor`:
 *
 *     pct = initial + (floor − initial) × elapsed
 *
 * Codex iteration-1 spec accepted both curves with
 * `'accelerating'` as the default; admin can override per-leg
 * via the `auction_curve` column.
 */

import type { EmptyLegAuctionCurve } from './types';

export interface AuctionCurveInput {
  /** When the auction opened (ISO timestamp or Date). */
  windowStart: Date | string;
  /** When the auction floor is reached (ISO timestamp or Date). */
  windowEnd: Date | string;
  /** Wall-clock "now" for the computation (ISO or Date). */
  now: Date | string;
  /** Discount % at window start (e.g. 40 for 40%). 10..50. */
  initialDiscountPct: number;
  /** Discount % at window end (e.g. 70 for 70%). 50..90. */
  floorDiscountPct: number;
  /** 'linear' or 'accelerating'. */
  curve: EmptyLegAuctionCurve;
}

export interface AuctionCurveOutput {
  /**
   * Effective discount percentage at `now`. Range:
   * `[initialDiscountPct, floorDiscountPct]`.
   */
  discountPct: number;
  /** `elapsed` clamped to [0, 1]. Useful for chart rendering. */
  elapsed: number;
}

const toMs = (v: Date | string): number =>
  v instanceof Date ? v.getTime() : new Date(v).getTime();

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Compute the current Dutch-auction discount % for an empty
 * leg.
 *
 * Constraints (validated at RPC layer, not here — this
 * module is a pure formula):
 * - `initialDiscountPct < floorDiscountPct` (the floor must
 *   be a deeper discount than the start).
 * - `windowEnd > windowStart`.
 *
 * Behavior at the boundaries:
 * - `now <= windowStart` → returns `initialDiscountPct` (the
 *   auction has not opened; price is still at start).
 * - `now >= windowEnd` → returns `floorDiscountPct` (the
 *   auction has bottomed out).
 */
export function computeAuctionDiscountPct(
  input: AuctionCurveInput,
): AuctionCurveOutput {
  const startMs = toMs(input.windowStart);
  const endMs = toMs(input.windowEnd);
  const nowMs = toMs(input.now);

  // The denominator-zero case (windowEnd === windowStart) is a
  // mis-validated input; treat as elapsed=1 to avoid NaN.
  const span = endMs - startMs;
  const elapsedRaw = span <= 0 ? 1 : (nowMs - startMs) / span;
  const elapsed = clamp(elapsedRaw, 0, 1);

  const { initialDiscountPct: initial, floorDiscountPct: floor, curve } = input;

  let pct: number;
  if (elapsed <= 0) {
    pct = initial;
  } else if (elapsed >= 1) {
    pct = floor;
  } else if (curve === 'linear') {
    pct = initial + (floor - initial) * elapsed;
  } else {
    // 'accelerating' — quadratic ease-in toward floor.
    // pct = floor + (initial − floor) × (1 − elapsed)^2
    const remaining = 1 - elapsed;
    pct = floor + (initial - floor) * (remaining * remaining);
  }

  return { discountPct: pct, elapsed };
}

/**
 * Compute the current SAR price from `original_price` + the
 * Dutch-auction discount %. Mirrors the RPC's
 * `current_price = original_price × (1 − pct/100)`.
 *
 * Rounded to 2 decimal places so the TS port matches the SQL
 * `DECIMAL(12,2)` storage precision exactly — without this,
 * IEEE 754 float arithmetic produces values like
 * `10000 × (1 − 0.7) = 3000.0000000000005` that would diverge
 * from the SQL output in the parity test.
 */
export function computeAuctionCurrentPrice(
  originalPrice: number,
  discountPct: number,
): number {
  const raw = originalPrice * (1 - discountPct / 100);
  return Math.round(raw * 100) / 100;
}
