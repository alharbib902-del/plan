/**
 * Phase 9 PR 3 — unit tests for the Zod validators that pin
 * the `clientAcceptOffer` + `clientDeclineOffer` Server Action
 * input contracts.
 *
 * Layer-1 (no DB / no Next): exercises the schemas directly.
 * Documents the upstream Zod contract that the Server Action
 * layer relies on so bad payloads (non-UUID id, unknown source)
 * are caught BEFORE the network round-trip.
 *
 * Runs as:
 *   npm run test:clients-offer-action-validators
 *
 * Cases covered:
 *   1.  Accept: happy-path phase4 passes
 *   2.  Accept: happy-path phase5 passes
 *   3.  Accept: invalid UUID rejected
 *   4.  Accept: unknown source ('phase6') rejected
 *   5.  Accept: missing source rejected
 *   6.  Decline: happy-path phase4 passes
 *   7.  Decline: happy-path phase5 passes
 *   8.  Decline: invalid UUID rejected
 *   9.  Decline: unknown source rejected
 *  10.  Both: empty object rejected
 */

import { strict as assert } from 'node:assert';

import {
  acceptOfferSchema,
  declineOfferSchema,
} from '../../validators/clients';

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

const VALID_UUID = '11111111-2222-4333-8444-555555555555';

test('1. accept: happy-path phase4 passes', () => {
  const r = acceptOfferSchema.safeParse({
    offer_id: VALID_UUID,
    source: 'phase4',
  });
  assert.equal(r.success, true);
});

test('2. accept: happy-path phase5 passes', () => {
  const r = acceptOfferSchema.safeParse({
    offer_id: VALID_UUID,
    source: 'phase5',
  });
  assert.equal(r.success, true);
});

test('3. accept: invalid UUID rejected', () => {
  const r = acceptOfferSchema.safeParse({
    offer_id: 'not-a-uuid',
    source: 'phase4',
  });
  assert.equal(r.success, false);
});

test("4. accept: unknown source ('phase6') rejected", () => {
  const r = acceptOfferSchema.safeParse({
    offer_id: VALID_UUID,
    source: 'phase6' as unknown as 'phase4',
  });
  assert.equal(r.success, false);
});

test('5. accept: missing source rejected', () => {
  const r = acceptOfferSchema.safeParse({
    offer_id: VALID_UUID,
  } as unknown as { offer_id: string; source: 'phase4' });
  assert.equal(r.success, false);
});

test('6. decline: happy-path phase4 passes', () => {
  const r = declineOfferSchema.safeParse({
    offer_id: VALID_UUID,
    source: 'phase4',
  });
  assert.equal(r.success, true);
});

test('7. decline: happy-path phase5 passes', () => {
  const r = declineOfferSchema.safeParse({
    offer_id: VALID_UUID,
    source: 'phase5',
  });
  assert.equal(r.success, true);
});

test('8. decline: invalid UUID rejected', () => {
  const r = declineOfferSchema.safeParse({
    offer_id: 'still-not-a-uuid',
    source: 'phase5',
  });
  assert.equal(r.success, false);
});

test('9. decline: unknown source rejected', () => {
  const r = declineOfferSchema.safeParse({
    offer_id: VALID_UUID,
    source: 'foo' as unknown as 'phase4',
  });
  assert.equal(r.success, false);
});

test('10. both: empty object rejected', () => {
  assert.equal(acceptOfferSchema.safeParse({}).success, false);
  assert.equal(declineOfferSchema.safeParse({}).success, false);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
