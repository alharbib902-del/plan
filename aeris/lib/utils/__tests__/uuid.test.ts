/**
 * Unit tests for `isUuid`.
 *
 * Pins the Codex round 1 PR #57 P2 #1 contract: any
 * untrusted string that flows into a Postgres UUID
 * comparison MUST be UUID-shape-checked first, otherwise
 * PostgREST raises 22P02 invalid_text_representation and
 * the calling page renders a 500. The helper returns true
 * only for canonical RFC 4122 8-4-4-4-12 hex layout.
 *
 * Runs as:
 *   npm run test:utils-uuid
 *
 * Cases covered:
 *   1.  Lowercase v4 UUID accepted
 *   2.  Uppercase UUID accepted
 *   3.  Mixed-case UUID accepted (Postgres normalises)
 *   4.  Wrong segment length rejected (8-4-4-4-13)
 *   5.  Missing dashes rejected
 *   6.  Trailing whitespace rejected
 *   7.  Non-hex character rejected (z)
 *   8.  Empty string rejected
 *   9.  null + number + undefined rejected (type guard)
 *  10.  v7-style UUID accepted (no version-nibble enforcement)
 */

import { strict as assert } from 'node:assert';

import { isUuid } from '../uuid';

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

test('1. lowercase v4 UUID accepted', () => {
  assert.equal(
    isUuid('11111111-2222-4333-8444-555555555555'),
    true
  );
});

test('2. uppercase UUID accepted', () => {
  assert.equal(
    isUuid('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'),
    true
  );
});

test('3. mixed-case UUID accepted', () => {
  assert.equal(
    isUuid('aBcDeFaB-1234-4abc-8DEF-9876fedcba01'),
    true
  );
});

test('4. wrong segment length rejected', () => {
  // 8-4-4-4-13 (last group too long)
  assert.equal(
    isUuid('11111111-2222-4333-8444-5555555555555'),
    false
  );
});

test('5. missing dashes rejected', () => {
  assert.equal(
    isUuid('111111112222433384445555555 55555'.replace(/\s/g, '')),
    false
  );
  assert.equal(
    isUuid('111111112222433384445555555555555'),
    false
  );
});

test('6. trailing whitespace rejected', () => {
  assert.equal(
    isUuid('11111111-2222-4333-8444-555555555555 '),
    false
  );
});

test('7. non-hex character rejected', () => {
  assert.equal(
    isUuid('11111111-2222-4zzz-8444-555555555555'),
    false
  );
});

test('8. empty string rejected', () => {
  assert.equal(isUuid(''), false);
});

test('9. null + number + undefined rejected', () => {
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid(42), false);
  assert.equal(isUuid({}), false);
});

test('10. v7-style UUID accepted (any version nibble)', () => {
  // Modern Postgres uuid_generate_v7 emits a 7 in the
  // version nibble. Helper does NOT enforce a specific
  // version, so this must pass.
  assert.equal(
    isUuid('01890000-0000-7000-8000-000000000001'),
    true
  );
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
