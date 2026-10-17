/**
 * Manual-settlement mode — structural guard for migration
 * 20261017000002_admin_offline_payment_and_flight_status.sql.
 *
 * Layer 1 (no DB), same pattern as
 * lib/operators/__tests__/accept-offer-operator-link.test.ts: reads the
 * migration as text (CRLF-normalised) and pins the invariants that make
 * the offline path fire the SAME paid-state cascade as the online path
 * and keep both RPCs locked down:
 *
 *   1. Both RPCs: SECURITY DEFINER, search_path = public, pg_temp,
 *      RETURNS JSONB, REVOKE from PUBLIC/anon/authenticated + GRANT to
 *      service_role (exact signatures).
 *   2. admin_confirm_offline_payment locks the booking FOR UPDATE, returns
 *      already_paid BEFORE any write, accepts only pending_offline/pending
 *      (NULL fails closed), reconciles the amount, refuses an in-flight
 *      online attempt, writes the ledger row (provider 'offline', status
 *      'success'), flips with the exact statement confirm_booking_payment
 *      uses (so the existing triggers fire) and never writes paid_at
 *      itself, then audits — in that order.
 *   3. The migration does not touch the paid-state triggers / immutability
 *      guard / accept_offer, and adds no ENUM value.
 *   4. admin_set_flight_status: FOR UPDATE, same-status no-op before any
 *      write, the forward-only transition table (mirrored in the UI's
 *      FLIGHT_STATUS_NEXT), paid-before-completed, cancel guards, audit.
 *   5. Every flight/payment status literal exists in its ENUM, and every
 *      RPC error code has an Arabic message.
 *
 * Runs as: npm run test:admin-offline-payment-migration
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BOOKING_ACTION_ERROR_AR,
  FLIGHT_STATUSES,
  FLIGHT_STATUS_NEXT,
  PAYMENT_STATUSES,
} from '../constants';

const here = dirname(fileURLToPath(import.meta.url));
// here = aeris/lib/admin/bookings/__tests__
const MIGRATIONS = join(here, '..', '..', '..', '..', 'supabase', 'migrations');

function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS, name), 'utf8').replace(/\r\n/g, '\n');
}

const sql = readMigration(
  '20261017000002_admin_offline_payment_and_flight_status.sql'
);
const paymentCore = readMigration('20260531000010_payment_core.sql');
const initialSchema = readMigration('20260422000001_initial_schema.sql');
const addonsReshape = readMigration('20260508000007_phase_6_2_addons.sql');

/** SQL with `--` comments stripped (so prose can't satisfy an assertion). */
function code(s: string): string {
  return s
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Extract one `CREATE OR REPLACE FUNCTION <name>( ... $$;` (comments stripped). */
function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.notEqual(start, -1, `migration must CREATE OR REPLACE ${name}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `${name} body must terminate with $$;`);
  return code(sql.slice(start, end + 3));
}

function idx(body: string, needle: string, label: string): number {
  const i = body.indexOf(needle);
  assert.notEqual(i, -1, `${label}: expected to find ${JSON.stringify(needle)}`);
  return i;
}

const confirm = functionBody('admin_confirm_offline_payment');
const flight = functionBody('admin_set_flight_status');
const sqlCode = code(sql);

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

// ---- 1. security attributes + grants ---------------------------------------

const SIGNATURES: Record<string, string> = {
  admin_confirm_offline_payment: 'admin_confirm_offline_payment(UUID, UUID, TEXT, TEXT, TEXT)',
  admin_set_flight_status:
    'admin_set_flight_status(UUID, UUID, booking_flight_status, TEXT)',
};

for (const [name, sig] of Object.entries(SIGNATURES)) {
  const body = name === 'admin_confirm_offline_payment' ? confirm : flight;

  test(`${name}: SECURITY DEFINER + search_path public, pg_temp + JSONB`, () => {
    assert.match(body, /RETURNS JSONB\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp\s+AS \$\$/);
  });

  test(`${name}: REVOKE from PUBLIC/anon/authenticated + GRANT service_role only`, () => {
    assert.ok(
      sqlCode.includes(
        `REVOKE ALL ON FUNCTION ${sig}\n  FROM PUBLIC, anon, authenticated;`
      ),
      `missing REVOKE for ${sig}`
    );
    assert.ok(
      sqlCode.includes(`GRANT EXECUTE ON FUNCTION ${sig}\n  TO service_role;`),
      `missing GRANT for ${sig}`
    );
  });

  test(`${name}: verifies an active admin actor`, () => {
    assert.match(
      body,
      /p_admin_user_id IS NULL OR NOT EXISTS \(\s*SELECT 1 FROM admin_users\s*WHERE id = p_admin_user_id AND status = 'active'\s*\)/
    );
  });
}

test('no GRANT to anon/authenticated/PUBLIC anywhere in the migration', () => {
  for (const line of sqlCode.split('\n')) {
    if (/^\s*GRANT\b/.test(line)) {
      assert.ok(!/\b(anon|authenticated|PUBLIC)\b/.test(line), line);
    }
  }
  assert.ok(!/TO\s+(anon|authenticated|PUBLIC)\s*;/.test(sqlCode));
});

// ---- 2. admin_confirm_offline_payment ---------------------------------------

test('confirm: locks the booking row FOR UPDATE', () => {
  assert.match(
    confirm,
    /FROM bookings\s+WHERE id = p_booking_id\s+FOR UPDATE;/
  );
});

test('confirm: already-paid re-call returns before ANY write (idempotent)', () => {
  const lock = idx(confirm, 'FOR UPDATE;', 'confirm');
  const already = idx(confirm, "'already_paid', true", 'confirm');
  const firstInsert = idx(confirm, 'INSERT INTO', 'confirm');
  const firstUpdate = idx(confirm, 'UPDATE bookings', 'confirm');
  assert.ok(lock < already, 'paid check must run under the lock');
  assert.ok(already < firstInsert && already < firstUpdate, 'already_paid must short-circuit before writes');
  assert.match(confirm, /IF v_paid_at IS NOT NULL OR v_status = 'paid' THEN/);
});

test('confirm: only pending_offline / pending; NULL fails closed', () => {
  assert.ok(
    confirm.includes(
      "IF v_status IS NULL OR v_status NOT IN ('pending_offline', 'pending') THEN"
    )
  );
  assert.match(confirm, /IF v_flight = 'cancelled' THEN/);
});

test('confirm: refuses while an online attempt is in flight (read-only check)', () => {
  assert.match(
    confirm,
    /IF EXISTS \(\s*SELECT 1 FROM payments\s*WHERE booking_id = p_booking_id AND status = 'initiated'\s*\) THEN\s*RETURN jsonb_build_object\('ok', false, 'error', 'booking_has_active_payment'\);/
  );
  // no payments row lock → no lock-order inversion with confirm_booking_payment
  assert.ok(!/FROM payments[^;]*FOR UPDATE/.test(confirm));
});

test('confirm: amount reconciles to the net (total − redemption)', () => {
  assert.match(confirm, /v_net := v_total - COALESCE\(v_redeem, 0\);/);
  assert.match(confirm, /IF v_received <> v_net THEN/);
  assert.match(confirm, /'amount_mismatch'/);
  // parsed inside the DB, fail-closed on garbage
  assert.match(confirm, /::NUMERIC;\s*EXCEPTION WHEN others THEN\s*v_received := NULL;/);
});

test('confirm: ledger row is an offline success for the net amount', () => {
  const insert = confirm.slice(idx(confirm, 'INSERT INTO payments', 'confirm'));
  assert.match(insert, /p_booking_id, v_net, 'SAR', 'offline', 'offline',/);
  assert.match(insert, /'offline:' \|\| p_booking_id::text,/);
  assert.match(insert, /'success', v_reference, 'offline_confirmed',/);
  assert.match(confirm, /EXCEPTION WHEN unique_violation THEN\s*RETURN jsonb_build_object\('ok', false, 'error', 'already_paid'\);/);
});

test('confirm: flips with the exact confirm_booking_payment statement (same triggers fire)', () => {
  const flip = "UPDATE bookings SET payment_status = 'paid'";
  assert.ok(paymentCore.includes(flip), 'payment core must still use the same flip');
  assert.ok(confirm.includes(`${flip}\n  WHERE id = p_booking_id`));
  // paid_at is stamped by trg_bookings_stamp_paid_at_upd — never written here
  assert.ok(!/\bpaid_at\s*=/.test(confirm), 'must not assign paid_at directly');
  const setLists = [...confirm.matchAll(/UPDATE bookings SET ([\s\S]*?)\s+WHERE/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(setLists, ["payment_status = 'paid'"], 'the only booking write is the flip');
});

test('confirm: the flip is OUTSIDE the unique_violation handler', () => {
  const handler = idx(confirm, 'EXCEPTION WHEN unique_violation', 'confirm');
  const handlerEnd = confirm.indexOf('END;', handler);
  const flip = idx(confirm, "UPDATE bookings SET payment_status = 'paid'", 'confirm');
  assert.ok(flip > handlerEnd, 'a trigger failure must abort, not be swallowed');
});

test('confirm: write order = ledger → flip → audit', () => {
  const ledger = idx(confirm, 'INSERT INTO payments', 'confirm');
  const flip = idx(confirm, "UPDATE bookings SET payment_status = 'paid'", 'confirm');
  const audit = idx(confirm, 'INSERT INTO audit_logs', 'confirm');
  assert.ok(ledger < flip && flip < audit);
});

test('confirm: audit row carries actor, reference, note, amount', () => {
  const audit = confirm.slice(idx(confirm, 'INSERT INTO audit_logs', 'confirm'));
  assert.match(audit, /'booking_offline_payment_confirmed'/);
  for (const key of [
    "'actor_admin_user_id', p_admin_user_id",
    "'reference', v_reference",
    "'note', v_note",
    "'amount_sar', v_net",
    "'paid_at', v_new_paid_at",
  ]) {
    assert.ok(audit.includes(key), `audit new_value missing ${key}`);
  }
});

// ---- 3. scope discipline -----------------------------------------------------

test('does not touch triggers, the immutability guard or accept_offer', () => {
  assert.ok(!/\bCREATE TRIGGER\b/i.test(sqlCode));
  assert.ok(!/\bDROP TRIGGER\b/i.test(sqlCode));
  assert.ok(!sqlCode.includes('reject_paid_state_mutation_after_paid'));
  assert.ok(!sqlCode.includes('on_bookings_paid_award_and_evaluate'));
  assert.ok(!/FUNCTION\s+accept_offer\b/.test(sqlCode));
  assert.ok(!/FUNCTION\s+confirm_booking_payment\b/.test(sqlCode));
});

test('adds no ENUM value (provider is TEXT + CHECK)', () => {
  assert.ok(!/ALTER TYPE/i.test(sqlCode));
});

test("payments provider CHECK widened to 'offline', idempotently", () => {
  assert.match(sqlCode, /pg_get_constraintdef\(oid\) LIKE '%offline%'/);
  assert.match(
    sqlCode,
    /CHECK \(provider IN \('hyperpay', 'moyasar', 'offline'\)\)/
  );
  assert.match(sqlCode, /DROP CONSTRAINT IF EXISTS payments_provider_check;/);
});

// ---- 4. admin_set_flight_status ---------------------------------------------

test('flight: locks the booking FOR UPDATE and no-ops on same status first', () => {
  assert.match(flight, /FROM bookings\s+WHERE id = p_booking_id\s+FOR UPDATE;/);
  const same = idx(flight, 'IF v_current = p_status THEN', 'flight');
  assert.ok(same < idx(flight, 'UPDATE bookings', 'flight'));
  assert.ok(same < idx(flight, 'INSERT INTO audit_logs', 'flight'));
  assert.ok(same > idx(flight, 'FOR UPDATE;', 'flight'));
});

test('flight: SQL transition table == UI FLIGHT_STATUS_NEXT', () => {
  const caseStart = idx(flight, 'v_allowed := CASE v_current', 'flight');
  const caseBlock = flight.slice(caseStart, flight.indexOf('END;', caseStart));
  const sqlNext: Record<string, string[]> = {};
  for (const m of caseBlock.matchAll(/WHEN '([a-z_]+)'\s+THEN p_status (?:IN \(([^)]*)\)|= '([a-z_]+)')/g)) {
    const targets = m[2]
      ? [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
      : [m[3]];
    sqlNext[m[1]] = targets;
  }
  assert.match(caseBlock, /ELSE false/);
  for (const status of FLIGHT_STATUSES) {
    assert.deepEqual(
      [...(sqlNext[status] ?? [])].sort(),
      [...FLIGHT_STATUS_NEXT[status]].sort(),
      `transition mismatch for ${status}`
    );
  }
});

test('flight: completed requires paid + departed', () => {
  const block = flight.slice(idx(flight, "IF p_status = 'completed' THEN", 'flight'));
  assert.match(block, /IF v_pay_status <> 'paid' OR v_paid_at IS NULL THEN\s*RETURN jsonb_build_object\('ok', false, 'error', 'payment_required_before_completion'\);/);
  assert.match(block, /IF v_departure > now\(\) THEN/);
});

test('flight: cancel guarded (unpaid, no redemption, no live attempt, reason) + token revoked', () => {
  const block = flight.slice(idx(flight, "IF p_status = 'cancelled' THEN", 'flight'));
  for (const code of [
    'cancel_paid_requires_refund',
    'cancel_has_cashback_redemption',
    'booking_has_active_payment',
    'cancel_reason_required',
  ]) {
    assert.ok(block.includes(`'${code}'`), `missing guard ${code}`);
  }
  assert.match(block, /cancelled_at\s+= now\(\)/);
  assert.match(block, /cancellation_reason\s+= v_note/);
  assert.match(block, /checkout_token_hash\s+= NULL/);
  assert.match(block, /checkout_token_expires_at = NULL/);
});

test('flight: never touches payment_status / paid_at / totals', () => {
  assert.ok(!/SET[^;]*\b(payment_status|paid_at|total_amount|cashback_redemption_sar)\s*=/.test(flight));
});

test('flight: audit row with actor + old/new status + note', () => {
  const audit = flight.slice(idx(flight, 'INSERT INTO audit_logs', 'flight'));
  assert.match(audit, /'booking_flight_status_changed'/);
  assert.match(audit, /jsonb_build_object\('flight_status', v_current\)/);
  assert.ok(audit.includes("'actor_admin_user_id', p_admin_user_id"));
  assert.ok(audit.includes("'flight_status', p_status"));
  assert.ok(audit.includes("'note', v_note"));
});

// ---- 5. enum + error-code coherence -----------------------------------------

function enumValues(schema: string, type: string): string[] {
  const m = schema.match(new RegExp(`CREATE TYPE ${type} AS ENUM \\(([^)]*)\\)`));
  assert.ok(m, `enum ${type} not found`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

test('flight/payment status lists match the DB ENUMs', () => {
  assert.deepEqual(
    [...FLIGHT_STATUSES].sort(),
    enumValues(initialSchema, 'booking_flight_status').sort()
  );
  const payment = [
    ...enumValues(initialSchema, 'booking_payment_status'),
    ...(addonsReshape.includes("ALTER TYPE booking_payment_status ADD VALUE 'pending_offline'")
      ? ['pending_offline']
      : []),
  ];
  assert.deepEqual([...PAYMENT_STATUSES].sort(), payment.sort());
});

test('every RPC error code has an Arabic message', () => {
  const codes = new Set(
    [...sqlCode.matchAll(/'error', '([a-z_]+)'/g)].map((m) => m[1])
  );
  assert.ok(codes.size >= 15, `expected many error codes, got ${codes.size}`);
  for (const c of codes) {
    assert.ok(BOOKING_ACTION_ERROR_AR[c], `no Arabic message for ${c}`);
  }
});

// eslint-disable-next-line no-console
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
