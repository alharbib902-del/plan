/**
 * Phase 13 PR 3 — tier-boost eligibility pure-logic test.
 *
 * Layer-1 (no DB, no env). Runs as
 * `npm run test:empty-legs-tier-boost`.
 *
 * Covers Probe 47 in the spec §11 contract:
 *   - Diamond at T0+0     → eligible, boost_applied=12
 *   - Platinum at T0+5h   → NOT eligible (T_open=T0+6h)
 *   - Platinum at T0+7h   → eligible, boost_applied=6
 *   - Silver at T0+11h    → NOT eligible (T_open=T0+12h)
 *   - Silver at T0+12h    → eligible, boost_applied=0
 *   - thresholds=[] / null tier fallbacks
 */

import { strict as assert } from 'node:assert';

import {
  decideTierBoostEligibility,
  type TierBoostRule,
} from '@/lib/empty-legs/matching-tier-boost';

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
console.log('\n[empty-legs-tier-boost] running …\n');

// Mirror of the PR 1 seed values for privilege_tier_thresholds.
const PROD_RULES: TierBoostRule[] = [
  { tier: 'silver', empty_legs_boost_hours: 0 },
  { tier: 'gold', empty_legs_boost_hours: 2 },
  { tier: 'platinum', empty_legs_boost_hours: 6 },
  { tier: 'diamond', empty_legs_boost_hours: 12 },
];

const T0 = new Date('2026-06-01T00:00:00Z');
const at = (hoursAfterT0: number): Date =>
  new Date(T0.getTime() + hoursAfterT0 * 60 * 60 * 1000);

// ============================================================
// Diamond — full 12h head-start, eligible from T0
// ============================================================

test('Diamond at T0+0 → eligible, boost_applied=12, tier_window_open', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(0),
    clientTier: 'diamond',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.boost_hours_applied, 12);
    assert.equal(decision.reason, 'tier_window_open');
  }
});

test('Diamond at T0+11h → still tier_window_open (FCFS hasn\'t opened)', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(11),
    clientTier: 'diamond',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.reason, 'tier_window_open');
    assert.equal(decision.boost_hours_applied, 12);
  }
});

test('Diamond at T0+12h → fcfs_open, boost_applied=0', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(12),
    clientTier: 'diamond',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.reason, 'fcfs_open');
    assert.equal(decision.boost_hours_applied, 0);
  }
});

// ============================================================
// Platinum — 6h head-start, T_open = T0+6h
// ============================================================

test('Platinum at T0+5h → NOT eligible (tier_window_not_yet_open)', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(5),
    clientTier: 'platinum',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, false);
  if (!decision.eligible) {
    assert.equal(decision.reason, 'tier_window_not_yet_open');
    assert.equal(decision.tier_opens_at_iso, at(6).toISOString());
  }
});

test('Platinum at T0+6h → eligible, boost_applied=6', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(6),
    clientTier: 'platinum',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.boost_hours_applied, 6);
    assert.equal(decision.reason, 'tier_window_open');
  }
});

test('Platinum at T0+7h → eligible (well inside window)', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(7),
    clientTier: 'platinum',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, true);
});

// ============================================================
// Gold — 2h head-start, T_open = T0+10h
// ============================================================

test('Gold at T0+9h → NOT eligible (Gold opens at T0+10h)', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(9),
    clientTier: 'gold',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, false);
  if (!decision.eligible) {
    assert.equal(decision.tier_opens_at_iso, at(10).toISOString());
  }
});

test('Gold at T0+10h → eligible, boost_applied=2', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(10),
    clientTier: 'gold',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.boost_hours_applied, 2);
    assert.equal(decision.reason, 'tier_window_open');
  }
});

// ============================================================
// Silver — 0h head-start (FCFS only)
// ============================================================

test('Silver at T0+11h → NOT eligible (FCFS opens at T0+12h)', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(11),
    clientTier: 'silver',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, false);
});

test('Silver at T0+12h → fcfs_open, boost_applied=0', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(12),
    clientTier: 'silver',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.reason, 'fcfs_open');
    assert.equal(decision.boost_hours_applied, 0);
  }
});

test('Silver at T0+24h → fcfs_open (well past FCFS)', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(24),
    clientTier: 'silver',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.reason, 'fcfs_open');
  }
});

// ============================================================
// Defensive fallbacks
// ============================================================

test('thresholds=[] → no_gating, eligible immediately', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(0),
    clientTier: 'silver',
    thresholds: [],
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.reason, 'no_gating');
    assert.equal(decision.boost_hours_applied, 0);
  }
});

test('NULL clientTier behaves as silver (FCFS-only)', () => {
  const before = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(11),
    clientTier: null,
    thresholds: PROD_RULES,
  });
  assert.equal(before.eligible, false);

  const after = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(12),
    clientTier: null,
    thresholds: PROD_RULES,
  });
  assert.equal(after.eligible, true);
});

test('publishedAt as ISO string → identical to Date', () => {
  const asString = decideTierBoostEligibility({
    publishedAt: T0.toISOString(),
    now: at(6),
    clientTier: 'platinum',
    thresholds: PROD_RULES,
  });
  const asDate = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(6),
    clientTier: 'platinum',
    thresholds: PROD_RULES,
  });
  assert.deepEqual(asString, asDate);
});

test('Invalid publishedAt → no_gating fail-open', () => {
  const decision = decideTierBoostEligibility({
    publishedAt: 'not-an-iso-string',
    now: at(0),
    clientTier: 'silver',
    thresholds: PROD_RULES,
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.reason, 'no_gating');
  }
});

test('tier not present in thresholds → zero boost (FCFS-only behaviour)', () => {
  const partial: TierBoostRule[] = [
    { tier: 'diamond', empty_legs_boost_hours: 12 },
  ];
  // Gold has no entry → treated as zero-boost. Diamond's
  // boost still defines the FCFS time = T0+12h, so Gold has
  // to wait until then.
  const decision = decideTierBoostEligibility({
    publishedAt: T0,
    now: at(11),
    clientTier: 'gold',
    thresholds: partial,
  });
  assert.equal(decision.eligible, false);
});

// ============================================================
// Wrap up
// ============================================================

// eslint-disable-next-line no-console
console.log(`\n[empty-legs-tier-boost] ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
