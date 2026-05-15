/**
 * Phase 11 PR 2 — Zod schema tests for the cargo offer + action
 * surfaces.
 *
 * Layer-1 (no DB): pure schema parses for cargoOfferSchema +
 * acceptOfferSchema + declineOfferSchema + withdrawOfferSchema +
 * cancelRequestSchema. Validates the boundary at every Server
 * Action entry point.
 *
 * Cases (16 total):
 *   cargoOfferSchema:
 *     1. happy path with all fields → ok
 *     2. happy path optional fields omitted → ok
 *     3. delivery before pickup → fails (date order)
 *     4. base_price_sar = 0 → fails (positive)
 *     5. base_price_sar negative → fails
 *     6. insurance_price_sar negative → fails
 *     7. invalid aircraft_id (not UUID) → fails
 *     8. operator_notes 1001 chars → fails
 *     9. whitespace-only aircraft_snapshot trimmed
 *   declineOfferSchema:
 *    10. happy path with reason → ok
 *    11. happy path without reason → ok
 *    12. reason 501 chars → fails
 *    13. invalid offer_id → fails
 *   cancelRequestSchema:
 *    14. happy path with reason → ok
 *    15. invalid request_id → fails
 *   withdrawOfferSchema:
 *    16. happy path → ok
 *
 * Runs as: npm run test:cargo-offer-validators
 */

import { strict as assert } from 'node:assert';

import { cargoOfferSchema } from '@/lib/cargo/validators/cargo-offer';
import {
  acceptOfferSchema,
  declineOfferSchema,
  cancelRequestSchema,
  withdrawOfferSchema,
} from '@/lib/cargo/validators/cargo-actions';

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
console.log('\n[cargo-offer-validators] running …\n');

const REQUEST_UUID = '11111111-1111-1111-1111-111111111111';
const AIRCRAFT_UUID = '22222222-2222-2222-2222-222222222222';
const OFFER_UUID = '33333333-3333-3333-3333-333333333333';

const baseOffer = {
  cargo_request_id: REQUEST_UUID,
  aircraft_id: AIRCRAFT_UUID,
  base_price_sar: 50000,
  insurance_price_sar: 5000,
  customs_handling_price_sar: 3000,
  proposed_pickup_date: '2026-06-01',
  proposed_delivery_date: '2026-06-03',
};

// ============================================================
// cargoOfferSchema
// ============================================================

test('1. cargoOffer happy path with all fields → ok', () => {
  const r = cargoOfferSchema.safeParse({
    ...baseOffer,
    aircraft_snapshot: 'Boeing 747F',
    operator_notes: 'Custom climate-controlled hold',
  });
  assert.equal(r.success, true);
});

test('2. cargoOffer happy path optional fields omitted → ok', () => {
  const r = cargoOfferSchema.safeParse(baseOffer);
  assert.equal(r.success, true);
});

test('3. cargoOffer delivery before pickup → fails', () => {
  const r = cargoOfferSchema.safeParse({
    ...baseOffer,
    proposed_pickup_date: '2026-06-05',
    proposed_delivery_date: '2026-06-03',
  });
  assert.equal(r.success, false);
});

test('4. cargoOffer base_price = 0 → fails', () => {
  const r = cargoOfferSchema.safeParse({ ...baseOffer, base_price_sar: 0 });
  assert.equal(r.success, false);
});

test('5. cargoOffer base_price negative → fails', () => {
  const r = cargoOfferSchema.safeParse({ ...baseOffer, base_price_sar: -100 });
  assert.equal(r.success, false);
});

test('6. cargoOffer insurance_price negative → fails', () => {
  const r = cargoOfferSchema.safeParse({
    ...baseOffer,
    insurance_price_sar: -5,
  });
  assert.equal(r.success, false);
});

test('7. cargoOffer invalid aircraft_id (not UUID) → fails', () => {
  const r = cargoOfferSchema.safeParse({
    ...baseOffer,
    aircraft_id: 'not-uuid',
  });
  assert.equal(r.success, false);
});

test('8. cargoOffer operator_notes 1001 chars → fails', () => {
  const r = cargoOfferSchema.safeParse({
    ...baseOffer,
    operator_notes: 'a'.repeat(1001),
  });
  assert.equal(r.success, false);
});

test('9. cargoOffer whitespace-only aircraft_snapshot trimmed to empty', () => {
  const r = cargoOfferSchema.safeParse({
    ...baseOffer,
    aircraft_snapshot: '   ',
  });
  // The .trim() collapses to "" and .optional() lets it pass.
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.aircraft_snapshot, '');
  }
});

// ============================================================
// acceptOfferSchema
// ============================================================

test('10. acceptOffer happy path → ok', () => {
  const r = acceptOfferSchema.safeParse({ offer_id: OFFER_UUID });
  assert.equal(r.success, true);
});

// ============================================================
// declineOfferSchema
// ============================================================

test('11. declineOffer happy path with reason → ok', () => {
  const r = declineOfferSchema.safeParse({
    offer_id: OFFER_UUID,
    reason: 'سعر مرتفع',
  });
  assert.equal(r.success, true);
});

test('12. declineOffer happy path without reason → ok', () => {
  const r = declineOfferSchema.safeParse({ offer_id: OFFER_UUID });
  assert.equal(r.success, true);
});

test('13. declineOffer reason 501 chars → fails', () => {
  const r = declineOfferSchema.safeParse({
    offer_id: OFFER_UUID,
    reason: 'a'.repeat(501),
  });
  assert.equal(r.success, false);
});

test('14. declineOffer invalid offer_id → fails', () => {
  const r = declineOfferSchema.safeParse({ offer_id: 'not-uuid' });
  assert.equal(r.success, false);
});

// ============================================================
// cancelRequestSchema
// ============================================================

test('15. cancelRequest happy path with reason → ok', () => {
  const r = cancelRequestSchema.safeParse({
    request_id: REQUEST_UUID,
    reason: 'تم تأجيل الرحلة',
  });
  assert.equal(r.success, true);
});

test('16. cancelRequest invalid request_id → fails', () => {
  const r = cancelRequestSchema.safeParse({ request_id: 'not-uuid' });
  assert.equal(r.success, false);
});

// ============================================================
// withdrawOfferSchema
// ============================================================

test('17. withdrawOffer happy path → ok', () => {
  const r = withdrawOfferSchema.safeParse({ offer_id: OFFER_UUID });
  assert.equal(r.success, true);
});

// eslint-disable-next-line no-console
console.log(`\n[cargo-offer-validators] ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
