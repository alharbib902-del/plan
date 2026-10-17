/**
 * Structural guard — supabase/migrations/20261017000001_db_security_hardening.sql.
 *
 * Layer 1, no DB (same pattern as
 * lib/operators/__tests__/accept-offer-operator-link.test.ts): reads the
 * migrations as plain text and asserts the invariants the hardening relies on:
 *
 *   1.  Every permissive CREATE POLICY in any migration is either the intended
 *       airports_public_read, a deny-all USING (false) policy, or dropped by a
 *       later migration — and the 8 legacy auth.uid() policies are dropped here.
 *   2.  anon/authenticated lose every relation privilege in public, airports
 *       SELECT is re-granted AFTER the sweep, non-owned relations cannot abort
 *       the migration, and a post-condition fails closed on owned relations.
 *   3.  postgres's default privileges stop granting anon/authenticated on
 *       tables, sequences and functions; nothing REVOKEs from service_role.
 *   4.  accept_offer / backfill_booking_from_offer are byte-identical to the
 *       20260719000001 versions except the DECLARE + step 4.5 resolution, which
 *       is identical in both (lockstep), prefers the auto-dispatch identity and
 *       only ever links approved operators; SECURITY DEFINER, search_path and
 *       the service-role-only grants are kept.
 *   5.  The phone normaliser maps the Saudi formats to E.164 (executed here in
 *       JS against the exact pattern in the SQL), never creates a duplicate,
 *       and the backfill re-run keeps the idempotency guards.
 *   6.  The 4 trigger-function REVOKEs, the 5 new indexes, and the catalog-
 *       gated drop of the 3 legacy single-column indexes.
 *
 * Runs as:
 *   npm run test:supabase-db-security-hardening
 */

import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// here = aeris/lib/supabase/__tests__ → aeris/supabase/migrations
const MIGRATIONS = join(here, '..', '..', '..', 'supabase', 'migrations');
const NEW_FILE = '20261017000001_db_security_hardening.sql';
const LINK_FILE = '20260719000001_accept_offer_link_operator_by_phone.sql';

/** Windows checkouts carry CRLF; every assertion below is written for LF. */
function read(file: string): string {
  return readFileSync(join(MIGRATIONS, file), 'utf8').replace(/\r\n/g, '\n');
}

/** Drop `--` line comments so commented-out SQL can never satisfy a check. */
function code(text: string): string {
  return text.replace(/--[^\n]*/g, '');
}

const sql = read(NEW_FILE);
const sqlCode = code(sql);
const linkSql = read(LINK_FILE);

const LEGACY_POLICIES: ReadonlyArray<readonly [string, string]> = [
  ['users_select_own', 'users'],
  ['users_update_own', 'users'],
  ['bookings_select_client', 'bookings'],
  ['bookings_select_operator', 'bookings'],
  ['trip_requests_select_own', 'trip_requests'],
  ['trip_requests_insert_own', 'trip_requests'],
  ['empty_legs_public_available', 'empty_legs'],
  ['notifications_select_own', 'notifications'],
];

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

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// 1. Policies
// ---------------------------------------------------------------------------

type PolicyCreate = { file: string; name: string; table: string; body: string };
type PolicyDrop = { file: string; name: string; table: string };

const migrationFiles = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const created: PolicyCreate[] = [];
const dropped: PolicyDrop[] = [];
for (const file of migrationFiles) {
  const text = code(read(file));
  for (const m of text.matchAll(
    /CREATE\s+POLICY\s+"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?([a-z0-9_]+)([\s\S]*?);/gi
  )) {
    created.push({ file, name: m[1], table: m[2], body: m[3] });
  }
  for (const m of text.matchAll(
    /DROP\s+POLICY\s+IF\s+EXISTS\s+"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?([a-z0-9_]+)\s*;/gi
  )) {
    dropped.push({ file, name: m[1], table: m[2] });
  }
}

function isDenyAll(body: string): boolean {
  const usingFalse = /USING\s*\(\s*false\s*\)/i.test(body);
  const check = body.match(/WITH\s+CHECK\s*\(([^)]*)\)/i);
  return usingFalse && (!check || /^\s*false\s*$/i.test(check[1]));
}

