/**
 * Phase 12 PR 2 — Zod schema tests for the operator offer
 * surface.
 *
 * Runs as: npm run test:medevac-offer-validators
 *
 * Cases (15 total):
 *   1. happy path → ok
 *   2. missing medevac_request_id → fails
 *   3. malformed medevac_request_id UUID → fails
 *   4. malformed aircraft_id UUID → fails
 *   5. base_price_sar = 0 → fails (must be positive)
 *   6. base_price_sar = -1 → fails
 *   7. base_price_sar > 99,999,999,999.99 → fails (overflow)
 *   8. medical_team_price_sar = -1 → fails
 *   9. medical_team_price_sar omitted defaults to 0 → ok
 *  10. proposed_pickup_at malformed string → fails
 *  11. proposed_pickup_at in the past → fails
 *  12. proposed_arrival_at <= proposed_pickup_at → fails
 *  13. operator_notes > 1000 chars → fails
 *  14. unknown field rejected by .strict() → fails
 *  15. medical_team_snapshot > 500 chars → fails
 */

import { strict as assert } from 'node:assert';

import { medevacOfferSchema } from '@/lib/medevac/validators/medevac-offer';

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
console.log('\n[medevac-offer-validators] running …\n');

const future = new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString();
const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString();

const happy = {
  medevac_request_id: '11111111-2222-4333-8444-555555555555',
  aircraft_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  aircraft_snapshot: 'Learjet 45 HZ-XXX',
  medical_team_snapshot: '1× physician + 2× paramedics',
  base_price_sar: 250_000,
  medical_team_price_sar: 50_000,
  insurance_coordination_price_sar: 10_000,
  proposed_pickup_at: future,
  proposed_arrival_at: farFuture,
  operator_notes: 'Aircraft is ICU-equipped',
};

// 1
test('happy path → ok', () => {
  const r = medevacOfferSchema.safeParse(happy);
  assert.equal(r.success, true);
});

// 2
test('missing medevac_request_id → fails', () => {
  const { medevac_request_id: _drop, ...rest } = happy;
  const r = medevacOfferSchema.safeParse(rest);
  assert.equal(r.success, false);
});

// 3
test('malformed medevac_request_id UUID → fails', () => {
  const r = medevacOfferSchema.safeParse({
    ...happy,
    medevac_request_id: 'not-a-uuid',
  });
  assert.equal(r.success, false);
});

// 4
test('malformed aircraft_id UUID → fails', () => {
  const r = medevacOfferSchema.safeParse({
    ...happy,
    aircraft_id: 'xxx',
  });
  assert.equal(r.success, false);
});

// 5
test('base_price_sar = 0 → fails', () => {
  const r = medevacOfferSchema.safeParse({ ...happy, base_price_sar: 0 });
  assert.equal(r.success, false);
});

// 6
test('base_price_sar = -1 → fails', () => {
  const r = medevacOfferSchema.safeParse({ ...happy, base_price_sar: -1 });
  assert.equal(r.success, false);
});

// 7
test('base_price_sar > cap → fails', () => {
  const r = medevacOfferSchema.safeParse({
    ...happy,
    base_price_sar: 99_999_999_999.999,
  });
  assert.equal(r.success, false);
});

// 8
test('medical_team_price_sar = -1 → fails', () => {
  const r = medevacOfferSchema.safeParse({
    ...happy,
    medical_team_price_sar: -1,
  });
  assert.equal(r.success, false);
});

// 9
test('medical_team_price_sar omitted defaults to 0 → ok', () => {
  const { medical_team_price_sar: _drop, ...rest } = happy;
  const r = medevacOfferSchema.safeParse(rest);
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.medical_team_price_sar, 0);
  }
});

// 10
test('proposed_pickup_at malformed → fails', () => {
  const r = medevacOfferSchema.safeParse({
    ...happy,
    proposed_pickup_at: 'not-a-date',
  });
  assert.equal(r.success, false);
});

// 11
test('proposed_pickup_at in the past → fails', () => {
  const past = new Date(Date.now() - 1000 * 60 * 60).toISOString();
  const r = medevacOfferSchema.safeParse({
    ...happy,
    proposed_pickup_at: past,
  });
  assert.equal(r.success, false);
});

// 12
test('proposed_arrival_at <= proposed_pickup_at → fails', () => {
  const r = medevacOfferSchema.safeParse({
    ...happy,
    proposed_arrival_at: happy.proposed_pickup_at,
  });
  assert.equal(r.success, false);
});

// 13
test('operator_notes > 1000 chars → fails', () => {
  const r = medevacOfferSchema.safeParse({
    ...happy,
    operator_notes: 'a'.repeat(1001),
  });
  assert.equal(r.success, false);
});

// 14
test('unknown field rejected by .strict() → fails', () => {
  const r = medevacOfferSchema.safeParse({
    ...happy,
    extra_unknown_field: 'value',
  });
  assert.equal(r.success, false);
});

// 15
test('medical_team_snapshot > 500 chars → fails', () => {
  const r = medevacOfferSchema.safeParse({
    ...happy,
    medical_team_snapshot: 'x'.repeat(501),
  });
  assert.equal(r.success, false);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
