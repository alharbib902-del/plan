import assert from 'node:assert';

import {
  serializePrivilegeLedgerRow,
  serializePrivilegeChangeLogRow,
  serializePrivilegeColumns,
  serializePrivilegeDashboardForMobile,
} from '@/lib/mobile/serializers/privilege';
import type {
  ClientLoyaltyLedgerRow,
  PrivilegeTierChangeLogRow,
  ClientPrivilegeColumns,
} from '@/lib/privilege/types';

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

const ADMIN_FP = 'ADMIN_COOKIE_FP_SECRET';
const ADMIN_REASON = 'internal admin note — do not show';

const LEDGER: ClientLoyaltyLedgerRow = {
  id: 'led-1',
  client_id: 'client-ME',
  event_type: 'earn' as ClientLoyaltyLedgerRow['event_type'],
  amount_sar: '1500.00',
  balance_after_sar: '3200.00',
  booking_id: 'bk-1',
  source_change_log_id: 'chg-internal',
  source_subscription_id: 'sub-internal',
  admin_actor_cookie_fingerprint: ADMIN_FP,
  admin_reason: ADMIN_REASON,
  cashback_expiry_at: '2027-06-01T00:00:00Z',
  created_at: '2026-06-01T00:00:00Z',
};

const CHANGE: PrivilegeTierChangeLogRow = {
  id: 'chg-1',
  client_id: 'client-ME',
  from_tier: 'gold' as PrivilegeTierChangeLogRow['from_tier'],
  to_tier: 'platinum' as PrivilegeTierChangeLogRow['to_tier'],
  reason: 'auto_upgrade',
  qualified_spend_12m_sar: '250000.00',
  grace_started_at: null,
  admin_actor_cookie_fingerprint: ADMIN_FP,
  admin_reason: ADMIN_REASON,
  lock_until: null,
  source_booking_id: 'bk-2',
  created_at: '2026-05-01T00:00:00Z',
};

const COLUMNS: ClientPrivilegeColumns = {
  privilege_tier: 'platinum' as ClientPrivilegeColumns['privilege_tier'],
  privilege_tier_assigned_at: '2026-05-01T00:00:00Z',
  privilege_tier_qualified_spend_12m_sar: '250000.00',
  privilege_below_threshold_since: null,
  tier_locked_until: null,
  cashback_balance_sar: '3200.00',
  two_factor_enabled: true,
};

const LEDGER_KEYS = new Set([
  'id',
  'event_type',
  'amount_sar',
  'balance_after_sar',
  'booking_id',
  'cashback_expiry_at',
  'created_at',
]);
const CHANGE_KEYS = new Set([
  'id',
  'from_tier',
  'to_tier',
  'reason',
  'qualified_spend_12m_sar',
  'grace_started_at',
  'lock_until',
  'source_booking_id',
  'created_at',
]);
const PRIVILEGE_KEYS = new Set([
  'privilege_tier',
  'privilege_tier_assigned_at',
  'qualified_spend_12m_sar',
  'below_threshold_since',
  'tier_locked_until',
  'cashback_balance_sar',
  'two_factor_enabled',
]);

function assertNoAdmin(json: string): void {
  for (const s of [
    ADMIN_FP,
    ADMIN_REASON,
    'client-ME',
    'chg-internal',
    'sub-internal',
  ]) {
    assert.ok(!json.includes(s), `serialized output must not contain "${s}"`);
  }
}

test('ledger row: EXACT allowlist key-set (admin/internal fields dropped)', () => {
  const out = serializePrivilegeLedgerRow(LEDGER);
  assert.deepEqual(new Set(Object.keys(out)), LEDGER_KEYS);
  assertNoAdmin(JSON.stringify(out));
  // client's own money fields ARE present, as NUMERIC strings
  assert.equal(out.amount_sar, '1500.00');
  assert.equal(out.balance_after_sar, '3200.00');
});

test('change-log row: EXACT allowlist key-set (admin fields dropped, reason kept)', () => {
  const out = serializePrivilegeChangeLogRow(CHANGE);
  assert.deepEqual(new Set(Object.keys(out)), CHANGE_KEYS);
  assertNoAdmin(JSON.stringify(out));
  assert.equal(out.reason, 'auto_upgrade'); // structured reason kept
});

test('privilege columns: client tier/cashback exposed, no extras', () => {
  const out = serializePrivilegeColumns(COLUMNS);
  assert.deepEqual(new Set(Object.keys(out)), PRIVILEGE_KEYS);
  assert.equal(out.cashback_balance_sar, '3200.00');
});

test('dashboard: top-level shape + NO admin/PII anywhere in the tree', () => {
  const out = serializePrivilegeDashboardForMobile({
    full_name: 'محمد',
    privilege: COLUMNS,
    recent_ledger: [LEDGER],
    recent_change_log: [CHANGE],
  });
  assert.deepEqual(
    new Set(Object.keys(out)),
    new Set(['full_name', 'privilege', 'recent_ledger', 'recent_change_log'])
  );
  // client_id is NOT exposed at the top level (it's the caller's own id)
  assert.ok(!('client_id' in out), 'dashboard must not expose client_id');
  // Full-tree key pinning: nested privilege + each nested row must stay
  // their exact allowlists so a future widening anywhere fails here.
  assert.deepEqual(new Set(Object.keys(out.privilege)), PRIVILEGE_KEYS);
  assert.deepEqual(new Set(Object.keys(out.recent_ledger[0])), LEDGER_KEYS);
  assert.deepEqual(new Set(Object.keys(out.recent_change_log[0])), CHANGE_KEYS);
  // admin secrets nowhere in the nested tree
  assertNoAdmin(JSON.stringify(out));
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
