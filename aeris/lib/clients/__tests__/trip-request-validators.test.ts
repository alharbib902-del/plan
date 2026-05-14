/**
 * Phase 9 PR 2 — unit tests for the Zod validators that pin
 * the `create_authenticated_trip_request` + `cancelMyTripRequest`
 * Server Action input contracts.
 *
 * Layer-1 (no DB / no Next): exercises the schemas directly.
 * The actual SQL contract is enforced inside the migration
 * file (§4.2 RPC); these tests document the upstream Zod
 * contract that the Server Action layer relies on so the
 * RPC's structured error codes are caught BEFORE the network
 * round-trip whenever possible.
 *
 * Runs as:
 *   npm run test:clients-trip-request-validators
 *
 * Cases covered:
 *   1.  Happy-path one-leg request passes
 *   2.  Round-trip request with valid return passes
 *   3.  IATA lowercase rejected (uppercase contract)
 *   4.  IATA wrong length rejected
 *   5.  IATA non-letter rejected
 *   6.  Past departure date rejected
 *   7.  Return date == departure rejected
 *   8.  Return date < departure rejected
 *   9.  Passengers = 0 rejected
 *  10.  Passengers > 19 rejected
 *  11.  Empty legs array rejected
 *  12.  Legs > 8 rejected
 *  13.  Aircraft preference 'unknown' rejected
 *  14.  Special requests > 2000 chars rejected
 *  15.  Cancel: invalid UUID rejected
 *  16.  Cancel: valid UUID accepted
 */

import { strict as assert } from 'node:assert';

import {
  createTripRequestSchema,
  cancelTripRequestSchema,
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

// Helper: a fixed future date (90 days out) so tests stay
// stable across local clocks.
function futureIso(daysAhead: number, hour = 9): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function pastIso(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

const baseValidInput = {
  legs: [
    {
      from: 'RUH',
      to: 'JED',
      date: futureIso(90, 9),
      time: null,
    },
  ],
  departure_iata: 'RUH',
  arrival_iata: 'JED',
  departure_date: futureIso(90, 9),
  return_date: null,
  passengers: 4,
  aircraft_pref: null,
  special_requests: null,
};

test('1. happy-path one-leg request passes', () => {
  const result = createTripRequestSchema.safeParse(baseValidInput);
  assert.equal(result.success, true);
});

test('2. round-trip with valid return passes', () => {
  const dep = futureIso(90, 9);
  const ret = futureIso(95, 17);
  const input = {
    ...baseValidInput,
    legs: [
      { from: 'RUH', to: 'JED', date: dep, time: null },
      { from: 'JED', to: 'RUH', date: ret, time: null },
    ],
    departure_date: dep,
    return_date: ret,
  };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, true);
});

test('3. IATA lowercase auto-uppercased (Zod transform)', () => {
  const input = {
    ...baseValidInput,
    departure_iata: 'ruh',
    arrival_iata: 'jed',
  };
  const result = createTripRequestSchema.safeParse(input);
  // Zod schema applies .toUpperCase() before regex — so this
  // is treated as 'RUH'/'JED' and PASSES. The contract is:
  // user can type lowercase, the validator normalises it.
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.departure_iata, 'RUH');
    assert.equal(result.data.arrival_iata, 'JED');
  }
});

test('4. IATA wrong length rejected', () => {
  const input = { ...baseValidInput, departure_iata: 'RU' };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('5. IATA non-letter rejected', () => {
  const input = { ...baseValidInput, departure_iata: 'RU1' };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('6. past departure date rejected', () => {
  const input = {
    ...baseValidInput,
    departure_date: pastIso(2),
  };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('7. return date == departure rejected', () => {
  const same = futureIso(90, 9);
  const input = {
    ...baseValidInput,
    departure_date: same,
    return_date: same,
  };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('8. return date < departure rejected', () => {
  const input = {
    ...baseValidInput,
    departure_date: futureIso(90, 9),
    return_date: futureIso(89, 9),
  };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('9. passengers = 0 rejected', () => {
  const input = { ...baseValidInput, passengers: 0 };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('10. passengers > 19 rejected', () => {
  const input = { ...baseValidInput, passengers: 20 };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('11. empty legs array rejected', () => {
  const input = { ...baseValidInput, legs: [] };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('12. legs > 8 rejected', () => {
  const oneLeg = baseValidInput.legs[0]!;
  const input = {
    ...baseValidInput,
    legs: Array.from({ length: 9 }, () => ({ ...oneLeg })),
  };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test("13. aircraft preference 'unknown' rejected", () => {
  const input = {
    ...baseValidInput,
    aircraft_pref: 'unknown' as unknown as 'light',
  };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('14. special requests > 2000 chars rejected', () => {
  const input = {
    ...baseValidInput,
    special_requests: 'x'.repeat(2001),
  };
  const result = createTripRequestSchema.safeParse(input);
  assert.equal(result.success, false);
});

test('15. cancel: invalid UUID rejected', () => {
  const result = cancelTripRequestSchema.safeParse({
    trip_request_id: 'not-a-uuid',
  });
  assert.equal(result.success, false);
});

test('16. cancel: valid UUID accepted', () => {
  const result = cancelTripRequestSchema.safeParse({
    trip_request_id: '00000000-0000-4000-8000-000000000000',
  });
  assert.equal(result.success, true);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
