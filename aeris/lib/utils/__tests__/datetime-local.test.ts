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
 *   13-15. `datetimeLocalToRiyadhInstant` normalises to UTC
 *       and returns null for unparseable / already-zoned input
 *   16. Regression guard: the operator offer action converts
 *       departure_eta via the Riyadh helper, never new Date()
 */

import { strict as assert } from 'node:assert';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  datetimeLocalToRiyadhInstant,
  datetimeLocalToRiyadhIso,
  riyadhIsoToDatetimeLocal,
} from '../datetime-local';

const here = dirname(fileURLToPath(import.meta.url));
// here = aeris/lib/utils/__tests__
const OFFER_ACTION = join(
  here,
  '..',
  '..',
  '..',
  'app',
  'operator',
  'offer',
  '[token]',
  'actions.ts'
);

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

// ============================================================
// riyadhIsoToDatetimeLocal — reverse helper (Round 4 PR #76 P2 #1)
// ============================================================

test('7. round-trip: Riyadh 14:00 → ISO → Riyadh 14:00', () => {
  const original = '2026-08-15T14:00';
  const iso = datetimeLocalToRiyadhIso(original);
  const roundTripped = riyadhIsoToDatetimeLocal(iso);
  assert.equal(roundTripped, original);
});

test('8. round-trip: Riyadh midnight → ISO → Riyadh midnight', () => {
  const original = '2026-08-15T00:00';
  const iso = datetimeLocalToRiyadhIso(original);
  const roundTripped = riyadhIsoToDatetimeLocal(iso);
  assert.equal(roundTripped, original);
});

test('9. ISO with Z (UTC) renders as Riyadh wall time', () => {
  // 11:00 UTC = 14:00 Riyadh
  assert.equal(
    riyadhIsoToDatetimeLocal('2026-08-15T11:00:00Z'),
    '2026-08-15T14:00'
  );
});

test('10. ISO with +05:00 offset → Riyadh wall time', () => {
  // 14:00 +05:00 = 09:00 UTC = 12:00 Riyadh
  assert.equal(
    riyadhIsoToDatetimeLocal('2026-08-15T14:00:00+05:00'),
    '2026-08-15T12:00'
  );
});

test('11. ISO crossing day boundary backwards', () => {
  // 22:00 UTC on 2026-08-15 = 01:00 Riyadh on 2026-08-16
  assert.equal(
    riyadhIsoToDatetimeLocal('2026-08-15T22:00:00Z'),
    '2026-08-16T01:00'
  );
});

test('12. invalid input returns empty string', () => {
  assert.equal(riyadhIsoToDatetimeLocal(''), '');
  assert.equal(riyadhIsoToDatetimeLocal('not-a-date'), '');
  assert.equal(
    riyadhIsoToDatetimeLocal(null as unknown as string),
    ''
  );
  assert.equal(
    riyadhIsoToDatetimeLocal(undefined as unknown as string),
    ''
  );
});

test('13. instant: Riyadh 14:00 → 11:00Z (independent of process TZ)', () => {
  assert.equal(
    datetimeLocalToRiyadhInstant('2026-08-15T14:00'),
    '2026-08-15T11:00:00.000Z'
  );
});

test('14. instant: Riyadh 01:30 crosses the day boundary backwards', () => {
  assert.equal(
    datetimeLocalToRiyadhInstant('2026-08-16T01:30'),
    '2026-08-15T22:30:00.000Z'
  );
});

test('15. instant: unparseable input returns null', () => {
  assert.equal(datetimeLocalToRiyadhInstant(''), null);
  assert.equal(datetimeLocalToRiyadhInstant('not-a-date'), null);
  // A value that already carries a zone is not a datetime-local
  // value; the helper must reject it rather than double-offset it.
  assert.equal(datetimeLocalToRiyadhInstant('2026-08-15T11:00:00Z'), null);
});

test('16. regression: operator offer action pins departure_eta to Riyadh', () => {
  // On Vercel the process zone is UTC, so `new Date(localValue)`
  // stored an operator's 14:00 as 14:00Z (17:00 Riyadh).
  const src = readFileSync(OFFER_ACTION, 'utf8');
  assert.ok(
    src.includes('datetimeLocalToRiyadhInstant(') &&
      src.includes('parsed.data.departure_eta'),
    'offer action must convert departure_eta via datetimeLocalToRiyadhInstant'
  );
  assert.ok(
    !/new Date\(\s*parsed\.data\.departure_eta\s*\)/.test(src),
    'offer action must not parse departure_eta with new Date()'
  );
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
