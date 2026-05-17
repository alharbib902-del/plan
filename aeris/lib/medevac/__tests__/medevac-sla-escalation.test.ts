/**
 * Phase 12 PR 3 — tests for the SLA interval parser used by
 * /api/cron/medevac/sla-escalation.
 *
 * Runs as: npm run test:medevac-sla-escalation
 *
 * Cases (10 total):
 *   1. '01:00:00' (1h critical) → 60
 *   2. '04:00:00' (4h moderate) → 240
 *   3. '24:00:00' (24h stable) → 1440
 *   4. '01:30:00' → 90
 *   5. '00:00:30' (30 sec) → 0.5
 *   6. 'PT1H' ISO → 60
 *   7. 'PT24H' ISO → 1440
 *   8. '1 hour' verbose → 60
 *   9. '90 minutes' verbose → 90
 *  10. '' empty → 0 (defensive)
 */

import { strict as assert } from 'node:assert';

import { parseSlaIntervalMinutes } from '@/lib/medevac/sla-interval';

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
    console.log(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// eslint-disable-next-line no-console
console.log('\n[medevac-sla-escalation] running …\n');

test("1.  '01:00:00' → 60", () => {
  assert.equal(parseSlaIntervalMinutes('01:00:00'), 60);
});
test("2.  '04:00:00' → 240", () => {
  assert.equal(parseSlaIntervalMinutes('04:00:00'), 240);
});
test("3.  '24:00:00' → 1440", () => {
  assert.equal(parseSlaIntervalMinutes('24:00:00'), 1440);
});
test("4.  '01:30:00' → 90", () => {
  assert.equal(parseSlaIntervalMinutes('01:30:00'), 90);
});
test("5.  '00:00:30' → 0.5", () => {
  assert.equal(parseSlaIntervalMinutes('00:00:30'), 0.5);
});
test("6.  'PT1H' → 60", () => {
  assert.equal(parseSlaIntervalMinutes('PT1H'), 60);
});
test("7.  'PT24H' → 1440", () => {
  assert.equal(parseSlaIntervalMinutes('PT24H'), 1440);
});
test("8.  '1 hour' → 60", () => {
  assert.equal(parseSlaIntervalMinutes('1 hour'), 60);
});
test("9.  '90 minutes' → 90", () => {
  assert.equal(parseSlaIntervalMinutes('90 minutes'), 90);
});
test("10. '' → 0 (defensive)", () => {
  assert.equal(parseSlaIntervalMinutes(''), 0);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
