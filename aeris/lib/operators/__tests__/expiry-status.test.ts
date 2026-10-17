/**
 * Unit tests for the operator-portal licence expiry classifier
 * (lib/operators/expiry-status.ts).
 *
 * Runs as:
 *   npm run test:operators-expiry-status
 */

import { strict as assert } from 'node:assert';

import {
  EXPIRY_SOON_DAYS,
  classifyExpiry,
  riyadhTodayIsoDate,
} from '../expiry-status';

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

const TODAY = '2026-10-17';

test('yesterday is expired', () => {
  assert.equal(classifyExpiry('2026-10-16', TODAY), 'expired');
});

test('the expiry day itself is still valid-but-soon', () => {
  assert.equal(classifyExpiry('2026-10-17', TODAY), 'expiring_soon');
});

test(`exactly ${EXPIRY_SOON_DAYS} days out is expiring soon`, () => {
  assert.equal(classifyExpiry('2026-11-16', TODAY), 'expiring_soon');
});

test(`${EXPIRY_SOON_DAYS + 1} days out is valid`, () => {
  assert.equal(classifyExpiry('2026-11-17', TODAY), 'valid');
});

test('crosses month/year boundaries correctly', () => {
  assert.equal(classifyExpiry('2027-01-01', '2026-12-31'), 'expiring_soon');
  assert.equal(classifyExpiry('2026-12-31', '2027-01-01'), 'expired');
});

test('a timestamp-shaped value uses its date part', () => {
  assert.equal(classifyExpiry('2026-10-16T23:00:00Z', TODAY), 'expired');
});

test('missing or malformed values return null', () => {
  assert.equal(classifyExpiry(null, TODAY), null);
  assert.equal(classifyExpiry(undefined, TODAY), null);
  assert.equal(classifyExpiry('', TODAY), null);
  assert.equal(classifyExpiry('soon', TODAY), null);
  assert.equal(classifyExpiry('2026-10-17', 'today'), null);
});

test('riyadhTodayIsoDate rolls over at Riyadh midnight, not UTC', () => {
  assert.equal(riyadhTodayIsoDate(new Date('2026-10-16T20:59:00Z')), '2026-10-16');
  assert.equal(riyadhTodayIsoDate(new Date('2026-10-16T21:00:00Z')), '2026-10-17');
});

test('riyadhTodayIsoDate ignores the process time zone', () => {
  const original = process.env.TZ;
  try {
    const outputs = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map((tz) => {
      process.env.TZ = tz;
      return riyadhTodayIsoDate(new Date('2026-10-16T22:00:00Z'));
    });
    for (const o of outputs) assert.equal(o, '2026-10-17');
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

// eslint-disable-next-line no-console
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
