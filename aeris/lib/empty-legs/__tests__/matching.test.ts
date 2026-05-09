/**
 * Phase 7 PR 2e — matching engine scoring parity test.
 *
 * Layer-1 (no DB), runs as `npm run test:empty-legs-matching`.
 * Tests the pure scoring function `scoreCandidateAgainstLeg`
 * + the per-leg branch decision `shouldMarkOutboxProcessed`.
 *
 * The DB-touching `matchLeg` is exercised by integration
 * smoke (Founder Probe 16). This unit test asserts the
 * scoring formula stays deterministic at fixed sample
 * points, mirroring the auction-curve parity test pattern.
 */

import { strict as assert } from 'node:assert';

import {
  scoreCandidateAgainstLeg,
  shouldMarkOutboxProcessed,
} from '@/lib/empty-legs/matching';
import type { CandidateRow } from '@/lib/empty-legs/candidate-pool';
import type { EmptyLegRow } from '@/lib/empty-legs/types';
import {
  CAPACITY_WEIGHT,
  DISCOUNT_WEIGHT,
  GEO_WEIGHT,
  TIME_WEIGHT,
  TOTAL_WEIGHT,
} from '@/lib/empty-legs/score-weights';

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
console.log('\n[empty-legs-matching] running …\n');

// ============================================================
// Fixture builders
// ============================================================

const baseLegFixture = (
  overrides: Partial<EmptyLegRow> = {}
): EmptyLegRow =>
  ({
    id: 'leg-fixture',
    leg_number: 'EL-FIXTURE',
    parent_booking_id: null,
    operator_id: null,
    operator_stub_id: null,
    operator_name_snapshot: null,
    operator_phone_snapshot: null,
    operator_email_snapshot: null,
    aircraft_id: null,
    aircraft_snapshot: null,
    departure_airport: 'RUH',
    departure_airport_freeform_snapshot: null,
    arrival_airport: 'JED',
    arrival_airport_freeform_snapshot: null,
    departure_window_start: '2026-06-14T21:00:00Z',
    departure_window_end: '2026-06-15T03:00:00Z',
    flexibility_hours: 3,
    original_price: 10000,
    current_discount_pct: 50,
    current_price: 5000,
    max_passengers: 8,
    status: 'available',
    auction_initial_discount_pct: 40,
    auction_floor_discount_pct: 70,
    auction_curve: 'accelerating',
    auction_window_start_at: '2026-06-10T00:00:00+03:00',
    auction_window_end_at: '2026-06-15T03:00:00+03:00',
    last_price_drop_at: null,
    suppress_notifications: false,
    customer_booking_id: null,
    reservation_token_hash: null,
    reservation_expires_at: null,
    reservation_customer_name_snapshot: null,
    reservation_customer_phone_snapshot: null,
    views_count: 0,
    created_at: '2026-06-09T00:00:00Z',
    updated_at: '2026-06-09T00:00:00Z',
    ...overrides,
  }) as EmptyLegRow;

const baseCandidateFixture = (
  overrides: Partial<CandidateRow> = {}
): CandidateRow => ({
  id: 'cand-fixture',
  customer_name: 'Test Customer',
  customer_phone: '+966500000000',
  origin: 'Riyadh',
  destination: 'Jeddah',
  origin_iata: 'RUH',
  destination_iata: 'JED',
  departure_date: '2026-06-15',
  return_date: null,
  passengers: 4,
  last_empty_leg_notified_at: null,
  empty_legs_opt_in: true,
  ...overrides,
});

// ============================================================
// Sanity
// ============================================================

test('weights sum to 100', () => {
  assert.equal(TOTAL_WEIGHT, 100);
});

// ============================================================
// scoreCandidateAgainstLeg
// ============================================================

test('exact route + window + capacity + 50% discount = full geo + full time + full capacity + 5 discount', () => {
  const score = scoreCandidateAgainstLeg(
    baseLegFixture(),
    baseCandidateFixture()
  );
  // geo=40 + time=30 + cap=20 + discount=round(0.5 * 10) = 5
  // = 95
  assert.equal(score, 95);
});

test('70% discount on the same fixture = full discount band (10)', () => {
  const score = scoreCandidateAgainstLeg(
    baseLegFixture({ current_discount_pct: 70 }),
    baseCandidateFixture()
  );
  // geo=40 + time=30 + cap=20 + discount=round(0.7 * 10) = 7
  // = 97
  assert.equal(score, 97);
});

