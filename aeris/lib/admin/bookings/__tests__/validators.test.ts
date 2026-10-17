/**
 * Admin bookings — Zod validators + pure helpers used by the Server
 * Actions (app/(admin)/admin/actions/bookings.ts) and the admin pages.
 *
 * Runs as: npm run test:admin-bookings-validators
 */

import { strict as assert } from 'node:assert';

import {
  BOOKING_ACTION_ERROR_AR,
  bookingActionErrorAr,
  bookingNetDue,
  bookingsListHref,
  flightStatusOptions,
  formatBookingRoute,
  parseFlightFilter,
  parsePage,
  parsePaymentFilter,
} from '../constants';
import {
  confirmOfflinePaymentSchema,
  fieldErrorsFromIssues,
  normalizeAmountInput,
  setFlightStatusSchema,
} from '../validators';

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

const BOOKING_ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8a9b0c1d2e';

function firstError(result: {
  success: boolean;
  error?: { issues: { path: (string | number)[]; message: string }[] };
}): Record<string, string> {
  assert.equal(result.success, false, 'expected a validation failure');
  return fieldErrorsFromIssues(result.error?.issues ?? []);
}

// ---- confirmOfflinePaymentSchema --------------------------------------------

test('confirm: valid input passes and trims', () => {
  const r = confirmOfflinePaymentSchema.safeParse({
    booking_id: BOOKING_ID,
    received_amount: ' 85000.50 ',
    reference: '  TRX-123  ',
    note: '  via Al Rajhi  ',
  });
  assert.ok(r.success);
  assert.equal(r.data.received_amount, '85000.50');
  assert.equal(r.data.reference, 'TRX-123');
  assert.equal(r.data.note, 'via Al Rajhi');
});

test('confirm: empty / whitespace note becomes undefined', () => {
  for (const note of [undefined, '', '   ']) {
    const r = confirmOfflinePaymentSchema.safeParse({
      booking_id: BOOKING_ID,
      received_amount: '100',
      reference: 'R1',
      note,
    });
    assert.ok(r.success);
    assert.equal(r.data.note, undefined);
  }
});

test('confirm: amount normalisation (thousands separators, Arabic digits)', () => {
  assert.equal(normalizeAmountInput('85,000'), '85000');
  assert.equal(normalizeAmountInput('١٢٬٥٠٠٫٧٥'), '12500.75');
  assert.equal(normalizeAmountInput('۱۲۳'), '123');
  assert.equal(normalizeAmountInput(42), 42);
  const r = confirmOfflinePaymentSchema.safeParse({
    booking_id: BOOKING_ID,
    received_amount: '١٢٬٥٠٠',
    reference: 'R1',
  });
  assert.ok(r.success);
  assert.equal(r.data.received_amount, '12500');
});

test('confirm: rejects zero / negative / 3 decimals / text / number type', () => {
  for (const received_amount of ['0', '0.00', '-5', '10.123', 'abc', '', '1e5']) {
    const errs = firstError(
      confirmOfflinePaymentSchema.safeParse({
        booking_id: BOOKING_ID,
        received_amount,
        reference: 'R1',
      })
    );
    assert.equal(errs.received_amount, 'amount_invalid', `for ${received_amount}`);
  }
  const errs = firstError(
    confirmOfflinePaymentSchema.safeParse({
      booking_id: BOOKING_ID,
      received_amount: 100,
      reference: 'R1',
    })
  );
  assert.ok(errs.received_amount);
});

test('confirm: reference required + capped at 120', () => {
  assert.equal(
    firstError(
      confirmOfflinePaymentSchema.safeParse({
        booking_id: BOOKING_ID,
        received_amount: '1',
        reference: '   ',
      })
    ).reference,
    'reference_required'
  );
  assert.equal(
    firstError(
      confirmOfflinePaymentSchema.safeParse({
        booking_id: BOOKING_ID,
        received_amount: '1',
        reference: 'x'.repeat(121),
      })
    ).reference,
    'reference_too_long'
  );
});

test('confirm: note capped at 500; bad booking id rejected', () => {
  const errs = firstError(
    confirmOfflinePaymentSchema.safeParse({
      booking_id: 'not-a-uuid',
      received_amount: '1',
      reference: 'R',
      note: 'n'.repeat(501),
    })
  );
  assert.equal(errs.note, 'note_too_long');
  assert.equal(errs.booking_id, 'booking_not_found');
});

// ---- setFlightStatusSchema ---------------------------------------------------

test('flight: valid transition input passes', () => {
  const r = setFlightStatusSchema.safeParse({
    booking_id: BOOKING_ID,
    status: 'completed',
  });
  assert.ok(r.success);
  assert.equal(r.data.status, 'completed');
});

test('flight: unknown status rejected with status_required', () => {
  for (const status of ['in_progress', 'COMPLETED', '', undefined]) {
    const errs = firstError(
      setFlightStatusSchema.safeParse({ booking_id: BOOKING_ID, status })
    );
    assert.equal(errs.status, 'status_required', `for ${String(status)}`);
  }
});

