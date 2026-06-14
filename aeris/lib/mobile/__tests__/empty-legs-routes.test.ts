/**
 * Phase 0 (mobile API) — route-level unit tests for the empty-legs
 * decision points the handlers delegate to.
 *
 * Layer-1 (no DB, no HTTP server). Runs as
 * `npm run test:mobile-empty-legs-routes`.
 *
 * Closes the Codex P3 follow-up on PR #149 (route logic had only the
 * serializer covered). Pins:
 *   - the GUEST list price-inference guard: `max_price` is honoured
 *     only when client pricing is visible, DROPPED otherwise.
 *   - the reserve response price gate: `price_at_reservation_sar` is
 *     omitted when pricing is hidden, present when visible.
 */

import { strict as assert } from 'node:assert';

import {
  parsePublicEmptyLegsQuery,
  buildReserveResponseBody,
  type ReserveResultFields,
} from '@/lib/mobile/empty-legs-route-helpers';

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

function params(record: Record<string, string>): URLSearchParams {
  return new URLSearchParams(record);
}

// ============================================================
// parsePublicEmptyLegsQuery — price-inference guard (req 1)
// ============================================================

test('pricing OFF → max_price is IGNORED (dropped to null)', () => {
  const q = parsePublicEmptyLegsQuery(params({ max_price: '50000' }), false);
  assert.equal(q.maxPrice, null);
});

test('pricing ON → max_price is parsed and applied', () => {
  const q = parsePublicEmptyLegsQuery(params({ max_price: '50000' }), true);
  assert.equal(q.maxPrice, 50000);
});

test('pricing OFF → max_price ignored regardless of value (no SAR inference)', () => {
  // Even a non-numeric probe must not survive — the guard wins before
  // parsing, so a guest can never binary-search the hidden figure.
  for (const probe of ['1', '999999999', 'abc', '0']) {
    const q = parsePublicEmptyLegsQuery(params({ max_price: probe }), false);
    assert.equal(q.maxPrice, null, `max_price=${probe} must drop to null`);
  }
});

test('pricing ON but no max_price → null (filter simply absent)', () => {
  const q = parsePublicEmptyLegsQuery(params({}), true);
  assert.equal(q.maxPrice, null);
});

test('departure is trimmed to 64 chars; blank → null', () => {
  assert.equal(parsePublicEmptyLegsQuery(params({}), false).departure, null);
  assert.equal(
    parsePublicEmptyLegsQuery(params({ departure: 'RUH' }), false).departure,
    'RUH'
  );
  const long = 'x'.repeat(100);
  assert.equal(
    parsePublicEmptyLegsQuery(params({ departure: long }), false).departure
      ?.length,
    64
  );
});

test('min_passengers parsed when present, null when absent', () => {
  assert.equal(
    parsePublicEmptyLegsQuery(params({ min_passengers: '6' }), false)
      .minPassengers,
    6
  );
  assert.equal(
    parsePublicEmptyLegsQuery(params({}), false).minPassengers,
    null
  );
});

test('limit defaults to 50 and is clamped to [1, 50]', () => {
  assert.equal(parsePublicEmptyLegsQuery(params({}), false).limit, 50);
  assert.equal(
    parsePublicEmptyLegsQuery(params({ limit: '5' }), false).limit,
    5
  );
  assert.equal(
    parsePublicEmptyLegsQuery(params({ limit: '999' }), false).limit,
    50
  );
  assert.equal(
    parsePublicEmptyLegsQuery(params({ limit: '0' }), false).limit,
    1
  );
  assert.equal(
    parsePublicEmptyLegsQuery(params({ limit: 'abc' }), false).limit,
    50
  );
});

// ============================================================
// buildReserveResponseBody — reserve price gate (req 3)
// ============================================================

const RESERVE: ReserveResultFields = {
  leg_id: 'leg-uuid-1',
  reserved_at: '2026-07-01T08:00:00Z',
  expires_at: '2026-07-01T09:00:00Z',
  price_at_reservation: 70000,
};

test('pricing ON → response includes price_at_reservation_sar', () => {
  const out = buildReserveResponseBody(RESERVE, true);
  assert.equal(out.price_at_reservation_sar, 70000);
  assert.equal(out.leg_id, 'leg-uuid-1');
  assert.equal(out.reserved_at, '2026-07-01T08:00:00Z');
  assert.equal(out.expires_at, '2026-07-01T09:00:00Z');
});

test('pricing OFF → response OMITS price_at_reservation_sar', () => {
  const out = buildReserveResponseBody(RESERVE, false);
  assert.ok(
    !('price_at_reservation_sar' in out),
    'price_at_reservation_sar must be absent'
  );
  // The non-price fields still ship.
  assert.equal(out.leg_id, 'leg-uuid-1');
  assert.equal(out.reserved_at, '2026-07-01T08:00:00Z');
  assert.equal(out.expires_at, '2026-07-01T09:00:00Z');
});

test('the raw price_at_reservation key never leaks (only the _sar alias)', () => {
  for (const visible of [true, false]) {
    const out = buildReserveResponseBody(RESERVE, visible);
    assert.ok(
      !('price_at_reservation' in out),
      `raw price_at_reservation must not appear (pricing=${visible})`
    );
  }
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
