/**
 * Phase 12 PR 3 — tests for the cert-expiry cron helpers
 * (lib/medevac/cert-expiry-helpers.ts). The three D11 phases:
 *   - warning cascade (no flip)
 *   - enforcement flip (cert actually expired)
 *   - renewal reset (> 30 days renewal only — Round 4 P2 #4)
 *
 * Runs as: npm run test:medical-cert-expiry
 *
 * Cases (14 total):
 *   isCertExpired:
 *     1. expiry in past → true
 *     2. expiry exactly now → true (<=)
 *     3. expiry in future → false
 *     4. malformed string → false
 *   hasAnyCapability:
 *     5. all false → false
 *     6. one true → true
 *   dueWarningThreshold:
 *     7. expires in 35 days → null (no threshold matches)
 *     8. expires in 25 days → 30 (the only matching window)
 *     9. expires in 10 days, 30d flag set, 14d null → 14
 *    10. expires in 0.5 days, all flags set → null (no due)
 *    11. expires in 0.5 days, 1d flag null → 1
 *    12. already expired → null (enforcement phase takes over)
 *   shouldResetWarnings:
 *    13. expiry > 30 days + flags set → true
 *    14. expiry = 25 days + flags set → false (too close)
 */

import { strict as assert } from 'node:assert';

import {
  isCertExpired,
  hasAnyCapability,
  dueWarningThreshold,
  shouldResetWarnings,
  type CertExpiryRow,
} from '@/lib/medevac/cert-expiry-helpers';

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
console.log('\n[medical-cert-expiry] running …\n');

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysFromNow = (d: number) =>
  new Date(NOW + d * DAY_MS).toISOString();

function makeRow(overrides: Partial<CertExpiryRow> = {}): CertExpiryRow {
  return {
    certification_expires_at: isoDaysFromNow(60),
    supports_bmt: true,
    supports_als: false,
    supports_cct: false,
    supports_repatriation: false,
    warning_30d_sent_at: null,
    warning_14d_sent_at: null,
    warning_7d_sent_at: null,
    warning_1d_sent_at: null,
    ...overrides,
  };
}

// isCertExpired
test('1. expiry in past → true', () => {
  assert.equal(
    isCertExpired(
      { certification_expires_at: isoDaysFromNow(-1) },
      NOW
    ),
    true
  );
});
test('2. expiry exactly now → true (<=)', () => {
  assert.equal(
    isCertExpired(
      { certification_expires_at: new Date(NOW).toISOString() },
      NOW
    ),
    true
  );
});
test('3. expiry in future → false', () => {
  assert.equal(
    isCertExpired(
      { certification_expires_at: isoDaysFromNow(10) },
      NOW
    ),
    false
  );
});
test('4. malformed string → false (defensive)', () => {
  assert.equal(
    isCertExpired({ certification_expires_at: 'not-a-date' }, NOW),
    false
  );
});

// hasAnyCapability
test('5. all false → false', () => {
  assert.equal(
    hasAnyCapability({
      supports_bmt: false,
      supports_als: false,
      supports_cct: false,
      supports_repatriation: false,
    }),
    false
  );
});
test('6. one true → true', () => {
  assert.equal(
    hasAnyCapability({
      supports_bmt: false,
      supports_als: false,
      supports_cct: true,
      supports_repatriation: false,
    }),
    true
  );
});

// dueWarningThreshold
test('7. expires in 35 days → null', () => {
  const r = makeRow({ certification_expires_at: isoDaysFromNow(35) });
  assert.equal(dueWarningThreshold(r, NOW), null);
});
test('8. expires in 25 days → 30 (only window matching)', () => {
  const r = makeRow({ certification_expires_at: isoDaysFromNow(25) });
  assert.equal(dueWarningThreshold(r, NOW), 30);
});
test('9. expires in 10 days, 30d set, 14d null → 14', () => {
  const r = makeRow({
    certification_expires_at: isoDaysFromNow(10),
    warning_30d_sent_at: new Date(NOW - 5 * DAY_MS).toISOString(),
    warning_14d_sent_at: null,
  });
  assert.equal(dueWarningThreshold(r, NOW), 14);
});
test('10. expires in 0.5 days, all flags set → null', () => {
  const stamp = new Date(NOW - DAY_MS).toISOString();
  const r = makeRow({
    certification_expires_at: isoDaysFromNow(0.5),
    warning_30d_sent_at: stamp,
    warning_14d_sent_at: stamp,
    warning_7d_sent_at: stamp,
    warning_1d_sent_at: stamp,
  });
  assert.equal(dueWarningThreshold(r, NOW), null);
});
test('11. expires in 0.5 days, 1d flag null → 1', () => {
  const stamp = new Date(NOW - DAY_MS).toISOString();
  const r = makeRow({
    certification_expires_at: isoDaysFromNow(0.5),
    warning_30d_sent_at: stamp,
    warning_14d_sent_at: stamp,
    warning_7d_sent_at: stamp,
    warning_1d_sent_at: null,
  });
  assert.equal(dueWarningThreshold(r, NOW), 1);
});
test('12. already expired → null (enforcement phase takes over)', () => {
  const r = makeRow({ certification_expires_at: isoDaysFromNow(-1) });
  assert.equal(dueWarningThreshold(r, NOW), null);
});

// shouldResetWarnings
test('13. expiry > 30 days + flags set → true', () => {
  const r = makeRow({
    certification_expires_at: isoDaysFromNow(60),
    warning_30d_sent_at: 'some-prior-stamp',
  });
  assert.equal(shouldResetWarnings(r, NOW), true);
});
test('14. expiry = 25 days + flags set → false (Round 4 P2 #4 floor)', () => {
  const r = makeRow({
    certification_expires_at: isoDaysFromNow(25),
    warning_30d_sent_at: 'some-prior-stamp',
  });
  assert.equal(shouldResetWarnings(r, NOW), false);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