test('flight: cancel requires a reason', () => {
  assert.equal(
    firstError(
      setFlightStatusSchema.safeParse({
        booking_id: BOOKING_ID,
        status: 'cancelled',
        note: '  ',
      })
    ).note,
    'cancel_reason_required'
  );
  const ok = setFlightStatusSchema.safeParse({
    booking_id: BOOKING_ID,
    status: 'cancelled',
    note: 'client withdrew',
  });
  assert.ok(ok.success);
});

test('every validator error code has an Arabic message', () => {
  for (const code of [
    'amount_invalid',
    'reference_required',
    'reference_too_long',
    'note_too_long',
    'booking_not_found',
    'status_required',
    'cancel_reason_required',
    'validation_failed',
    'rpc_failed',
  ]) {
    assert.ok(BOOKING_ACTION_ERROR_AR[code], code);
  }
  assert.equal(bookingActionErrorAr('totally_unknown'), BOOKING_ACTION_ERROR_AR.rpc_failed);
});

// ---- list helpers -------------------------------------------------------------

test('filters: known values pass, unknown fall back to all', () => {
  assert.equal(parsePaymentFilter('pending_offline'), 'pending_offline');
  assert.equal(parsePaymentFilter(' PAID '), 'paid');
  assert.equal(parsePaymentFilter('bogus'), 'all');
  assert.equal(parsePaymentFilter(undefined), 'all');
  assert.equal(parseFlightFilter('in_flight'), 'in_flight');
  assert.equal(parseFlightFilter('landed'), 'all');
});

test('page: integers ≥ 1 only', () => {
  assert.equal(parsePage(undefined), 1);
  assert.equal(parsePage('3'), 3);
  assert.equal(parsePage('0'), 1);
  assert.equal(parsePage('-2'), 1);
  assert.equal(parsePage('2.5'), 1);
  assert.equal(parsePage('abc'), 1);
  assert.equal(parsePage('9999999'), 1);
});

test('list href keeps filters and drops page 1', () => {
  assert.equal(bookingsListHref({ payment: 'all', flight: 'all' }), '/admin/bookings');
  assert.equal(
    bookingsListHref({ payment: 'paid', flight: 'completed', page: 2 }),
    '/admin/bookings?payment=paid&flight=completed&page=2'
  );
  assert.equal(
    bookingsListHref({ payment: 'pending_offline', flight: 'all', page: 1 }),
    '/admin/bookings?payment=pending_offline'
  );
});

test('net due = total − redemption (halala-rounded)', () => {
  assert.equal(bookingNetDue(1000, null), 1000);
  assert.equal(bookingNetDue(1000, 250.5), 749.5);
  assert.equal(bookingNetDue(0.3, 0.1), 0.2);
});

test('route renders IATA first, freeform fallback, dash when missing', () => {
  assert.equal(
    formatBookingRoute({
      route_origin_iata: 'RUH',
      route_destination_iata: null,
      route_origin_freeform_snapshot: 'ignored',
      route_destination_freeform_snapshot: 'جدة',
    }),
    'RUH → جدة'
  );
  assert.equal(
    formatBookingRoute({
      route_origin_iata: null,
      route_destination_iata: null,
      route_origin_freeform_snapshot: null,
      route_destination_freeform_snapshot: null,
    }),
    '— → —'
  );
});

// ---- flight-status options (UI mirror of the RPC guards) ------------------

const NOW = Date.parse('2026-10-17T12:00:00Z');
const PAST = '2026-10-16T08:00:00Z';
const FUTURE = '2026-10-20T08:00:00Z';

function opts(over: Partial<Parameters<typeof flightStatusOptions>[0]>) {
  return Object.fromEntries(
    flightStatusOptions({
      flight_status: 'confirmed',
      payment_status: 'pending_offline',
      paid_at: null,
      cashback_redemption_sar: 0,
      departure_scheduled: PAST,
      hasActivePaymentAttempt: false,
      now: NOW,
      ...over,
    }).map((o) => [o.value, o.blockedReason])
  );
}

test('options: confirmed offers boarding/in_flight/completed/cancelled', () => {
  assert.deepEqual(Object.keys(opts({})).sort(), [
    'boarding',
    'cancelled',
    'completed',
    'in_flight',
  ]);
});

test('options: completed blocked until paid, then until departed', () => {
  assert.ok(opts({}).completed);
  assert.equal(opts({ payment_status: 'paid', paid_at: PAST }).completed, null);
  assert.ok(
    opts({ payment_status: 'paid', paid_at: PAST, departure_scheduled: FUTURE })
      .completed
  );
});

test('options: cancel blocked when paid / redeemed / live attempt', () => {
  assert.equal(opts({}).cancelled, null);
  assert.ok(opts({ payment_status: 'paid', paid_at: PAST }).cancelled);
  assert.ok(opts({ cashback_redemption_sar: 50 }).cancelled);
  assert.ok(opts({ hasActivePaymentAttempt: true }).cancelled);
});

test('options: terminal states offer nothing; in_flight only completes', () => {
  assert.deepEqual(opts({ flight_status: 'completed' }), {});
  assert.deepEqual(opts({ flight_status: 'cancelled' }), {});
  assert.deepEqual(Object.keys(opts({ flight_status: 'in_flight' })), ['completed']);
});

// eslint-disable-next-line no-console
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
