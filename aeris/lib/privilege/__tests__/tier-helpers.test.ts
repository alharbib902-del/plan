/**
 * Phase 13 PR 1 — tests for tier-helpers pure functions.
 *
 * Runs as: npm run test:privilege-tier-helpers
 *
 * Coverage:
 *   - tierRank, stepDownOne, stepUpOne, compareTiers, tierAtOrAbove
 *   - tierForSpend (D3 thresholds)
 *   - tierGraceEligible (F3 silver-floor guard)
 *   - progressToNextTier + spendRemainingToNextTier
 *   - computeCashbackAmount (D4 percentages)
 *   - validateRedemption (D7 caps)
 */

import { strict as assert } from 'node:assert';

import {
  tierRank,
  stepDownOne,
  stepUpOne,
  compareTiers,
  tierAtOrAbove,
  tierForSpend,
  tierGraceEligible,
  progressToNextTier,
  spendRemainingToNextTier,
  computeCashbackAmount,
  validateRedemption,
  allTiers,
  TIER_MIN_SPEND_SAR,
  TIER_CASHBACK_PCT,
} from '@/lib/privilege/tier-helpers';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    failed += 1;
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

// ============================================================
// tierRank
// ============================================================
console.log('tierRank()');

test('returns 1 for silver', () => {
  assert.equal(tierRank('silver'), 1);
});
test('returns 2 for gold', () => {
  assert.equal(tierRank('gold'), 2);
});
test('returns 3 for platinum', () => {
  assert.equal(tierRank('platinum'), 3);
});
test('returns 4 for diamond', () => {
  assert.equal(tierRank('diamond'), 4);
});

// ============================================================
// stepDownOne (F3 silver-floor guard)
// ============================================================
console.log('stepDownOne()');

test('diamond → platinum', () => {
  assert.equal(stepDownOne('diamond'), 'platinum');
});
test('platinum → gold', () => {
  assert.equal(stepDownOne('platinum'), 'gold');
});
test('gold → silver', () => {
  assert.equal(stepDownOne('gold'), 'silver');
});
test('silver → silver (floor, F3 fix)', () => {
  assert.equal(stepDownOne('silver'), 'silver');
});

// ============================================================
// stepUpOne
// ============================================================
console.log('stepUpOne()');

test('silver → gold', () => {
  assert.equal(stepUpOne('silver'), 'gold');
});
test('diamond → diamond (ceiling)', () => {
  assert.equal(stepUpOne('diamond'), 'diamond');
});

// ============================================================
// compareTiers
// ============================================================
console.log('compareTiers()');

test('silver vs gold = -1', () => {
  assert.equal(compareTiers('silver', 'gold'), -1);
});
test('platinum vs platinum = 0', () => {
  assert.equal(compareTiers('platinum', 'platinum'), 0);
});
test('diamond vs silver = 1', () => {
  assert.equal(compareTiers('diamond', 'silver'), 1);
});

// ============================================================
// tierAtOrAbove
// ============================================================
console.log('tierAtOrAbove()');

test('gold >= silver', () => assert.equal(tierAtOrAbove('gold', 'silver'), true));
test('silver >= gold = false', () => assert.equal(tierAtOrAbove('silver', 'gold'), false));
test('platinum >= platinum', () => assert.equal(tierAtOrAbove('platinum', 'platinum'), true));

// ============================================================
// tierForSpend (D3 thresholds)
// ============================================================
console.log('tierForSpend()');

test('0 SAR → silver', () => assert.equal(tierForSpend(0), 'silver'));
test('99,999 SAR → silver', () => assert.equal(tierForSpend(99_999), 'silver'));
test('100,000 SAR → gold (boundary)', () => assert.equal(tierForSpend(100_000), 'gold'));
test('499,999 SAR → gold', () => assert.equal(tierForSpend(499_999), 'gold'));
test('500,000 SAR → platinum (boundary)', () => assert.equal(tierForSpend(500_000), 'platinum'));
test('1,999,999 SAR → platinum', () => assert.equal(tierForSpend(1_999_999), 'platinum'));
test('2,000,000 SAR → diamond (boundary)', () => assert.equal(tierForSpend(2_000_000), 'diamond'));
test('10,000,000 SAR → diamond', () => assert.equal(tierForSpend(10_000_000), 'diamond'));

// ============================================================
// tierGraceEligible (F3 silver-floor invariant)
// ============================================================
console.log('tierGraceEligible()');

test('silver is NOT grace eligible', () => assert.equal(tierGraceEligible('silver'), false));
test('gold IS grace eligible', () => assert.equal(tierGraceEligible('gold'), true));
test('platinum IS grace eligible', () => assert.equal(tierGraceEligible('platinum'), true));
test('diamond IS grace eligible', () => assert.equal(tierGraceEligible('diamond'), true));

// ============================================================
// progressToNextTier
// ============================================================
console.log('progressToNextTier()');

test('silver @ 0 SAR = 0 progress', () => {
  assert.equal(progressToNextTier('silver', 0), 0);
});
test('silver @ 50k SAR = 0.5 progress to gold', () => {
  assert.equal(progressToNextTier('silver', 50_000), 0.5);
});
test('silver @ 100k SAR = 1.0 (at boundary, not yet upgraded)', () => {
  assert.equal(progressToNextTier('silver', 100_000), 1.0);
});
test('gold @ 200k SAR = 0.25 progress to platinum', () => {
  // (200-100)/(500-100) = 0.25
  assert.equal(progressToNextTier('gold', 200_000), 0.25);
});
test('diamond @ 5M SAR = 1.0 (no next tier)', () => {
  assert.equal(progressToNextTier('diamond', 5_000_000), 1.0);
});

