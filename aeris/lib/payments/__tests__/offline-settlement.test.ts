// Admin offline settlement — unit tests for the pure helpers behind the
// "mark booking paid" action (migration 20260702000001). Layer-1 (no DB).
// Runs as `npm run test:payments-offline-settlement`.

import { strict as assert } from 'node:assert';

import {
  buildOfflineSettlementRaw,
  offlineNetAmount,
  parseAdminMarkPaidResult,
  resolveMarkPaidGate,
} from '@/lib/payments/offline-settlement';

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

// ── resolveMarkPaidGate ────────────────────────────────────────────────

test('gate: pending_offline + no paid_at → payable', () => {
  assert.equal(
    resolveMarkPaidGate({ payment_status: 'pending_offline', paid_at: null }),
    'payable'
  );
});

test('gate: legacy pending + no paid_at → payable', () => {
  assert.equal(
    resolveMarkPaidGate({ payment_status: 'pending', paid_at: null }),
    'payable'
  );
});

test('gate: paid status → already_paid', () => {
  assert.equal(
    resolveMarkPaidGate({ payment_status: 'paid', paid_at: null }),
    'already_paid'
  );
});

test('gate: paid_at stamped wins even if status lags → already_paid', () => {
  assert.equal(
    resolveMarkPaidGate({
      payment_status: 'pending_offline',
      paid_at: '2026-07-01T10:00:00Z',
    }),
    'already_paid'
  );
});

test('gate: refunded → refunded (not payable)', () => {
  assert.equal(
    resolveMarkPaidGate({ payment_status: 'refunded', paid_at: null }),
    'refunded'
  );
});

// ── offlineNetAmount ───────────────────────────────────────────────────

test('net: total minus redemption', () => {
  assert.equal(
    offlineNetAmount({ total_amount: 15000, cashback_redemption_sar: 500 }),
    14500
  );
});

test('net: null redemption treated as 0', () => {
  assert.equal(
    offlineNetAmount({ total_amount: 15000, cashback_redemption_sar: null }),
    15000
  );
});

test('net: fully redeemed booking → 0 (still markable offline)', () => {
  assert.equal(
    offlineNetAmount({ total_amount: 800, cashback_redemption_sar: 800 }),
    0
  );
});

// ── buildOfflineSettlementRaw ──────────────────────────────────────────

test('raw: carries source + reference + timestamp + fingerprint', () => {
  assert.deepEqual(
    buildOfflineSettlementRaw({
      reference: 'TRF-123',
      markedAtIso: '2026-07-02T08:00:00.000Z',
      adminSessionFingerprint: 'abc',
    }),
    {
      source: 'admin_offline_settlement',
      reference: 'TRF-123',
      marked_at: '2026-07-02T08:00:00.000Z',
      admin_session_fingerprint: 'abc',
    }
  );
});

// ── parseAdminMarkPaidResult ───────────────────────────────────────────

test('parse: transport error → rpc_failed', () => {
  assert.deepEqual(parseAdminMarkPaidResult(null, { message: 'boom' }), {
    ok: false,
    error: 'rpc_failed',
  });
});

test('parse: non-object payload → rpc_failed', () => {
  assert.deepEqual(parseAdminMarkPaidResult('nope', null), {
    ok: false,
    error: 'rpc_failed',
  });
});

test('parse: fresh success carries booking_number + amount', () => {
  assert.deepEqual(
    parseAdminMarkPaidResult(
      { ok: true, booking_number: 'BK-1001', amount: 14500 },
      null
    ),
    { ok: true, already: false, bookingNumber: 'BK-1001', amount: 14500 }
  );
});

test('parse: idempotent re-click (already:true, no amount)', () => {
  assert.deepEqual(
    parseAdminMarkPaidResult(
      { ok: true, already: true, booking_number: 'BK-1001' },
      null
    ),
    { ok: true, already: true, bookingNumber: 'BK-1001', amount: null }
  );
});

test('parse: ok:true WITHOUT booking_number → rpc_failed (malformed)', () => {
  assert.deepEqual(parseAdminMarkPaidResult({ ok: true }, null), {
    ok: false,
    error: 'rpc_failed',
  });
});

test('parse: known wire errors pass through', () => {
  for (const code of [
    'booking_not_found',
    'already_paid',
    'booking_refunded',
  ] as const) {
    assert.deepEqual(
      parseAdminMarkPaidResult({ ok: false, error: code }, null),
      { ok: false, error: code }
    );
  }
});

test('parse: unknown wire error collapses to rpc_failed', () => {
  assert.deepEqual(
    parseAdminMarkPaidResult({ ok: false, error: 'surprise' }, null),
    { ok: false, error: 'rpc_failed' }
  );
});

// ── summary ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-console
console.log(`\n[offline-settlement] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
