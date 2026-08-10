// Push retry sweep — unit tests for the pure decision helpers behind
// `/api/cron/push/retry-sweep`. Layer-1 (no DB, no FCM).
// Runs as `npm run test:push-retry-sweep`.

import { strict as assert } from 'node:assert';

import {
  parseRetryableDeliveries,
  resolveSweepAction,
  type RetryableDeliveryRow,
  type SweepLegRow,
} from '@/lib/push/retry-sweep';

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

const delivery: RetryableDeliveryRow = {
  id: 'd-1',
  client_id: 'c-1',
  leg_id: 'l-1',
  event_type: 'published',
};

function leg(overrides: Partial<SweepLegRow> = {}): SweepLegRow {
  return {
    id: 'l-1',
    leg_number: 'EL-1001',
    status: 'available',
    current_price: 12000,
    departure_airport: 'RUH',
    departure_airport_freeform_snapshot: null,
    arrival_airport: 'JED',
    arrival_airport_freeform_snapshot: null,
    ...overrides,
  };
}

// ── parseRetryableDeliveries ───────────────────────────────────────────

test('parse: valid rows pass through with only the sweep fields', () => {
  assert.deepEqual(
    parseRetryableDeliveries([
      {
        id: 'd-1',
        client_id: 'c-1',
        leg_id: 'l-1',
        event_type: 'price_dropped',
        status: 'failed_transient',
        attempt_count: 2,
      },
    ]),
    [
      {
        id: 'd-1',
        client_id: 'c-1',
        leg_id: 'l-1',
        event_type: 'price_dropped',
      },
    ]
  );
});

test('parse: malformed rows are dropped, valid ones kept (fail-soft)', () => {
  const rows = parseRetryableDeliveries([
    null,
    'junk',
    { id: 'd-x' }, // missing fields
    { id: 'd-y', client_id: 'c', leg_id: 'l', event_type: 'weird' },
    { id: 'd-2', client_id: 'c-2', leg_id: 'l-2', event_type: 'published' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'd-2');
});

test('parse: empty input → empty output', () => {
  assert.deepEqual(parseRetryableDeliveries([]), []);
});

// ── resolveSweepAction: expire paths ───────────────────────────────────

test('expire: missing leg → leg_missing', () => {
  assert.deepEqual(resolveSweepAction(delivery, undefined, true), {
    kind: 'expire',
    reason: 'leg_missing',
  });
});

test('expire: client opted out since the original attempt → opted_out', () => {
  assert.deepEqual(resolveSweepAction(delivery, leg(), false), {
    kind: 'expire',
    reason: 'opted_out',
  });
});

test('expire: booked/expired/cancelled leg → leg_unavailable', () => {
  for (const status of ['booked', 'expired', 'cancelled']) {
    assert.deepEqual(resolveSweepAction(delivery, leg({ status }), true), {
      kind: 'expire',
      reason: 'leg_unavailable',
    });
  }
});

test('expire: opt-out wins over leg state (privacy first)', () => {
  assert.deepEqual(
    resolveSweepAction(delivery, leg({ status: 'booked' }), false),
    { kind: 'expire', reason: 'opted_out' }
  );
});

// ── resolveSweepAction: dispatch paths ─────────────────────────────────

test('dispatch: available leg rebuilds the full dispatcher args', () => {
  assert.deepEqual(resolveSweepAction(delivery, leg(), true), {
    kind: 'dispatch',
    args: {
      clientId: 'c-1',
      legId: 'l-1',
      legNumber: 'EL-1001',
      eventType: 'published',
      routeFrom: 'RUH',
      routeTo: 'JED',
      currentPrice: 12000,
    },
  });
});

test('dispatch: reserved leg is still redispatchable (matcher parity)', () => {
  const action = resolveSweepAction(delivery, leg({ status: 'reserved' }), true);
  assert.equal(action.kind, 'dispatch');
});

test('dispatch: freeform snapshot fills a missing IATA, em-dash last', () => {
  const action = resolveSweepAction(
    delivery,
    leg({
      departure_airport: null,
      departure_airport_freeform_snapshot: 'مطار خاص - الرياض',
      arrival_airport: '  ',
      arrival_airport_freeform_snapshot: null,
    }),
    true
  );
  assert.equal(action.kind, 'dispatch');
  if (action.kind === 'dispatch') {
    assert.equal(action.args.routeFrom, 'مطار خاص - الرياض');
    assert.equal(action.args.routeTo, '—');
  }
});

test('dispatch: null current_price passes through (pricing-hidden mode)', () => {
  const action = resolveSweepAction(
    { ...delivery, event_type: 'price_dropped' },
    leg({ current_price: null }),
    true
  );
  assert.equal(action.kind, 'dispatch');
  if (action.kind === 'dispatch') {
    assert.equal(action.args.currentPrice, null);
    assert.equal(action.args.eventType, 'price_dropped');
  }
});

// ── summary ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-console
console.log(`\n[retry-sweep] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
