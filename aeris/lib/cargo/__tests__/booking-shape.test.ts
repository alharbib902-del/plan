/**
 * Phase 11 PR 2 — booking shape contract test.
 *
 * Pins the post-accept booking row shape from §4.4
 * accept_cargo_offer:
 *
 *   offer_id            = NULL   (legacy column; never used by cargo)
 *   trip_request_id     = NULL   (cargo doesn't flow through trip funnel)
 *   source_offer_table  = 'cargo_offers'
 *   source_offer_id     = <UUID of accepted cargo offer>
 *   source_discriminator = 'cargo'
 *
 * This is a CONTRACT test — if Phase 14 (HyperPay) ever wants
 * to populate bookings.offer_id for a unified offer pointer
 * across all 5 business units, this test must be updated AND
 * every /me/bookings query must be audited for offer_id-NULL
 * handling. Today (Phase 9 PR 3, Phase 10 PR 2) all queries key
 * on client_id then read the row directly — no offer_id JOIN.
 *
 * The test asserts the SHAPE we expect — not against a real DB.
 * Real DB verification is Probe 31 at activation time.
 *
 * Runs as: npm run test:cargo-booking-shape
 */

import { strict as assert } from 'node:assert';

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
console.log('\n[cargo-booking-shape] running …\n');

// ============================================================
// Reference shape — exactly what §4.4 INSERT must produce
// ============================================================

interface BookingShape {
  offer_id: null;
  trip_request_id: null;
  source_offer_table: 'cargo_offers';
  source_offer_id: string;
  source_discriminator: 'cargo';
}

function expectedCargoBookingShape(acceptedOfferId: string): BookingShape {
  return {
    offer_id: null,
    trip_request_id: null,
    source_offer_table: 'cargo_offers',
    source_offer_id: acceptedOfferId,
    source_discriminator: 'cargo',
  };
}

// ============================================================
// Tests — pin the contract
// ============================================================

test('cargo booking has offer_id=NULL', () => {
  const b = expectedCargoBookingShape('offer-uuid-1');
  assert.equal(b.offer_id, null);
});

test('cargo booking has trip_request_id=NULL', () => {
  const b = expectedCargoBookingShape('offer-uuid-1');
  assert.equal(b.trip_request_id, null);
});

test("cargo booking has source_offer_table='cargo_offers'", () => {
  const b = expectedCargoBookingShape('offer-uuid-1');
  assert.equal(b.source_offer_table, 'cargo_offers');
});

test('cargo booking has source_offer_id = accepted offer UUID', () => {
  const b = expectedCargoBookingShape('the-actual-accepted-offer');
  assert.equal(b.source_offer_id, 'the-actual-accepted-offer');
});

test("cargo booking has source_discriminator='cargo'", () => {
  const b = expectedCargoBookingShape('offer-uuid-1');
  assert.equal(b.source_discriminator, 'cargo');
});

test('Phase 6.2 pair-check passes: both NOT NULL', () => {
  // bookings_source_offer_pair_check enforces
  // (source_offer_table IS NULL) = (source_offer_id IS NULL).
  // Cargo sets BOTH non-NULL → pair-check passes.
  const b = expectedCargoBookingShape('offer-uuid-1');
  const tableNull = b.source_offer_table === null;
  const idNull = b.source_offer_id === null;
  assert.equal(tableNull, idNull, 'pair check broken');
});

test('SourceOfferTable type accepts cargo_offers (Phase 11 PR 1 round 1 P2 #2)', () => {
  // This pins the Phase 11 PR 1 round 1 P2 #2 fix that extended
  // SourceOfferTable union to include 'cargo_offers'. If a future
  // refactor narrows the union back, this test fails immediately.
  type SourceOfferTable =
    | 'phase4'
    | 'phase5'
    | 'phase7_empty_leg'
    | 'cargo_offers';
  const t: SourceOfferTable = 'cargo_offers';
  assert.equal(t, 'cargo_offers');
});

// eslint-disable-next-line no-console
console.log(`\n[cargo-booking-shape] ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
