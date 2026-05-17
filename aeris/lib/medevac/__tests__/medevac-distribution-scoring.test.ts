/**
 * Phase 12 PR 3 — pure scoring tests for medevac distribution.
 *
 * Runs as: npm run test:medevac-distribution-scoring
 *
 * Mirrors Phase 11 cargo distribution-scoring shape since the
 * scoring algorithm is identical (only the capability source
 * differs: cargo_aircraft_capabilities → aircraft_medical_
 * certifications, but classifyCandidates accepts a pre-resolved
 * has_capability boolean so the test surface is identical).
 *
 * Cases (12 total):
 *   recencyScore (per spec §3.2):
 *     1. NULL  → 1.0  (first-time boost)
 *     2. > 7 days   → 1.0
 *     3. 3-7 days   → 0.5
 *     4. < 3 days   → 0.0  (rate-limit)
 *     5. exactly 3 days  → 0.5 (inclusive boundary)
 *   classifyCandidates:
 *     6. no_capability skip
 *     7. recently_dispatched skip (recency=0)
 *     8. dispatch cap = 5; 6th+ → lower_score
 *     9. higher rating wins ties on recency
 *    10. NULL rating uses DEFAULT_RATING=3.0
 *    11. empty input → empty result
 *    12. all skipped — no dispatched
 */

import { strict as assert } from 'node:assert';

import {
  classifyCandidates,
  recencyScore,
  operatorScore,
  type MedevacCandidate,
} from '@/lib/medevac/scoring';

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
console.log('\n[medevac-distribution-scoring] running …\n');

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const isoAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

function makeCandidate(
  overrides: Partial<MedevacCandidate> = {}
): MedevacCandidate {
  return {
    operator_id: '11111111-2222-4333-8444-555555555555',
    contact_email: 'op@example.com',
    contact_phone: '+966500000000',
    company_name: 'Test Operator',
    has_capability: true,
    last_dispatched_at: null,
    rating: 4.0,
    ...overrides,
  };
}

// recencyScore
test('1. recencyScore NULL → 1.0', () => {
  assert.equal(recencyScore(null, NOW), 1.0);
});
test('2. recencyScore > 7d → 1.0', () => {
  assert.equal(recencyScore(isoAgo(10), NOW), 1.0);
});
test('3. recencyScore 5d → 0.5', () => {
  assert.equal(recencyScore(isoAgo(5), NOW), 0.5);
});
test('4. recencyScore 1d → 0.0', () => {
  assert.equal(recencyScore(isoAgo(1), NOW), 0.0);
});
test('5. recencyScore exactly 3d → 0.5 (inclusive)', () => {
  assert.equal(recencyScore(isoAgo(3), NOW), 0.5);
});

// classifyCandidates
test('6. no_capability skip', () => {
  const r = classifyCandidates(
    [makeCandidate({ operator_id: 'a', has_capability: false })],
    NOW
  );
  assert.equal(r.dispatched.length, 0);
  assert.equal(r.skip_reasons['a'], 'no_capability');
});

test('7. recently_dispatched (< 3 days) skip', () => {
  const r = classifyCandidates(
    [
      makeCandidate({
        operator_id: 'a',
        last_dispatched_at: isoAgo(1),
      }),
    ],
    NOW
  );
  assert.equal(r.dispatched.length, 0);
  assert.equal(r.skip_reasons['a'], 'recently_dispatched');
});

test('8. dispatch cap = 5; 6th+ → lower_score', () => {
  const candidates: MedevacCandidate[] = [];
  for (let i = 0; i < 7; i++) {
    candidates.push(
      makeCandidate({
        operator_id: `op-${i}`,
        last_dispatched_at: null, // all same recency
        rating: 5 - i * 0.5, // descending rating: 5, 4.5, 4, 3.5, 3, 2.5, 2
      })
    );
  }
  const r = classifyCandidates(candidates, NOW);
  assert.equal(r.dispatched.length, 5);
  // op-0..op-4 dispatched, op-5 + op-6 skipped as lower_score
  assert.equal(r.dispatched[0]!.operator_id, 'op-0');
  assert.equal(r.dispatched[4]!.operator_id, 'op-4');
  assert.equal(r.skip_reasons['op-5'], 'lower_score');
  assert.equal(r.skip_reasons['op-6'], 'lower_score');
});

test('9. higher rating wins ties on recency', () => {
  const r = classifyCandidates(
    [
      makeCandidate({ operator_id: 'low', rating: 2.0 }),
      makeCandidate({ operator_id: 'high', rating: 5.0 }),
    ],
    NOW
  );
  assert.equal(r.dispatched[0]!.operator_id, 'high');
  assert.equal(r.dispatched[1]!.operator_id, 'low');
});

test('10. NULL rating uses DEFAULT_RATING (3.0)', () => {
  const withDefault = operatorScore({
    recencyScore: 1.0,
    ratingScore: 3.0 / 5.0,
  });
  const withExplicitFour = operatorScore({
    recencyScore: 1.0,
    ratingScore: 4.0 / 5.0,
  });
  assert.equal(withDefault < withExplicitFour, true);
  // Sanity check via classifyCandidates: null rating gets
  // ordered lower than 4.0.
  const r = classifyCandidates(
    [
      makeCandidate({ operator_id: 'null-rated', rating: null }),
      makeCandidate({ operator_id: 'four-rated', rating: 4.0 }),
    ],
    NOW
  );
  assert.equal(r.dispatched[0]!.operator_id, 'four-rated');
});

test('11. empty input → empty result', () => {
  const r = classifyCandidates([], NOW);
  assert.equal(r.dispatched.length, 0);
  assert.equal(r.skipped_operator_ids.length, 0);
});

test('12. all skipped — no dispatched', () => {
  const r = classifyCandidates(
    [
      makeCandidate({ operator_id: 'a', has_capability: false }),
      makeCandidate({
        operator_id: 'b',
        last_dispatched_at: isoAgo(1),
      }),
    ],
    NOW
  );
  assert.equal(r.dispatched.length, 0);
  assert.equal(r.skipped_operator_ids.length, 2);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
