import assert from 'node:assert';

import {
  serializeEmptyLegForMobile,
  serializeAlertForMobile,
} from '@/lib/mobile/serializers/empty-legs';
import type { EmptyLegRow } from '@/lib/empty-legs/types';
import type { ClientEmptyLegAlertRow } from '@/lib/empty-legs/alerts';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

function withPricing(value: boolean, fn: () => void): void {
  const prev = process.env.ENABLE_EMPTY_LEGS_CLIENT_PRICING;
  try {
    process.env.ENABLE_EMPTY_LEGS_CLIENT_PRICING = value ? 'true' : 'false';
    fn();
  } finally {
    if (prev === undefined) delete process.env.ENABLE_EMPTY_LEGS_CLIENT_PRICING;
    else process.env.ENABLE_EMPTY_LEGS_CLIENT_PRICING = prev;
  }
}

// A reserved leg carrying every sensitive field the raw row holds.
const SECRET_OP_PHONE = '+966500000000';
const SECRET_CUST_PHONE = '+966511111111';
const SECRET_TOKEN_HASH = 'TOKENHASH_SECRET';
const RESERVER_ID = 'client-RESERVER';

const ROW = {
  id: 'leg-uuid-1',
  leg_number: 'EL-0001',
  parent_booking_id: 'booking-internal',
  operator_id: 'op-1',
  operator_name_snapshot: 'Secret Operator Co',
  operator_phone_snapshot: SECRET_OP_PHONE,
  operator_email_snapshot: 'ops@secret.example',
  operator_stub_id: 'stub-1',
  aircraft_id: 'ac-1',
  aircraft_snapshot: 'Gulfstream G650',
  departure_airport: 'RUH',
  arrival_airport: 'JED',
  departure_airport_freeform_snapshot: null,
  arrival_airport_freeform_snapshot: null,
  departure_window_start: '2026-07-01T08:00:00Z',
  departure_window_end: '2026-07-01T12:00:00Z',
  flexibility_hours: 4,
  original_price: 100000,
  current_discount_pct: 30,
  current_price: 70000,
  max_passengers: 12,
  status: 'reserved',
  views_count: 99,
  notifications_sent: 5,
  reservation_token_hash: SECRET_TOKEN_HASH,
  reservation_expires_at: '2026-07-01T09:00:00Z',
  reservation_customer_name_snapshot: 'Some Other Customer',
  reservation_customer_phone_snapshot: SECRET_CUST_PHONE,
  reservation_client_id: RESERVER_ID,
  customer_booking_id: 'cust-booking-internal',
  auction_initial_discount_pct: 10,
  auction_floor_discount_pct: 40,
  auction_curve: 'linear',
  auction_window_start_at: '2026-06-20T00:00:00Z',
  auction_window_end_at: '2026-06-30T00:00:00Z',
  last_price_drop_at: '2026-06-25T00:00:00Z',
  suppress_notifications: false,
  created_at: '2026-06-19T00:00:00Z',
  expires_at: null,
  updated_at: '2026-06-25T00:00:00Z',
} as unknown as EmptyLegRow;

function assertNoPii(out: Record<string, unknown>): void {
  const json = JSON.stringify(out);
  for (const secret of [
    SECRET_OP_PHONE,
    SECRET_CUST_PHONE,
    SECRET_TOKEN_HASH,
    'ops@secret.example',
    'Secret Operator Co',
    'Some Other Customer',
    RESERVER_ID,
    'booking-internal',
    'cust-booking-internal',
    'stub-1',
    'op-1',
    'ac-1',
  ]) {
    assert.ok(!json.includes(secret), `serialized output must not contain "${secret}"`);
  }
  // No operator_* / reservation-secret keys
  for (const key of Object.keys(out)) {
    assert.ok(!key.startsWith('operator'), `unexpected operator key: ${key}`);
    assert.notEqual(key, 'reservation_client_id');
    assert.notEqual(key, 'reservation_token_hash');
    assert.notEqual(key, 'reservation_customer_name_snapshot');
    assert.notEqual(key, 'reservation_customer_phone_snapshot');
    assert.notEqual(key, 'parent_booking_id');
    assert.notEqual(key, 'customer_booking_id');
    assert.notEqual(key, 'aircraft_id');
  }
}

async function main(): Promise<void> {
  await test('pricing ON → includes SAR price fields', () => {
    withPricing(true, () => {
      const out = serializeEmptyLegForMobile(ROW, { viewerClientId: null });
      assert.equal(out.original_price_sar, 100000);
      assert.equal(out.current_price_sar, 70000);
      assert.equal(out.pricing_visible, true);
      assert.equal(out.current_discount_pct, 30);
      assertNoPii(out);
    });
  });

  await test('pricing OFF → strips SAR price, keeps discount band', () => {
    withPricing(false, () => {
      const out = serializeEmptyLegForMobile(ROW, { viewerClientId: null });
      assert.ok(!('original_price_sar' in out), 'original_price_sar must be absent');
      assert.ok(!('current_price_sar' in out), 'current_price_sar must be absent');
      assert.equal(out.pricing_visible, false);
      // discount band still visible (request-to-book identity)
      assert.equal(out.current_discount_pct, 30);
      assert.equal(out.auction_floor_discount_pct, 40);
      assertNoPii(out);
    });
  });

  await test('guest (viewerClientId null) → never is_reserved_by_me, no hold expiry', () => {
    withPricing(false, () => {
      const out = serializeEmptyLegForMobile(ROW, { viewerClientId: null });
      assert.equal(out.is_reserved, true);
      assert.equal(out.is_reserved_by_me, false);
      assert.equal(out.reservation_expires_at, null);
      assertNoPii(out);
    });
  });

  await test('the reserver sees is_reserved_by_me + their hold expiry', () => {
    withPricing(false, () => {
      const out = serializeEmptyLegForMobile(ROW, { viewerClientId: RESERVER_ID });
      assert.equal(out.is_reserved_by_me, true);
      assert.equal(out.reservation_expires_at, '2026-07-01T09:00:00Z');
      assertNoPii(out); // still no raw reservation_client_id leak
    });
  });

  await test('a different client never sees is_reserved_by_me or the hold expiry', () => {
    withPricing(false, () => {
      const out = serializeEmptyLegForMobile(ROW, { viewerClientId: 'client-OTHER' });
      assert.equal(out.is_reserved_by_me, false);
      assert.equal(out.reservation_expires_at, null);
      assertNoPii(out);
    });
  });

  await test('alert serializer exposes only the client-owned fields', () => {
    const alert = {
      id: 'alert-1',
      client_id: 'client-ME',
      origin_iata: 'RUH',
      destination_iata: 'JED',
      max_price_sar: 50000,
      date_from: '2026-07-01',
      date_to: '2026-07-31',
      channels: ['email'],
      is_active: true,
      created_at: '2026-06-19T00:00:00Z',
      updated_at: '2026-06-19T00:00:00Z',
    } as ClientEmptyLegAlertRow;
    const out = serializeAlertForMobile(alert);
    assert.equal(out.id, 'alert-1');
    assert.equal(out.max_price_sar, 50000);
    // client_id + updated_at are not part of the wire shape
    assert.ok(!('client_id' in out), 'client_id must not be serialized');
  });

  // eslint-disable-next-line no-console
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