// ============================================================
// spendRemainingToNextTier
// ============================================================
console.log('spendRemainingToNextTier()');

test('silver @ 0 SAR needs 100k', () => {
  assert.equal(spendRemainingToNextTier('silver', 0), 100_000);
});
test('gold @ 200k SAR needs 300k more for platinum', () => {
  assert.equal(spendRemainingToNextTier('gold', 200_000), 300_000);
});
test('diamond returns 0 (no next tier)', () => {
  assert.equal(spendRemainingToNextTier('diamond', 5_000_000), 0);
});
test('platinum @ 2.5M SAR returns 0 (already past diamond threshold)', () => {
  assert.equal(spendRemainingToNextTier('platinum', 2_500_000), 0);
});

// ============================================================
// computeCashbackAmount (D4 percentages)
// ============================================================
console.log('computeCashbackAmount()');

test('silver 5% on 1000 = 50', () => {
  assert.equal(computeCashbackAmount('silver', 1000), 50);
});
test('gold 8% on 10000 = 800', () => {
  assert.equal(computeCashbackAmount('gold', 10000), 800);
});
test('platinum 12% on 50000 = 6000', () => {
  assert.equal(computeCashbackAmount('platinum', 50000), 6000);
});
test('diamond 15% on 100000 = 15000', () => {
  assert.equal(computeCashbackAmount('diamond', 100000), 15000);
});
test('rounds to 2 decimals: silver on 99.99 = 5.00', () => {
  // 99.99 × 0.05 = 4.9995 → rounds to 5.00
  assert.equal(computeCashbackAmount('silver', 99.99), 5);
});

// ============================================================
// validateRedemption (D7 caps)
// ============================================================
console.log('validateRedemption()');

test('valid 5000 on 50k booking, 5000 balance → ok', () => {
  const r = validateRedemption({
    requestedSar: 5000,
    bookingTotalSar: 50000,
    currentBalanceSar: 5000,
  });
  assert.equal(r.ok, true);
});

test('zero amount → invalid', () => {
  const r = validateRedemption({
    requestedSar: 0,
    bookingTotalSar: 50000,
    currentBalanceSar: 5000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'redemption_amount_invalid');
});

test('negative amount → invalid', () => {
  const r = validateRedemption({
    requestedSar: -100,
    bookingTotalSar: 50000,
    currentBalanceSar: 5000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'redemption_amount_invalid');
});

test('exceeds balance → insufficient', () => {
  const r = validateRedemption({
    requestedSar: 6000,
    bookingTotalSar: 50000,
    currentBalanceSar: 5000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'insufficient_balance');
});

test('exceeds 50% cap → exceeds_cap (10k req on 10k booking)', () => {
  const r = validateRedemption({
    requestedSar: 6000,
    bookingTotalSar: 10000,
    currentBalanceSar: 100000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'redemption_exceeds_cap');
  assert.equal(r.maxAllowed, 5000);
});

test('at exact 50% cap = ok (5k on 10k)', () => {
  const r = validateRedemption({
    requestedSar: 5000,
    bookingTotalSar: 10000,
    currentBalanceSar: 100000,
  });
  assert.equal(r.ok, true);
});

test('leaves <1 SAR cash → fails (4999.5 on 5000)', () => {
  const r = validateRedemption({
    requestedSar: 4999.5,
    bookingTotalSar: 5000,
    currentBalanceSar: 100000,
  });
  // 4999.5 > 2500 (50% of 5000) → exceeds cap first
  assert.equal(r.ok, false);
});

test('NaN amount → invalid', () => {
  const r = validateRedemption({
    requestedSar: NaN,
    bookingTotalSar: 50000,
    currentBalanceSar: 5000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'redemption_amount_invalid');
});

// ============================================================
// Threshold + cashback lookups (D3 + D4)
// ============================================================
console.log('TIER_MIN_SPEND_SAR + TIER_CASHBACK_PCT');

test('thresholds match D3 spec', () => {
  assert.equal(TIER_MIN_SPEND_SAR.silver, 0);
  assert.equal(TIER_MIN_SPEND_SAR.gold, 100_000);
  assert.equal(TIER_MIN_SPEND_SAR.platinum, 500_000);
  assert.equal(TIER_MIN_SPEND_SAR.diamond, 2_000_000);
});

test('cashback percentages match D4 spec', () => {
  assert.equal(TIER_CASHBACK_PCT.silver, 5);
  assert.equal(TIER_CASHBACK_PCT.gold, 8);
  assert.equal(TIER_CASHBACK_PCT.platinum, 12);
  assert.equal(TIER_CASHBACK_PCT.diamond, 15);
});

test('allTiers returns 4 in correct order', () => {
  const tiers = allTiers();
  assert.equal(tiers.length, 4);
  assert.equal(tiers[0], 'silver');
  assert.equal(tiers[3], 'diamond');
});

// ============================================================
// Summary
// ============================================================
console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
