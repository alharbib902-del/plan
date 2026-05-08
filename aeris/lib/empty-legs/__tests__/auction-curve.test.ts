/**
 * Phase 7 PR 1 — parity test for the Dutch-auction curve.
 *
 * Layer-1 (no DB), runs as `npm run test:empty-legs-curve`.
 * Mirrors the Phase 6.2 catalog-vs-seed parity-test pattern:
 * zero deps beyond Node's built-in `assert` + the SUT.
 *
 * The plpgsql RPC `_recompute_empty_leg_price` (PR 2a) ports
 * the same formula in SQL. Both ports MUST produce identical
 * outputs at the fixed sample points exercised below
 * (0%, 25%, 50%, 75%, 100% elapsed-pct), under both
 * `'linear'` and `'accelerating'` curves, and under the
 * boundary cases (before window start, after window end,
 * zero-span window). PR 2a's parity verification reuses
 * these same expected values.
 */

import { strict as assert } from 'node:assert';

import {
  computeAuctionCurrentPrice,
  computeAuctionDiscountPct,
} from '@/lib/empty-legs/auction-curve';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// Fixed window: 24-hour auction running from 2026-06-01 00:00
// to 2026-06-02 00:00. The 5 sample points below pick `now`
// values that put `elapsed` exactly at 0, 0.25, 0.5, 0.75,
// 1.0 — so the asserted discount % values are deterministic
// even under floating-point arithmetic (the (1 − x)^2 term
// at x ∈ {0, 0.25, 0.5, 0.75, 1} produces clean rationals).
const WINDOW_START = '2026-06-01T00:00:00Z';
const WINDOW_END = '2026-06-02T00:00:00Z';
const NOW_AT_0_PCT = '2026-06-01T00:00:00Z'; //   0% elapsed
const NOW_AT_25_PCT = '2026-06-01T06:00:00Z'; //  25% elapsed
const NOW_AT_50_PCT = '2026-06-01T12:00:00Z'; //  50% elapsed
const NOW_AT_75_PCT = '2026-06-01T18:00:00Z'; //  75% elapsed
const NOW_AT_100_PCT = '2026-06-02T00:00:00Z'; // 100% elapsed

const DEFAULTS = {
  windowStart: WINDOW_START,
  windowEnd: WINDOW_END,
  initialDiscountPct: 40,
  floorDiscountPct: 70,
} as const;

// eslint-disable-next-line no-console
console.log('[empty-legs-curve] running …');
// eslint-disable-next-line no-console
console.log('');

// ────────────────────────────────────────────────────────────
// Accelerating curve at the 5 sample points.
//
// Formula: pct = floor + (initial − floor) × (1 − elapsed)^2
// With initial=40, floor=70, (initial − floor) = -30:
//   elapsed=0    → 70 - 30×1     = 40
//   elapsed=0.25 → 70 - 30×0.5625 = 53.125
//   elapsed=0.5  → 70 - 30×0.25   = 62.5
//   elapsed=0.75 → 70 - 30×0.0625 = 68.125
//   elapsed=1    → 70 - 30×0      = 70
// ────────────────────────────────────────────────────────────

test('accelerating curve at 0% elapsed → discount = initial (40)', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: NOW_AT_0_PCT,
    curve: 'accelerating',
  });
  assert.equal(result.elapsed, 0);
  assert.equal(result.discountPct, 40);
});

test('accelerating curve at 25% elapsed → 53.125%', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: NOW_AT_25_PCT,
    curve: 'accelerating',
  });
  assert.equal(result.elapsed, 0.25);
  assert.equal(result.discountPct, 53.125);
});

test('accelerating curve at 50% elapsed → 62.5%', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: NOW_AT_50_PCT,
    curve: 'accelerating',
  });
  assert.equal(result.elapsed, 0.5);
  assert.equal(result.discountPct, 62.5);
});

test('accelerating curve at 75% elapsed → 68.125%', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: NOW_AT_75_PCT,
    curve: 'accelerating',
  });
  assert.equal(result.elapsed, 0.75);
  assert.equal(result.discountPct, 68.125);
});