test('1a. enumeration sees every known CREATE POLICY (incl. the 8 legacy ones)', () => {
  const names = new Set(created.map((p) => p.name));
  for (const [name] of LEGACY_POLICIES) assert.ok(names.has(name), `missing ${name}`);
  assert.ok(names.has('airports_public_read'));
  assert.ok(names.has('device_tokens_deny_all'));
  assert.ok(names.has('client_push_deliveries_deny_all'));
  assert.ok(names.has('client_push_alert_status_deny_all'));
});

test('1b. every permissive policy is allowlisted, deny-all, or dropped later', () => {
  for (const p of created) {
    if (p.name === 'airports_public_read' || isDenyAll(p.body)) continue;
    const laterDrop = dropped.some(
      (d) => d.name === p.name && d.table === p.table && d.file > p.file
    );
    assert.ok(laterDrop, `${p.name} ON ${p.table} (${p.file}) is permissive and never dropped`);
  }
});

test('1c. the 8 legacy auth.uid() policies are dropped by THIS migration', () => {
  for (const [name, table] of LEGACY_POLICIES) {
    assert.match(
      sqlCode,
      new RegExp(`DROP POLICY IF EXISTS "${name}" ON ${table};`),
      `${name} must be dropped`
    );
  }
});

test('1d. airports_public_read and the deny-all push policies are never dropped', () => {
  for (const keep of [
    'airports_public_read',
    'device_tokens_deny_all',
    'client_push_deliveries_deny_all',
    'client_push_alert_status_deny_all',
  ]) {
    assert.ok(!sqlCode.includes(`DROP POLICY IF EXISTS "${keep}"`), keep);
    assert.ok(!sqlCode.includes(`DROP POLICY IF EXISTS ${keep} `), keep);
  }
});

// ---------------------------------------------------------------------------
// 2 + 3. Privileges
// ---------------------------------------------------------------------------

test('2a. relation sweep covers tables/views/matviews/foreign/partitioned + sequences', () => {
  assert.match(sqlCode, /c\.relkind IN \('r', 'p', 'v', 'm', 'f', 'S'\)/);
  assert.match(sqlCode, /n\.nspname = 'public'/);
  assert.match(sqlCode, /REVOKE ALL ON SEQUENCE %s FROM anon, authenticated/);
  assert.match(sqlCode, /REVOKE ALL ON TABLE %s FROM anon, authenticated/);
});

test('2b. non-owned relations are wrapped so they can only WARN', () => {
  assert.match(sqlCode, /pg_has_role\(c\.relowner, 'USAGE'\) AS owned/);
  assert.match(
    sqlCode,
    /ELSE\s+BEGIN\s+IF r\.relkind = 'S' THEN[\s\S]*?EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/
  );
});

test('2c. airports SELECT is re-granted AFTER the sweep (matches airports_public_read)', () => {
  const sweepAt = sqlCode.indexOf('REVOKE ALL ON TABLE %s FROM anon, authenticated');
  const grantAt = sqlCode.indexOf('GRANT SELECT ON airports TO anon, authenticated;');
  assert.ok(sweepAt !== -1 && grantAt !== -1);
  assert.ok(sweepAt < grantAt, 'GRANT must follow the revoke sweep');
});

