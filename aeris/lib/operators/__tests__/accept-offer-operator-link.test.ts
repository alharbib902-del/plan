/**
 * P0 regression guard — charter bookings → operator portal link.
 *
 * Structural test (Layer 1, no DB — same pattern as
 * lib/addons/__tests__/catalog-vs-seed.test.ts): reads
 * supabase/migrations/20260719000001_accept_offer_link_operator_by_phone.sql
 * as plain text and asserts the invariants that keep charter
 * bookings visible in the operator portal:
 *
 *   1.  accept_offer declares v_operator_id and resolves it
 *       via an exact operators.contact_phone = offer
 *       operator_phone match.
 *   2.  The resolution happens AFTER the offer lock +
 *       validation (offer_expired return) and BEFORE the
 *       step-5 sibling rejects.
 *   3.  The resolution is deterministic (ORDER BY created_at,
 *       id + LIMIT 1) — contact_phone has no UNIQUE
 *       constraint.
 *   4.  accept_offer's bookings INSERT passes v_operator_id
 *       instead of a hardcoded NULL for operator_id.
 *   5.  backfill_booking_from_offer carries the identical
 *       change (lockstep rule pinned by
 *       20260509000008_phase_6_2_accept_offer.sql).
 *   6.  The backfill UPDATE links existing charter bookings
 *       (source_offer_table 'phase4' + 'phase5') via the same
 *       phone match, guarded by operator_id IS NULL so it
 *       stays idempotent.
 *   7.  Both replaced functions keep SECURITY DEFINER +
 *       search_path = public, pg_temp and the REVOKE from
 *       PUBLIC/anon/authenticated + GRANT to service_role
 *       convention.
 *
 * Runs as:
 *   npm run test:operators-accept-offer-operator-link
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// here = aeris/lib/operators/__tests__
// repo migrations = aeris/supabase/migrations
const MIGRATION = join(
  here,
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
  '20260719000001_accept_offer_link_operator_by_phone.sql'
);

const sql = readFileSync(MIGRATION, 'utf8');

/** Extract one `CREATE OR REPLACE FUNCTION <name>( ... $$;` body. */
function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.notEqual(start, -1, `migration must CREATE OR REPLACE ${name}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `${name} body must terminate with $$;`);
  return sql.slice(start, end);
}

const accept = functionBody('accept_offer');
const backfill = functionBody('backfill_booking_from_offer');

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

for (const [label, body] of [
  ['accept_offer', accept],
  ['backfill_booking_from_offer', backfill],
] as const) {
  test(`1. ${label} declares v_operator_id`, () => {
    assert.match(body, /v_operator_id\s+UUID;/);
  });

  test(`2. ${label} resolves operators.id by exact contact_phone match`, () => {
    assert.match(
      body,
      /SELECT id INTO v_operator_id\s+FROM operators\s+WHERE contact_phone = v_offer_operator_phone/
    );
  });

  test(`3. ${label} phone match is deterministic (ORDER BY + LIMIT 1)`, () => {
    assert.match(
      body,
      /contact_phone = v_offer_operator_phone\s+ORDER BY created_at ASC, id ASC\s+LIMIT 1;/
    );
  });

  test(`4. ${label} bookings INSERT passes v_operator_id (no hardcoded NULL)`, () => {
    assert.ok(
      body.includes('v_operator_id,'),
      `${label} VALUES must reference v_operator_id`
    );
    assert.ok(
      !body.includes('NULL,                                              -- operator_id'),
      `${label} must not hardcode NULL for operator_id`
    );
  });
}

test('5. accept_offer resolves the operator AFTER offer validation, BEFORE sibling rejects', () => {
  const validatedAt = accept.indexOf("'offer_expired'");
  const resolvedAt = accept.indexOf('contact_phone = v_offer_operator_phone');
  const siblingsAt = accept.indexOf('reject every other pending sibling');
  assert.ok(validatedAt !== -1 && resolvedAt !== -1 && siblingsAt !== -1);
  assert.ok(
    validatedAt < resolvedAt && resolvedAt < siblingsAt,
    'step 4.5 must sit between the offer validation and step 5'
  );
});

test('6. backfill UPDATE links existing charter bookings idempotently', () => {
  assert.match(sql, /UPDATE bookings AS b\s+SET operator_id = picked\.operator_id/);
  // Charter discriminator pair written by accept_offer.
  assert.match(sql, /'phase4'::TEXT AS source_offer_table/);
  assert.match(sql, /SELECT 'phase5'::TEXT,/);
  // Same phone match as the function bodies.
  assert.match(sql, /o\.contact_phone = src\.operator_phone/);
  // Idempotency guards: only un-linked rows, only real matches.
  assert.match(sql, /b\.operator_id IS NULL/);
  assert.match(sql, /picked\.operator_id IS NOT NULL/);
});

test('7. both functions keep SECURITY DEFINER + search_path + service-role-only grants', () => {
  const definerCount = sql.match(/SECURITY DEFINER\nSET search_path = public, pg_temp/g) ?? [];
  assert.ok(
    definerCount.length >= 2,
    'both replaced functions must keep SECURITY DEFINER + search_path'
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION accept_offer\(TEXT, UUID\)\s+FROM PUBLIC, anon, authenticated;/
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION accept_offer\(TEXT, UUID\)\s+TO service_role;/
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION backfill_booking_from_offer\(UUID\)\s+FROM PUBLIC, anon, authenticated;/
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION backfill_booking_from_offer\(UUID\)\s+TO service_role;/
  );
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
