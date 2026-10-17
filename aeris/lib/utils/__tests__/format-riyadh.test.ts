/**
 * Unit tests for `formatInRiyadh`.
 *
 * Pins the CLAUDE.md formatting contract (Gregorian, Western digits,
 * Asia/Riyadh) and — the reason the helper exists — that the output
 * does not depend on the runtime zone, so a client component renders
 * the same string on the UTC server and in a non-Riyadh browser.
 *
 * Runs as:
 *   npm run test:utils-format-riyadh
 */

import { strict as assert } from 'node:assert';

import { formatInRiyadh, type RiyadhFormatOptions } from '../format-riyadh';

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

const NOON_UTC = '2026-07-19T12:00:00Z'; // 15:00 in Riyadh
// 22:30 UTC on the 16th is 01:30 on the 17th in Riyadh.
const LATE_UTC = '2026-10-16T22:30:00Z';
const ARABIC_INDIC = /[٠-٩۰-۹]/;
const ZONES = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati'];

function inZone<T>(tz: string, fn: () => T): T {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

test('runtime zone switch is effective (guards the TZ tests below)', () => {
  const localDay = (tz: string) =>
    inZone(tz, () => new Date(LATE_UTC).toLocaleDateString('en-GB'));
  assert.notEqual(localDay('America/Los_Angeles'), localDay('Asia/Tokyo'));
});

test('output is identical whatever the runtime TZ', () => {
  const shapes: RiyadhFormatOptions[] = [
    { year: 'numeric', month: 'long', day: 'numeric' },
    { year: 'numeric', month: 'short', day: 'numeric' },
    { dateStyle: 'medium', timeStyle: 'short' },
    { hour: '2-digit', minute: '2-digit' },
  ];
  for (const options of shapes) {
    for (const value of [NOON_UTC, LATE_UTC]) {
      const outputs = ZONES.map((tz) => inZone(tz, () => formatInRiyadh(value, options)));
      assert.equal(new Set(outputs).size, 1, `${value} ${JSON.stringify(options)}: ${outputs.join(' | ')}`);
    }
  }
});

test('renders Riyadh wall-clock time', () => {
  assert.equal(
    formatInRiyadh(NOON_UTC, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    '15:00'
  );
});

test('rolls the calendar day at Riyadh midnight, not UTC midnight', () => {
  assert.equal(formatInRiyadh(LATE_UTC, { year: 'numeric', month: 'long', day: 'numeric' }), '17 أكتوبر 2026');
});

test('Gregorian calendar with Western digits', () => {
  const out = formatInRiyadh(NOON_UTC, { year: 'numeric', month: 'long', day: 'numeric' });
  assert.equal(out, '19 يوليو 2026');
  assert.equal(ARABIC_INDIC.test(formatInRiyadh(NOON_UTC, { dateStyle: 'full', timeStyle: 'short' })), false);
});

test('caller cannot override calendar / digits / zone', () => {
  const sneaky = {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    year: 'numeric',
    timeZone: 'UTC',
    numberingSystem: 'arab',
    calendar: 'islamic-umalqura',
  } as unknown as RiyadhFormatOptions;
  const out = formatInRiyadh(NOON_UTC, sneaky);
  assert.match(out, /2026/);
  assert.match(out, /15:00/);
  assert.equal(ARABIC_INDIC.test(out), false);
});

test('accepts Date objects and epoch milliseconds', () => {
  const opts: RiyadhFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  const expected = formatInRiyadh(NOON_UTC, opts);
  assert.equal(formatInRiyadh(new Date(NOON_UTC), opts), expected);
  assert.equal(formatInRiyadh(Date.parse(NOON_UTC), opts), expected);
});

test('empty values return the empty label', () => {
  const opts: RiyadhFormatOptions = { year: 'numeric' };
  assert.equal(formatInRiyadh(null, opts), '—');
  assert.equal(formatInRiyadh(undefined, opts), '—');
  assert.equal(formatInRiyadh('', opts), '—');
  assert.equal(formatInRiyadh(null, opts, 'غير محدد'), 'غير محدد');
});

test('unparseable input never renders "Invalid Date"', () => {
  const opts: RiyadhFormatOptions = { year: 'numeric' };
  assert.equal(formatInRiyadh('not-a-date', opts), 'not-a-date');
  assert.equal(formatInRiyadh(new Date('nope'), opts), '—');
  assert.equal(formatInRiyadh(Number.NaN, opts), '—');
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
