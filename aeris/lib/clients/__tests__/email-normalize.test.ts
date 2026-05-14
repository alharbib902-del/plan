/**
 * Phase 9 PR 1 — unit tests for the email-normalisation
 * contract that the SQL `_normalize_client_email` helper
 * implements (LOWER(TRIM(...))).
 *
 * Layer-1 (no DB): re-implements the SQL contract in TS so
 * we can assert the normalisation rules without a Postgres
 * roundtrip. The actual SQL function lives in the migration
 * file; this suite documents and pins the contract that the
 * Server Action layer relies on (e.g. duplicate-email
 * lookups must agree with the normalisation used by the
 * RPC).
 *
 * Runs as:
 *   npm run test:clients-email-normalize
 *
 * Cases covered:
 *   1. ASCII lowercase passthrough
 *   2. Trailing whitespace stripped
 *   3. Leading whitespace stripped
 *   4. Mixed case folds to lowercase
 *   5. Embedded whitespace preserved (single space inside)
 *   6. Empty string normalises to empty
 *   7. Arabic-domain email folds correctly
 *   8. + alias preserved (case-sensitive segment)
 *   9. Multiple internal spaces preserved as-is
 *  10. Mixed Arabic + ASCII case folding
 */

import { strict as assert } from 'node:assert';

/**
 * TS mirror of the SQL helper's contract:
 *   SELECT LOWER(TRIM(p_email))
 *
 * PostgreSQL TRIM defaults to stripping ASCII whitespace
 * (spaces, tabs, newlines) from BOTH ends. LOWER applies
 * Unicode lowercasing per the database collation
 * (typically C.UTF-8 in Supabase).
 */
function normaliseClientEmail(input: string): string {
  return input.trim().toLowerCase();
}

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

test('1. ASCII lowercase passthrough', () => {
  assert.equal(normaliseClientEmail('user@aeris.sa'), 'user@aeris.sa');
});

test('2. trailing whitespace stripped', () => {
  assert.equal(normaliseClientEmail('user@aeris.sa   '), 'user@aeris.sa');
});

test('3. leading whitespace stripped', () => {
  assert.equal(normaliseClientEmail('   user@aeris.sa'), 'user@aeris.sa');
});

test('4. mixed case folds to lowercase', () => {
  assert.equal(
    normaliseClientEmail('User.Name@Aeris.SA'),
    'user.name@aeris.sa'
  );
});

test('5. embedded whitespace preserved as-is', () => {
  // Real emails do not contain spaces, but the normaliser
  // does not strip them — that is the validator layer's
  // job. The normaliser only trims the ends.
  assert.equal(
    normaliseClientEmail('  user name@aeris.sa  '),
    'user name@aeris.sa'
  );
});

test('6. empty string normalises to empty', () => {
  assert.equal(normaliseClientEmail(''), '');
  assert.equal(normaliseClientEmail('   '), '');
  assert.equal(normaliseClientEmail('\t\n'), '');
});

test('7. Arabic-domain email folds correctly', () => {
  // Arabic letters have no case distinction, so LOWER is a
  // no-op on the local part. Domain (ASCII per IDN punycode
  // expectation) lowercases normally.
  assert.equal(
    normaliseClientEmail('بسام@AERIS.SA'),
    'بسام@aeris.sa'
  );
});

test('8. + alias preserved (case-sensitive segment in spec)', () => {
  // Phase 9 normaliser does NOT strip plus-aliases. RFC 5321
  // local-part case-sensitivity is moot for this normaliser:
  // the Server Action's lookup uses LOWER(...) for the
  // unique-index match, so casing in the alias gets folded
  // alongside the rest.
  assert.equal(
    normaliseClientEmail('User+Test@aeris.sa'),
    'user+test@aeris.sa'
  );
});

test('9. multiple internal spaces preserved as-is', () => {
  assert.equal(
    normaliseClientEmail('   a  b@aeris.sa   '),
    'a  b@aeris.sa'
  );
});

test('10. mixed Arabic + ASCII case folding', () => {
  assert.equal(
    normaliseClientEmail('  Founder@شركة.SA  '),
    'founder@شركة.sa'
  );
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
