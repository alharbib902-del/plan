/**
 * Phase 11 PR 3 §7.1 — distribution scoring + classification tests.
 *
 * Layer-1 (no DB). Pure tests on `classifyCandidates` + helper
 * `recencyScore`. The Layer-2 integration with Supabase is
 * verified by Probe 32 against real DB at activation time.
 *
 * 6 cases per spec §7.1 (Round 4 PR #72 P2 #1 — test 4 expects
 * skipped not low-scored).
 *
 * Runs as: npm run test:cargo-distribution-scoring
 */

import { strict as assert } from 'node:assert';

import {
  classifyCandidates,
  recencyScore,
  type CargoCandidate,
} from '@/lib/cargo/scoring';

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

// eslint-disable-next-line no-console
console.log('\n[cargo-distribution-scoring] running …\n');

// Helpers
const NOW = new Date('2026-06-01T12:00:00Z').getTime();
const daysAgo = (n: number) =>
  new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

function candidate(overrides: Partial<CargoCandidate>): CargoCandidate {
  return {
    operator_id: 'op-default',
    contact_email: 'op@example.com',
    contact_phone: '+966500000000',
    company_name: 'Default Op Co',
    has_capability: true,
    last_dispatched_at: null,
    rating: null,
    ...overrides,
  };
}

// ============================================================
// recencyScore primitive
// ============================================================

test('recencyScore — NULL last_dispatched_at → 1.0 (first time)', () => {
  assert.equal(recencyScore(null, NOW), 1.0);
  assert.equal(recencyScore(undefined, NOW), 1.0);
});

test('recencyScore — 10 days ago → 1.0 (warm bucket)', () => {
  assert.equal(recencyScore(daysAgo(10), NOW), 1.0);
});

test('recencyScore — 5 days ago → 0.5 (hot-to-warm bucket)', () => {
  assert.equal(recencyScore(daysAgo(5), NOW), 0.5);
});

test('recencyScore — 1 day ago → 0.0 (rate-limit short-circuit)', () => {
  assert.equal(recencyScore(daysAgo(1), NOW), 0.0);
});

// ============================================================
// classifyCandidates — 6 spec cases
// ============================================================

test('1. capable, first-time → dispatched, score ≈ 0.88', () => {
  const result = classifyCandidates(
    [candidate({ operator_id: 'op1', has_capability: true })],
    NOW
  );
  assert.equal(result.dispatched.length, 1);
  assert.equal(result.dispatched[0]!.operator_id, 'op1');
  assert.deepEqual(result.skip_reasons, {});
});

test('2. capable, 10 days ago → dispatched, recency=1.0', () => {
  const result = classifyCandidates(
    [
      candidate({
        operator_id: 'op1',
        has_capability: true,
        last_dispatched_at: daysAgo(10),
      }),
    ],
    NOW
  );
  assert.equal(result.dispatched.length, 1);
  assert.deepEqual(result.skip_reasons, {});
});

test('3. capable, 5 days ago → dispatched, recency=0.5', () => {
  const result = classifyCandidates(
    [
      candidate({
        operator_id: 'op1',
        has_capability: true,
        last_dispatched_at: daysAgo(5),
      }),
    ],
    NOW
  );
  assert.equal(result.dispatched.length, 1);
  assert.deepEqual(result.skip_reasons, {});
});

test('4. capable, 1 day ago → skipped, "recently_dispatched" (short-circuit)', () => {
  const result = classifyCandidates(
    [
      candidate({
        operator_id: 'op1',
        has_capability: true,
        last_dispatched_at: daysAgo(1),
      }),
    ],
    NOW
  );
  assert.equal(result.dispatched.length, 0);
  assert.equal(result.skip_reasons['op1'], 'recently_dispatched');
});

test('5. not capable → skipped, "no_capability"', () => {
  const result = classifyCandidates(
    [candidate({ operator_id: 'op1', has_capability: false })],
    NOW
  );
  assert.equal(result.dispatched.length, 0);
  assert.equal(result.skip_reasons['op1'], 'no_capability');
});

test('6. 7 capable, all 10 days ago → top 5 dispatched, others "lower_score"', () => {
  const candidates: CargoCandidate[] = [];
  for (let i = 1; i <= 7; i++) {
    candidates.push(
      candidate({
        operator_id: `op${i}`,
        has_capability: true,
        last_dispatched_at: daysAgo(10),
        // varying rating to break ties deterministically
        rating: 5 - i * 0.1,
      })
    );
  }
  const result = classifyCandidates(candidates, NOW);
  assert.equal(result.dispatched.length, 5);
  // op1 has highest rating (4.9) → top of list
  assert.equal(result.dispatched[0]!.operator_id, 'op1');
  // op6 + op7 should be 'lower_score'
  assert.equal(result.skip_reasons['op6'], 'lower_score');
  assert.equal(result.skip_reasons['op7'], 'lower_score');
});

// eslint-disable-next-line no-console
console.log(
  `\n[cargo-distribution-scoring] ${passed} passed, ${failed} failed\n`
);

if (failed > 0) {
  process.exit(1);
}
