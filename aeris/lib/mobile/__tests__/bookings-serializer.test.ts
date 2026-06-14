import assert from 'node:assert';

import { serializeBookingForMobile } from '@/lib/mobile/serializers/bookings';
import type { BookingRow } from '@/types/database';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

const SECRET_OP_PHONE = '+966500000000';
const SECRET_OP_EMAIL = 'ops@secret.example';
const SECRET_CHECKOUT = 'CHECKOUT_TOKEN_HASH_SECRET';
const SECRET_CUST_PHONE = '+966511111111';

const ROW = {
  id: 'bk-1',
  booking_number: 'BK-0001',
  offer_id: 'offer-internal',
  client_id: 'client-ME',
  customer_name_snapshot: 'My Own Name',
  customer_phone_snapshot: SECRET_CUST_PHONE,
  operator_id: 'op-1',
  operator_name_snapshot: 'Skybridge Aviation',
  operator_phone_snapshot: SECRET_OP_PHONE,
  operator_email_snapshot: SECRET_OP_EMAIL,
  aircraft_id: 'ac-1',
  aircraft_snapshot: 'Gulfstream G650',
  trip_request_id: 'tr-1',
  route_origin_iata: 'RUH',
  route_destination_iata: 'JED',
  route_origin_freeform_snapshot: null,
  route_destination_freeform_snapshot: null,
  passengers_count_snapshot: 6,
  return_scheduled: null,
  base_amount: 90000,
  addons_amount: 5000,
  vat_amount: 14250,
  total_amount: 109250,
  commission_amount: 13000,
  operator_payout: 82000,
  payment_status: 'pending_offline',
  flight_status: 'scheduled',
  zatca_invoice_url: null,
  zatca_qr_code: 'QR_INTERNAL',
  zatca_uuid: 'ZATCA_UUID_INTERNAL',
  departure_scheduled: '2026-07-10T08:00:00Z',
  departure_actual: null,
  arrival_actual: null,
  source_offer_table: 'phase4_operator_offers',
  source_offer_id: 'offer-internal',
  source_discriminator: 'charter',
  checkout_token_hash: SECRET_CHECKOUT,
  checkout_token_expires_at: '2026-07-01T00:00:00Z',
  loyalty_points_earned: 0,
  cancellation_reason: null,
  cancelled_at: null,
  created_at: '2026-06-19T00:00:00Z',
  updated_at: '2026-06-19T00:00:00Z',
} as unknown as BookingRow;

const out = serializeBookingForMobile(ROW);
const json = JSON.stringify(out);

test('exposes the client-facing fields', () => {
  assert.equal(out.booking_number, 'BK-0001');
  assert.equal(out.source, 'charter');
  assert.equal(out.total_amount, 109250);
  assert.equal(out.payment_status, 'pending_offline');
  assert.equal(out.flight_status, 'scheduled');
  assert.equal(out.operator_name, 'Skybridge Aviation');
  assert.equal(out.aircraft, 'Gulfstream G650');
});

test('NEVER leaks internal financials', () => {
  assert.ok(!('commission_amount' in out), 'commission_amount must be absent');
  assert.ok(!('operator_payout' in out), 'operator_payout must be absent');
  assert.ok(!json.includes('13000'), 'commission value leaked');
  assert.ok(!json.includes('82000'), 'payout value leaked');
});

test('NEVER leaks the checkout-link secret', () => {
  assert.ok(!('checkout_token_hash' in out));
  assert.ok(!json.includes(SECRET_CHECKOUT));
});

test('NEVER leaks operator contact PII or customer phone', () => {
  for (const secret of [SECRET_OP_PHONE, SECRET_OP_EMAIL, SECRET_CUST_PHONE]) {
    assert.ok(!json.includes(secret), `leaked: ${secret}`);
  }
  for (const key of Object.keys(out)) {
    assert.ok(!key.startsWith('operator_phone'), `bad key ${key}`);
    assert.ok(!key.startsWith('operator_email'), `bad key ${key}`);
    assert.notEqual(key, 'operator_id');
    assert.notEqual(key, 'checkout_token_hash');
    assert.notEqual(key, 'customer_phone_snapshot');
    assert.notEqual(key, 'source_offer_id');
    assert.notEqual(key, 'zatca_qr_code');
  }
});

// Pin the FULL allowlist as a key snapshot so any future field added to the
// serializer fails immediately — regardless of its value — closing the gap
// where a denylist only catches fields it already knows to look for.
const EXPECTED_KEYS = new Set([
  'id',
  'booking_number',
  'source',
  'route_origin_iata',
  'route_destination_iata',
  'route_origin_label',
  'route_destination_label',
  'passengers',
  'return_scheduled',
  'aircraft',
  'operator_name',
  'base_amount',
  'addons_amount',
  'vat_amount',
  'total_amount',
  'payment_status',
  'flight_status',
  'departure_scheduled',
  'departure_actual',
  'arrival_actual',
  'zatca_invoice_url',
  'trip_request_id',
  'loyalty_points_earned',
  'cancelled_at',
  'created_at',
  'updated_at',
]);

test('serializer key set is EXACTLY the allowlist (no extra field can sneak in)', () => {
  assert.deepEqual(new Set(Object.keys(out)), EXPECTED_KEYS);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
