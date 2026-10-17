/**
 * Unit tests for `formatRiyadhDateAr` / `formatRiyadhDateTimeAr`.
 *
 * Pins the operator-portal contract: output is Asia/Riyadh wall time,
 * gregorian, Western digits — identical whatever the process TZ is
 * (Vercel renders in UTC; a missing timeZone showed windows 3h early).
 *
 * Runs as:
 *   npm run test:utils-riyadh-format
 */

import { strict as assert } from 'node:assert';

import { formatRiyadhDateAr, formatRiyadhDateTimeAr } from '../format';

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
    console.error(err);
    failed++;
  }
}

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;
// 21:30 UTC on 16 Oct = 00:30 on 17 Oct in Riyadh (+03:00).
const NEAR_MIDNIGHT = '2026-10-16T21:30:00Z';

test('date-time renders the Riyadh calendar day and wall time', () => {
  const out = formatRiyadhDateTimeAr(NEAR_MIDNIGHT);
  assert.match(out, /\b17\b/);
  assert.match(out, /أكتوبر/);
  assert.match(out, /2026/);
  assert.match(out, /12:30/);
  assert.doesNotMatch(out, /\b16\b/);
  assert.doesNotMatch(out, /9:30/);
});

test('date-only renders the Riyadh calendar day', () => {
  const out = formatRiyadhDateAr(NEAR_MIDNIGHT);
  assert.match(out, /\b17\b/);
  assert.match(out, /أكتوبر/);
  assert.doesNotMatch(out, /12:30/);
});

test('uses Western digits, never Arabic-Indic', () => {
  assert.doesNotMatch(formatRiyadhDateTimeAr(NEAR_MIDNIGHT), ARABIC_INDIC_DIGITS);
  assert.doesNotMatch(formatRiyadhDateAr(NEAR_MIDNIGHT), ARABIC_INDIC_DIGITS);
});

test('uses the gregorian calendar (not Umm al-Qura)', () => {
  assert.match(formatRiyadhDateAr('2026-03-05T09:00:00Z'), /^5 مارس 2026$/);
});

test('a plain DB date stays on its own calendar day', () => {
  assert.match(formatRiyadhDateAr('2026-03-05'), /^5 مارس 2026$/);
});

test('output is identical across process time zones', () => {
  const original = process.env.TZ;
  const zones = ['UTC', 'Asia/Riyadh', 'America/Los_Angeles', 'Pacific/Kiritimati'];
  try {
    const outputs = zones.map((tz) => {
      process.env.TZ = tz;
      return [formatRiyadhDateTimeAr(NEAR_MIDNIGHT), formatRiyadhDateAr(NEAR_MIDNIGHT)].join('|');
    });
    for (const o of outputs) assert.equal(o, outputs[0]);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('accepts Date instances', () => {
  assert.equal(
    formatRiyadhDateTimeAr(new Date(NEAR_MIDNIGHT)),
    formatRiyadhDateTimeAr(NEAR_MIDNIGHT)
  );
});

test('null / undefined / empty / invalid fall back', () => {
  assert.equal(formatRiyadhDateTimeAr(null), '—');
  assert.equal(formatRiyadhDateTimeAr(undefined), '—');
  assert.equal(formatRiyadhDateAr(''), '—');
  assert.equal(formatRiyadhDateAr('not-a-date'), '—');
  assert.equal(formatRiyadhDateTimeAr(null, 'غير محدد'), 'غير محدد');
});

// eslint-disable-next-line no-console
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
