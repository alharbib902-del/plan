/**
 * Unit tests for `datetimeLocalToRiyadhIso`.
 *
 * Pins the Phase 7 + Phase 9 PR 2 round 1 P2 #3 contract:
 * an `<input type="datetime-local">` raw value gets pinned
 * to Asia/Riyadh (+03:00) so the server-side TIMESTAMPTZ
 * stores the right instant regardless of the user's
 * browser zone.
 *
 * Runs as:
 *   npm run test:utils-datetime-local
 *
 * Cases covered:
 *   1.  16-char value gets `:00+03:00` appended
 *   2.  19-char value (with seconds) gets `+03:00` appended
 *   3.  Whitespace trimmed from both ends
 *   4.  Resulting ISO is parseable by Date(...) and matches
 *       the Riyadh wall-time (no offset shift)
 *   5.  Date(...) gives the correct UTC instant for a
 *       Riyadh wall-time of 14:00 (= 11:00 UTC)
 *   6.  Empty string after trim still produces well-formed
 *       output (defence — caller should guard, but helper
 *       must not crash)
 */

import { strict as assert } from 'node:assert';

import { datetimeLocalToRiyadhIso } from '../datetime-local';

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

test('1. 16-char value gets `:00+03:00` appended', () => {
  assert.equal(
    datetimeLocalToRiyadhIso('2026-08-15T14:30'),
    '2026-08-15T14:30:00+03:00'
  );
});

test('2. 19-char value (with seconds) gets `+03:00` appended', () => {
  assert.equal(
    datetimeLocalToRiyadhIso('2026-08-15T14:30:45'),
    '2026-08-15T14:30:45+03:00'
  );
});

test('3. whitespace trimmed from both ends', () => {
  assert.equal(
    datetimeLocalToRiyadhIso('  2026-08-15T14:30  '),
    '2026-08-15T14:30:00+03:00'
  );
});

test('4. resulting ISO parses and represents Riyadh wall time', () => {
  const iso = datetimeLocalToRiyadhIso('2026-08-15T14:00');
  const d = new Date(iso);
  assert.equal(Number.isFinite(d.getTime()), true);
  // 14:00 Riyadh = 11:00 UTC — assert via getUTCHours.
  assert.equal(d.getUTCHours(), 11);
  assert.equal(d.getUTCMinutes(), 0);
  assert.equal(d.getUTCDate(), 15);
});

test('5. Riyadh midnight = 21:00 UTC previous day', () => {
  const iso = datetimeLocalToRiyadhIso('2026-08-15T00:00');
  const d = new Date(iso);
  assert.equal(d.getUTCHours(), 21);
  assert.equal(d.getUTCDate(), 14);
});

test('6. empty string returns well-formed output (no crash)', () => {
  // Caller is expected to guard, but the helper must not
  // throw on empty input — degrades gracefully.
  const result = datetimeLocalToRiyadhIso('');
  assert.equal(typeof result, 'string');
  assert.equal(result.endsWith('+03:00'), true);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
