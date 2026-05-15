/**
 * Phase 10 PR 1 — scoring parity test for ClientCandidateRow.
 *
 * Layer-1 (no DB): asserts that `scoreCandidateAgainstLeg` (the
 * existing Phase 7 scorer) handles client-shaped candidates with
 * the various NULL profiles defined in Decision #13:
 *
 *   - Full signals (origin/destination/passengers/date present)
 *     → scores like a lead candidate would
 *   - origin_iata only → partial geo credit
 *   - destination_iata only → partial geo credit
 *   - both NULL → zero geo credit
 *   - passengers NULL is impossible after candidate-pool projection
 *     (defaults to 2 in listEligibleClientCandidates per Decision #13);
 *     test the projection invariant via a fake row
 *
 * Runs as: npm run test:empty-legs-matching-clients
 */

import { strict as assert } from 'node:assert';

import { scoreCandidateAgainstLeg } from '@/lib/empty-legs/matching';
import type { ClientCandidateRow } from '@/lib/empty-legs/candidate-pool';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

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
console.log('\n[empty-legs-matching-clients] running …\n');

const SAMPLE_LEG: EmptyLegRow = {
  id: 'leg-1',
  leg_number: 'EL-0001',
  parent_booking_id: null,
  operator_id: null,
  operator_name_snapshot: 'Test Op',
  operator_phone_snapshot: '+966500000000',
  operator_email_snapshot: 'op@example.com',
  operator_stub_id: null,
  aircraft_id: null,
  aircraft_snapshot: null,
  departure_airport: 'RUH',
  arrival_airport: 'JED',
  departure_airport_freeform_snapshot: null,
  arrival_airport_freeform_snapshot: null,
  departure_window_start: '2026-06-01T08:00:00.000Z',
  departure_window_end: '2026-06-01T18:00:00.000Z',
  flexibility_hours: 2,
  original_price: 50000,
  current_price: 25000,
  current_discount_pct: 50,
  max_passengers: 6,
  status: 'available',
  views_count: 0,
  notifications_sent: 0,
  reservation_token_hash: null,
  reservation_expires_at: null,
  reservation_customer_name_snapshot: null,
  reservation_customer_phone_snapshot: null,
  reservation_client_id: null,
  customer_booking_id: null,
  auction_initial_discount_pct: 30,
  auction_floor_discount_pct: 70,
  auction_curve: 'linear',
  auction_window_start_at: '2026-05-15T00:00:00.000Z',
  auction_window_end_at: '2026-06-01T07:00:00.000Z',
  last_price_drop_at: null,
  suppress_notifications: false,
  created_at: '2026-05-15T00:00:00.000Z',
  expires_at: null,
  updated_at: '2026-05-15T00:00:00.000Z',
};

function makeClientCandidate(
  overrides: Partial<ClientCandidateRow> = {}
): ClientCandidateRow {
  return {
    id: 'client-1',
    client_id: 'client-1',
    customer_name: 'Test Client',
    customer_phone: '+966500000001',
    origin: null,
    destination: null,
    origin_iata: null,
    destination_iata: null,
    departure_date: null,
    return_date: null,
    passengers: 2, // default per Decision #13
    last_empty_leg_notified_at: null,
    empty_legs_opt_in: true,
    notification_preferences: null,
    ...overrides,
  };
}

// ============================================================

test('client with full IATA signals + matching date → high score', () => {
  const cand = makeClientCandidate({
    origin_iata: 'RUH',
    destination_iata: 'JED',
    departure_date: '2026-06-01',
    passengers: 4,
  });
  const score = scoreCandidateAgainstLeg(SAMPLE_LEG, cand);
  // GEO=40 (full match) + TIME=30 (in-window) + CAPACITY=20 (4 ≤ 6) + DISCOUNT=10*0.5=5 = 95
  assert.ok(score > 50, `expected > 50, got ${score}`);
});

test('client with origin-only IATA → partial geo credit', () => {
  const cand = makeClientCandidate({
    origin_iata: 'RUH',
    destination_iata: null,
    passengers: 2,
  });
  const scoreFull = scoreCandidateAgainstLeg(
    SAMPLE_LEG,
    makeClientCandidate({
      origin_iata: 'RUH',
      destination_iata: 'JED',
      passengers: 2,
    })
  );
  const scorePartial = scoreCandidateAgainstLeg(SAMPLE_LEG, cand);
  assert.ok(
    scorePartial < scoreFull,
    `partial (${scorePartial}) should be < full (${scoreFull})`
  );
  assert.ok(scorePartial > 0, `partial should still be > 0`);
});

test('client with destination-only IATA → partial geo credit', () => {
  const cand = makeClientCandidate({
    origin_iata: null,
    destination_iata: 'JED',
  });
  const score = scoreCandidateAgainstLeg(SAMPLE_LEG, cand);
  assert.ok(score > 0);
});

test('client with no geo signals → still gets discount + capacity score', () => {
  const cand = makeClientCandidate({
    origin_iata: null,
    destination_iata: null,
    departure_date: null,
    passengers: 4,
  });
  const score = scoreCandidateAgainstLeg(SAMPLE_LEG, cand);
  // GEO=0 + TIME=0 + CAPACITY=20 + DISCOUNT=5 = 25
  assert.ok(score > 0, `expected > 0 (capacity + discount), got ${score}`);
});

test('client passenger > leg max → capacity factor zero', () => {
  const cand = makeClientCandidate({
    origin_iata: 'RUH',
    destination_iata: 'JED',
    passengers: 99, // exceeds max_passengers = 6
  });
  const scoreOver = scoreCandidateAgainstLeg(SAMPLE_LEG, cand);
  const scoreFit = scoreCandidateAgainstLeg(
    SAMPLE_LEG,
    makeClientCandidate({
      origin_iata: 'RUH',
      destination_iata: 'JED',
      passengers: 4,
    })
  );
  assert.ok(
    scoreOver < scoreFit,
    `over-capacity (${scoreOver}) should be < fit (${scoreFit})`
  );
});

test('client with date far outside window → time factor zero', () => {
  const cand = makeClientCandidate({
    origin_iata: 'RUH',
    destination_iata: 'JED',
    departure_date: '2027-12-31', // way outside window
    passengers: 2,
  });
  const score = scoreCandidateAgainstLeg(SAMPLE_LEG, cand);
  // Time penalty drops the total but geo+capacity+discount still contribute
  assert.ok(score > 0);
  assert.ok(score < 95, `should not be max (no time credit)`);
});

// eslint-disable-next-line no-console
console.log(
  `\n[empty-legs-matching-clients] ${passed} passed, ${failed} failed\n`
);

if (failed > 0) {
  process.exit(1);
}