test('2d. post-condition fails closed on owned relations (airports SELECT exempt)', () => {
  const grantAt = sqlCode.indexOf('GRANT SELECT ON airports TO anon, authenticated;');
  const postAt = sqlCode.indexOf('aclexplode(c.relacl)');
  assert.ok(postAt > grantAt, 'post-condition must run after the airports GRANT');
  assert.match(
    sqlCode,
    /NOT \(c\.relname = 'airports' AND c\.relkind = 'r' AND a\.privilege_type = 'SELECT'\)/
  );
  assert.match(sqlCode, /RAISE EXCEPTION 'db_security_hardening: anon\/authenticated privileges survived/);
});

test('3a. postgres default privileges stop granting anon/authenticated', () => {
  for (const kind of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) {
    assert.match(
      sqlCode,
      new RegExp(
        `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\\s+REVOKE ALL ON ${kind} FROM anon, authenticated;`
      ),
      `per-schema ${kind}`
    );
  }
  const all = sqlCode.match(/ALTER DEFAULT PRIVILEGES[^;]*;/g) ?? [];
  assert.equal(all.length, 3);
  for (const st of all) {
    assert.match(st, /FOR ROLE postgres IN SCHEMA public/, `must stay scoped to public: ${st}`);
  }
});

test('3b. nothing in the migration revokes from (or re-defaults) service_role / postgres', () => {
  const statements = sqlCode.split(';');
  for (const st of statements) {
    if (/\bREVOKE\b/i.test(st) || /ALTER DEFAULT PRIVILEGES/i.test(st)) {
      assert.ok(!/service_role/i.test(st), `service_role touched: ${st.trim()}`);
      const from = st.match(/\bFROM\b([\s\S]*)$/i);
      if (from) assert.ok(!/\bpostgres\b/i.test(from[1]), `postgres revoked: ${st.trim()}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. accept_offer / backfill_booking_from_offer
// ---------------------------------------------------------------------------

function fnBlock(text: string, name: string, grantSig: string): string {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.notEqual(start, -1, `CREATE OR REPLACE ${name} missing`);
  const grant = `GRANT EXECUTE ON FUNCTION ${grantSig}\n  TO service_role;`;
  const end = text.indexOf(grant, start);
  assert.notEqual(end, -1, `${name} grant missing`);
  return text.slice(start, end + grant.length);
}

const NEW_DECLARE =
  '  -- 20261017000001: operator identity from the Phase 5\n' +
  '  -- auto-dispatch log; NULL for phase4 / manual dispatch.\n' +
  '  v_dispatch_operator_id UUID;\n';

/** The step 4.5 region: from its marker up to the next step's marker. */
function step45(block: string, nextMarker: string): string {
  const s = block.indexOf('  -- Step 4.5 (');
  const e = block.indexOf(nextMarker, s);
  assert.ok(s !== -1 && e !== -1, 'step 4.5 region not found');
  return block.slice(s, e);
}

function withoutEdits(block: string, nextMarker: string): string {
  const region = step45(block, nextMarker);
  return block.replace(NEW_DECLARE, () => '').replace(region, () => '<STEP 4.5>\n');
}

const FUNCS = [
  {
    name: 'accept_offer',
    sig: 'accept_offer(TEXT, UUID)',
    next: '  -- Step 5: reject every other pending sibling',
    source: "p_source = 'phase5'",
    offerId: 'p_offer_id',
  },
  {
    name: 'backfill_booking_from_offer',
    sig: 'backfill_booking_from_offer(UUID)',
    next: '  -- Step 5: INSERT the bookings row',
    source: "v_offer_source = 'phase5'",
    offerId: 'v_offer_id',
  },
] as const;

for (const f of FUNCS) {
  const fresh = fnBlock(sql, f.name, f.sig);
  const prior = fnBlock(linkSql, f.name, f.sig);

  test(`4a. ${f.name} is byte-identical to 20260719000001 outside DECLARE + step 4.5`, () => {
    assert.ok(fresh.includes(NEW_DECLARE), 'new DECLARE line missing');
    assert.equal(withoutEdits(fresh, f.next), withoutEdits(prior, f.next));
  });

  test(`4b. ${f.name} keeps SECURITY DEFINER + search_path + service-role-only grants`, () => {
    assert.match(fresh, /\nLANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_temp\nAS \$\$\n/);
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON FUNCTION ${escapeRe(f.sig)}\\s+FROM PUBLIC, anon, authenticated;`)
    );
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${escapeRe(f.sig)}\\s+TO service_role;`));
  });

  test(`4c. ${f.name} prefers the auto-dispatch identity, approved-only`, () => {
    const region = code(step45(fresh, f.next));
    assert.match(
      region,
      new RegExp(
        `IF ${escapeRe(f.source)} THEN\\s+SELECT l\\.operator_id INTO v_dispatch_operator_id\\s+` +
          'FROM phase5_operator_offers AS f\\s+JOIN trip_distribution_log AS l\\s+' +
          'ON l\\.dispatch_target_id = f\\.dispatch_target_id\\s+' +
          `WHERE f\\.id = ${f.offerId};`
      )
    );
    assert.match(
      region,
      /IF v_dispatch_operator_id IS NOT NULL THEN\s+SELECT id INTO v_operator_id\s+FROM operators\s+WHERE id = v_dispatch_operator_id\s+AND signup_status = 'approved';\s+ELSE/
    );
  });

  test(`4d. ${f.name} phone fallback is approved-only + deterministic`, () => {
    const region = code(step45(fresh, f.next));
    assert.match(
      region,
      /WHERE contact_phone = v_offer_operator_phone\s+AND signup_status = 'approved'\s+ORDER BY created_at ASC, id ASC\s+LIMIT 1;/
    );
    assert.equal((region.match(/signup_status = 'approved'/g) ?? []).length, 2);
    assert.ok(
      !/contact_phone = v_offer_operator_phone\s+ORDER BY/.test(region),
      'no unfiltered phone match may remain'
    );
  });
}

test('4e. lockstep: both functions run the identical resolution', () => {
  const [a, b] = FUNCS.map((f) =>
    code(step45(fnBlock(sql, f.name, f.sig), f.next))
      .replace(f.source, '<PHASE5>')
      .replace(new RegExp(`\\b${f.offerId}\\b`), '<OFFER>')
      .replace(/\n\s*\n/g, '\n')
      .trim()
  );
  assert.equal(a, b);
});

test('4f. accept_offer resolves AFTER offer validation, BEFORE sibling rejects', () => {
  const accept = fnBlock(sql, 'accept_offer', 'accept_offer(TEXT, UUID)');
  const validatedAt = accept.indexOf("'offer_expired'");
  const resolvedAt = accept.indexOf('INTO v_dispatch_operator_id');
  const siblingsAt = accept.indexOf('reject every other pending sibling');
  assert.ok(validatedAt !== -1 && resolvedAt !== -1 && siblingsAt !== -1);
  assert.ok(validatedAt < resolvedAt && resolvedAt < siblingsAt);
});

// ---------------------------------------------------------------------------
// 5. Phone normalisation + backfill re-run
// ---------------------------------------------------------------------------

const translateM = sql.match(/translate\(o\.contact_phone,\s*'([^']+)',\s*'([^']+)'\)/);
const patternM = sql.match(/'(\^\(\?:[^']+\$)'\)\)\[1\]/);

function normalise(raw: string): string {
  assert.ok(translateM && patternM, 'normaliser expressions not found');
  const from = Array.from(translateM[1]);
  const to = Array.from(translateM[2]);
  const mapped = Array.from(raw)
    .map((ch) => {
      const i = from.indexOf(ch);
      return i === -1 ? ch : to[i];
    })
    .join('');
  const stripped = mapped.replace(/[^0-9+]/g, '');
  const m = new RegExp(patternM[1]).exec(stripped);
  return m ? `+966${m[1]}` : raw;
}

test('5a. normaliser strips to digits/+ before matching', () => {
  assert.match(sql, /'\[\^0-9\+\]', '', 'g'\)/);
  assert.ok(translateM && Array.from(translateM[1]).length === Array.from(translateM[2]).length);
});

test('5b. Saudi formats → +9665XXXXXXXX; everything else untouched', () => {
  const canon = '+966501234567';
  for (const input of [
    '0501234567',
    '501234567',
    '966501234567',
    '+966501234567',
    '00966501234567',
    '+966 50 123 4567',
    '050-123-4567',
    '(050) 123 4567',
    '+9660501234567',
    '٠٥٠١٢٣٤٥٦٧',
    ' +966501234567 ',
  ]) {
    assert.equal(normalise(input), canon, `"${input}"`);
  }
  for (const input of [
    '+971501234567',
    '971501234567',
    '0112345678',
    '05012345678',
    '050123456',
    '+5501234567',
    '',
  ]) {
    assert.equal(normalise(input), input, `"${input}" must stay`);
  }
});

test('5c. normalisation never creates a duplicate + is audited', () => {
  assert.match(sqlCode, /n\.canonical IS DISTINCT FROM n\.contact_phone/);
  assert.match(
    sqlCode,
    /NOT EXISTS \(\s+SELECT 1\s+FROM norm AS other\s+WHERE other\.id <> n\.id\s+AND other\.canonical = n\.canonical\s+\)/
  );
  assert.match(sqlCode, /'contact_phone_normalized'/);
});

test('5d. normalisation runs before the backfill re-run', () => {
  const normAt = sqlCode.indexOf('WITH norm AS (');
  const backfillAt = sqlCode.indexOf('UPDATE bookings AS b');
  assert.ok(normAt !== -1 && backfillAt !== -1 && normAt < backfillAt);
});

test('5e. backfill re-run: new rule + the 20260719000001 idempotency guards', () => {
  const at = sqlCode.indexOf('UPDATE bookings AS b');
  const backfill = sqlCode.slice(at, sqlCode.indexOf(';', at));
  assert.match(backfill, /LEFT JOIN trip_distribution_log AS l\s+ON l\.dispatch_target_id = p5\.dispatch_target_id/);
  assert.equal((backfill.match(/o\.signup_status = 'approved'/g) ?? []).length, 2);
  assert.match(backfill, /ORDER BY o\.created_at ASC, o\.id ASC\s+LIMIT 1/);
  assert.match(backfill, /'phase4'::TEXT AS source_offer_table/);
  assert.match(backfill, /SELECT 'phase5'::TEXT,/);
  assert.match(backfill, /b\.operator_id IS NULL/);
  assert.match(backfill, /picked\.operator_id IS NOT NULL/);
});

// ---------------------------------------------------------------------------
// 6. Trigger-function REVOKEs + indexes
// ---------------------------------------------------------------------------

test('6a. the 4 SECURITY DEFINER trigger functions are revoked', () => {
  for (const fn of [
    'cargo_requests_dispatch_trigger',
    'enforce_aircraft_medical_certifications',
    'medevac_requests_dispatch_trigger',
    'reject_retired_aircraft_offer',
  ]) {
    assert.match(
      sqlCode,
      new RegExp(`REVOKE ALL ON FUNCTION ${fn}\\(\\)\\s+FROM PUBLIC, anon, authenticated;`),
      fn
    );
  }
});

test('6b. the 5 missing indexes are created idempotently (not CONCURRENTLY)', () => {
  for (const re of [
    /CREATE INDEX IF NOT EXISTS idx_support_tickets_client_updated\s+ON support_tickets \(client_id, updated_at DESC\);/,
    /CREATE INDEX IF NOT EXISTS idx_payment_events_booking\s+ON payment_events \(booking_id\) WHERE booking_id IS NOT NULL;/,
    /CREATE INDEX IF NOT EXISTS idx_client_reset_tokens_client\s+ON client_password_reset_tokens \(client_id\);/,
    /CREATE INDEX IF NOT EXISTS idx_operator_password_reset_operator\s+ON operator_password_reset_tokens \(operator_id\);/,
    /CREATE INDEX IF NOT EXISTS idx_reviews_client\s+ON reviews \(client_id, created_at DESC\);/,
  ]) {
    assert.match(sqlCode, re);
  }
  assert.ok(!/CONCURRENTLY/i.test(sqlCode), 'the runner applies one transaction');
  assert.ok(
    !/CREATE INDEX[^;]*ON empty_leg_alert_deliveries/i.test(sqlCode),
    'alert_id is already the leading column of empty_leg_alert_deliveries_unique'
  );
});

test('6c. legacy indexes are dropped only behind the catalog left-prefix proof', () => {
  const doStart = sqlCode.indexOf("'idx_medevac_status',");
  assert.notEqual(doStart, -1);
  const block = sqlCode.slice(doStart, sqlCode.indexOf('END $$;', doStart));
  for (const name of ['idx_medevac_status', 'idx_cargo_status', 'idx_subscriptions_client']) {
    assert.ok(block.includes(`'${name}'`), name);
  }
  for (const guard of [
    "cand.indexrelid = to_regclass('public.' || v_name)",
    'NOT cand.indisunique',
    'cand.indpred IS NULL',
    'cand.indexprs IS NULL',
    'other.indisvalid',
    'other.indpred IS NULL',
    'other_rel.relam = cand_rel.relam',
    'other.indnkeyatts > cand.indnkeyatts',
    'other.indkey[k]       IS DISTINCT FROM cand.indkey[k]',
    'other.indclass[k]     IS DISTINCT FROM cand.indclass[k]',
    'IF v_cover IS NOT NULL THEN',
  ]) {
    assert.ok(block.includes(guard), `missing guard: ${guard}`);
  }
  assert.equal((sqlCode.match(/DROP INDEX/g) ?? []).length, 1, 'only the gated DROP INDEX');
  assert.ok(block.includes("EXECUTE format('DROP INDEX IF EXISTS public.%I', v_name);"));
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