test('accelerating curve at 100% elapsed → discount = floor (70)', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: NOW_AT_100_PCT,
    curve: 'accelerating',
  });
  assert.equal(result.elapsed, 1);
  assert.equal(result.discountPct, 70);
});

// ────────────────────────────────────────────────────────────
// Linear curve at the 5 sample points.
//
// Formula: pct = initial + (floor − initial) × elapsed
// With initial=40, floor=70, (floor − initial) = 30:
//   elapsed=0    → 40 + 30×0    = 40
//   elapsed=0.25 → 40 + 30×0.25 = 47.5
//   elapsed=0.5  → 40 + 30×0.5  = 55
//   elapsed=0.75 → 40 + 30×0.75 = 62.5
//   elapsed=1    → 40 + 30×1    = 70
// ────────────────────────────────────────────────────────────

test('linear curve at 0% elapsed → 40', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: NOW_AT_0_PCT,
    curve: 'linear',
  });
  assert.equal(result.discountPct, 40);
});

test('linear curve at 25% elapsed → 47.5', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: NOW_AT_25_PCT,
    curve: 'linear',
  });
  assert.equal(result.discountPct, 47.5);
});

test('linear curve at 50% elapsed → 55', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: NOW_AT_50_PCT,
    curve: 'linear',
  });
  assert.equal(result.discountPct, 55);
});

test('linear curve at 75% elapsed → 62.5', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: NOW_AT_75_PCT,
    curve: 'linear',
  });
  assert.equal(result.discountPct, 62.5);
});

test('linear curve at 100% elapsed → 70', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: NOW_AT_100_PCT,
    curve: 'linear',
  });
  assert.equal(result.discountPct, 70);
});

// ────────────────────────────────────────────────────────────
// Boundary clamping: now < windowStart and now > windowEnd.
// ────────────────────────────────────────────────────────────

test('now before windowStart clamps elapsed to 0 + returns initial', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: '2026-05-31T12:00:00Z', // 12 hours before start
    curve: 'accelerating',
  });
  assert.equal(result.elapsed, 0);
  assert.equal(result.discountPct, 40);
});

test('now after windowEnd clamps elapsed to 1 + returns floor', () => {
  const result = computeAuctionDiscountPct({
    ...DEFAULTS,
    now: '2026-06-03T00:00:00Z', // 24 hours after end
    curve: 'accelerating',
  });
  assert.equal(result.elapsed, 1);
  assert.equal(result.discountPct, 70);
});

// ────────────────────────────────────────────────────────────
// Zero-span window (defensive — RPC validation rejects this,
// but the formula must not produce NaN).
// ────────────────────────────────────────────────────────────

test('zero-span window returns floor (defensive — NaN-free)', () => {
  const result = computeAuctionDiscountPct({
    windowStart: WINDOW_START,
    windowEnd: WINDOW_START, // same instant
    now: WINDOW_START,
    initialDiscountPct: 40,
    floorDiscountPct: 70,
    curve: 'accelerating',
  });
  assert.equal(result.elapsed, 1);
  assert.equal(result.discountPct, 70);
});

// ────────────────────────────────────────────────────────────
// computeAuctionCurrentPrice: original × (1 − pct/100).
// ────────────────────────────────────────────────────────────

test('current price at 40% discount on 10000 SAR = 6000', () => {
  assert.equal(computeAuctionCurrentPrice(10000, 40), 6000);
});

test('current price at 70% discount on 10000 SAR = 3000', () => {
  assert.equal(computeAuctionCurrentPrice(10000, 70), 3000);
});

test('current price at 53.125% discount on 10000 SAR = 4687.5', () => {
  assert.equal(computeAuctionCurrentPrice(10000, 53.125), 4687.5);
});

// ────────────────────────────────────────────────────────────
// Final summary + exit code.
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-console
console.log('');
// eslint-disable-next-line no-console
console.log(`[empty-legs-curve] ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
process.exit(0);
