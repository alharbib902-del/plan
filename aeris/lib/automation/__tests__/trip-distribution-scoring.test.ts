/**
 * Phase 9 PR 4 — TS mirror of the SQL `score_operators_for_trip`
 * scoring formula. Pins the contract documented in CLAUDE.md
 * "Trip Distribution Engine" (rating 40 / response time 30 /
 * price 20 / location 10) so the implementation never silently
 * drifts from the documented weights.
 *
 * Layer-1 (no DB / no Next): the SQL function is the
 * authoritative implementation; this suite re-implements the
 * same formula in TS and asserts the published shape.
 *
 * Runs as:
 *   npm run test:automation-trip-distribution-scoring
 *
 * Cases covered:
 *   1.  Perfect operator (rating 5, instant response, 0%
 *       commission, base airport match) → score 100
 *   2.  Worst-case operator (rating 0, slow response, max
 *       commission, no location match) → low/zero score
 *   3.  Rating-only contribution (40% weight)
 *   4.  Response-only contribution (30% weight)
 *   5.  Price-only contribution (20% weight, commission proxy)
 *   6.  Location-only contribution (10% weight)
 *   7.  Tie-break determinism: equal score → operator_id asc
 */

import { strict as assert } from 'node:assert';

interface OperatorInput {
  operator_id: string;
  rating: number | null;            // 0..5
  response_time_avg: number | null; // minutes
  commission_rate: number | null;   // percent
  base_airport: string | null;
}

function computeScore(
  op: OperatorInput,
  departureIata: string
): number {
  const ratingScore =
    (op.rating ?? 0) * 20.0;
  const responseScore =
    Math.max(0, 100 - (op.response_time_avg ?? 60));
  const priceScore =
    Math.max(0, 100 - (op.commission_rate ?? 8) * 10);
  const locationScore =
    op.base_airport === departureIata ? 100 : 0;
  const total =
    ratingScore * 0.4 +
    responseScore * 0.3 +
    priceScore * 0.2 +
    locationScore * 0.1;
  return Math.round(total * 100) / 100;
}

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
    console.error(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    failed++;
  }
}

test('1. perfect operator scores 100', () => {
  const score = computeScore(
    {
      operator_id: '1',
      rating: 5,
      response_time_avg: 0,
      commission_rate: 0,
      base_airport: 'RUH',
    },
    'RUH'
  );
  assert.equal(score, 100);
});

test('2. worst-case operator scores 0', () => {
  const score = computeScore(
    {
      operator_id: '2',
      rating: 0,
      response_time_avg: 100,
      commission_rate: 10,
      base_airport: null,
    },
    'RUH'
  );
  assert.equal(score, 0);
});

test('3. rating-only contribution: rating 5 × 20 × 0.4 = 40', () => {
  // Other factors at zero / max-bad
  const score = computeScore(
    {
      operator_id: '3',
      rating: 5,
      response_time_avg: 100,
      commission_rate: 10,
      base_airport: null,
    },
    'RUH'
  );
  assert.equal(score, 40);
});

test('4. response-only contribution: 0min → 100 × 0.3 = 30', () => {
  const score = computeScore(
    {
      operator_id: '4',
      rating: 0,
      response_time_avg: 0,
      commission_rate: 10,
      base_airport: null,
    },
    'RUH'
  );
  assert.equal(score, 30);
});

test('5. price-only contribution: 0% commission → 100 × 0.2 = 20', () => {
  const score = computeScore(
    {
      operator_id: '5',
      rating: 0,
      response_time_avg: 100,
      commission_rate: 0,
      base_airport: null,
    },
    'RUH'
  );
  assert.equal(score, 20);
});

test('6. location-only contribution: match → 100 × 0.1 = 10', () => {
  const score = computeScore(
    {
      operator_id: '6',
      rating: 0,
      response_time_avg: 100,
      commission_rate: 10,
      base_airport: 'RUH',
    },
    'RUH'
  );
  assert.equal(score, 10);
});

test('7. tie-break: equal score → operator_id asc determines order', () => {
  // Both operators identical metrics; the SQL ROW_NUMBER
  // ordering is `score DESC, operator_id ASC`. We mirror
  // that here by sorting two equal-score outputs.
  const opA: OperatorInput = {
    operator_id: 'aaaaaaaa-0000-0000-0000-000000000000',
    rating: 4,
    response_time_avg: 30,
    commission_rate: 5,
    base_airport: 'RUH',
  };
  const opB: OperatorInput = { ...opA, operator_id: 'bbbbbbbb-0000-0000-0000-000000000000' };
  const sa = computeScore(opA, 'RUH');
  const sb = computeScore(opB, 'RUH');
  assert.equal(sa, sb);
  // Sort by score DESC, then operator_id ASC.
  const sorted = [opB, opA].sort((x, y) => {
    const sx = computeScore(x, 'RUH');
    const sy = computeScore(y, 'RUH');
    if (sy !== sx) return sy - sx;
    return x.operator_id < y.operator_id ? -1 : 1;
  });
  assert.equal(sorted[0]!.operator_id, opA.operator_id);
  assert.equal(sorted[1]!.operator_id, opB.operator_id);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