test('reverse-route (only origin matches) → half geo', () => {
  const score = scoreCandidateAgainstLeg(
    baseLegFixture(),
    baseCandidateFixture({ destination_iata: 'DMM' })
  );
  // geo=20 + time=30 + cap=20 + discount=5 = 75
  assert.equal(score, 75);
});

test('no IATA match → zero geo factor', () => {
  const score = scoreCandidateAgainstLeg(
    baseLegFixture(),
    baseCandidateFixture({ origin_iata: 'CAI', destination_iata: 'IST' })
  );
  // geo=0 + time=30 + cap=20 + discount=5 = 55
  assert.equal(score, 55);
});

test('candidate passengers > leg max → zero capacity', () => {
  const score = scoreCandidateAgainstLeg(
    baseLegFixture(),
    baseCandidateFixture({ passengers: 19 })
  );
  // geo=40 + time=30 + cap=0 + discount=5 = 75
  assert.equal(score, 75);
});

test('no candidate departure_date → zero time factor', () => {
  const score = scoreCandidateAgainstLeg(
    baseLegFixture(),
    baseCandidateFixture({ departure_date: null })
  );
  // geo=40 + time=0 + cap=20 + discount=5 = 65
  assert.equal(score, 65);
});

test('candidate departure 30 days off the window → zero time factor', () => {
  const score = scoreCandidateAgainstLeg(
    baseLegFixture(),
    baseCandidateFixture({ departure_date: '2026-08-01' })
  );
  assert.ok(score < 95);
  // exact: geo=40 + time=0 + cap=20 + discount=5 = 65
  assert.equal(score, 65);
});

test('candidate departure 3 days before window → ~0.29 of TIME_WEIGHT', () => {
  const score = scoreCandidateAgainstLeg(
    baseLegFixture(),
    baseCandidateFixture({ departure_date: '2026-06-12' })
  );
  // distance ≈ 3d, scaled by 1 - 3/7 = 0.5714... × 0.5 = 0.2857
  // time ≈ round(0.2857 * 30) = 9 (range 8..10 due to rounding)
  // geo=40 + cap=20 + discount=5 = 65 baseline
  assert.ok(score >= 73 && score <= 75, `expected 73..75, got ${score}`);
});

test('zero IATA + zero match → discount + capacity only (25)', () => {
  const score = scoreCandidateAgainstLeg(
    baseLegFixture({ current_discount_pct: 50 }),
    baseCandidateFixture({
      origin_iata: 'CAI',
      destination_iata: 'IST',
      departure_date: '2026-12-01',
    })
  );
  // geo=0 + time=0 + cap=20 + discount=5 = 25
  assert.equal(score, 25);
});

test('weight constants individually', () => {
  assert.equal(GEO_WEIGHT, 40);
  assert.equal(TIME_WEIGHT, 30);
  assert.equal(CAPACITY_WEIGHT, 20);
  assert.equal(DISCOUNT_WEIGHT, 10);
});

// ============================================================
// shouldMarkOutboxProcessed branch decisions
// ============================================================

test('matched outcome → mark processed', () => {
  const outcome = {
    ok: true as const,
    matched: { leg_id: 'leg-1', rows_written: 5 },
  };
  assert.equal(shouldMarkOutboxProcessed(outcome), true);
});

test('suppress_notifications → mark processed (intentional skip)', () => {
  const outcome = {
    ok: true as const,
    skipped: 'suppress_notifications' as const,
    leg_id: 'leg-1',
  };
  assert.equal(shouldMarkOutboxProcessed(outcome), true);
});

test('notifications_disabled → leave unprocessed (replay after flag flip)', () => {
  const outcome = {
    ok: true as const,
    skipped: 'notifications_disabled' as const,
    leg_id: 'leg-1',
  };
  assert.equal(shouldMarkOutboxProcessed(outcome), false);
});

test('leg_not_found → mark processed (no point retrying deleted)', () => {
  const outcome = {
    ok: true as const,
    skipped: 'leg_not_found' as const,
    leg_id: 'leg-1',
  };
  assert.equal(shouldMarkOutboxProcessed(outcome), true);
});

test('error outcome → leave unprocessed (transient, replay)', () => {
  const outcome = {
    ok: false as const,
    leg_id: 'leg-1',
    error: 'enqueue_failed',
  };
  assert.equal(shouldMarkOutboxProcessed(outcome), false);
});

// ============================================================
// Summary
// ============================================================

// eslint-disable-next-line no-console
console.log(`\n[empty-legs-matching] ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
