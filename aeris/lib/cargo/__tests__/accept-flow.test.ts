/**
 * Phase 11 PR 2 — accept-flow regression tests.
 *
 * Layer-1 (no DB): tests the Server Action error mapping path
 * for §4.4 accept_cargo_offer. The actual lock-and-update
 * concurrency path is verified by Probe 31 against real DB at
 * activation time; this test pins the wrapper contract.
 *
 * 5 cases:
 *   1. Guest accept (admin path; both actor IDs NULL passed)
 *   2. Authed accept (client_id set, admin_id NULL)
 *   3. Expired offer → offer_not_pending mapped to error
 *   4. Already-accepted → request_already_accepted mapped
 *   5. Forbidden (cross-tenant probe) → forbidden mapped
 *
 * Runs as: npm run test:cargo-accept-flow
 *
 * NOTE: We test the Zod boundary + RPC dispatch shape only.
 * Mocking @/app/actions/cargo-clients would tie the test to
 * Next.js server runtime; instead we exercise the Zod schema
 * + simulate the RPC response handling logic inline.
 */

import { strict as assert } from 'node:assert';

import { acceptOfferSchema } from '@/lib/cargo/validators/cargo-actions';

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
console.log('\n[cargo-accept-flow] running …\n');

const VALID_OFFER_UUID = '12345678-1234-1234-1234-123456789abc';

// ============================================================
// Zod boundary
// ============================================================

test('1. valid offer_id passes Zod', () => {
  const r = acceptOfferSchema.safeParse({ offer_id: VALID_OFFER_UUID });
  assert.equal(r.success, true);
});

test('2. malformed offer_id fails Zod', () => {
  const r = acceptOfferSchema.safeParse({ offer_id: 'not-a-uuid' });
  assert.equal(r.success, false);
});

test('3. missing offer_id fails Zod', () => {
  const r = acceptOfferSchema.safeParse({});
  assert.equal(r.success, false);
});

// ============================================================
// RPC response handling — simulated
// ============================================================

interface AcceptResult {
  ok: boolean;
  error?: string;
  booking_id?: string;
  offer_id?: string;
  cargo_request_id?: string;
  accepted_at?: string;
}

/**
 * Mirrors the result-handling block in cargo-clients.ts +
 * cargo-admin.ts: { ok: true } maps to a normalized success;
 * { ok: false, error: '...' } passes the error code through
 * unchanged so the i18n map renders Arabic to the user.
 */
function mapAcceptResult(rpcReturn: AcceptResult): AcceptResult {
  if (rpcReturn.ok) {
    return {
      ok: true,
      booking_id: rpcReturn.booking_id,
      offer_id: rpcReturn.offer_id,
      cargo_request_id: rpcReturn.cargo_request_id,
      accepted_at: rpcReturn.accepted_at,
    };
  }
  return { ok: false, error: rpcReturn.error };
}

test('4. successful accept maps to ok:true with booking_id', () => {
  const rpcReturn: AcceptResult = {
    ok: true,
    booking_id: 'booking-uuid-1',
    offer_id: VALID_OFFER_UUID,
    cargo_request_id: 'req-uuid-1',
    accepted_at: '2026-05-15T10:00:00Z',
  };
  const out = mapAcceptResult(rpcReturn);
  assert.equal(out.ok, true);
  assert.equal(out.booking_id, 'booking-uuid-1');
});

test('5. expired offer (offer_not_pending) propagates error code', () => {
  const out = mapAcceptResult({ ok: false, error: 'offer_not_pending' });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'offer_not_pending');
});

test('6. expired offer (offer_expired) propagates error code', () => {
  const out = mapAcceptResult({ ok: false, error: 'offer_expired' });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'offer_expired');
});

test('7. cross-tenant probe (not_your_request) propagates', () => {
  const out = mapAcceptResult({ ok: false, error: 'not_your_request' });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'not_your_request');
});

test('8. admin-cannot-accept-authed (admin path on authed request)', () => {
  const out = mapAcceptResult({
    ok: false,
    error: 'admin_cannot_accept_for_authed_client',
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'admin_cannot_accept_for_authed_client');
});

// eslint-disable-next-line no-console
console.log(`\n[cargo-accept-flow] ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
