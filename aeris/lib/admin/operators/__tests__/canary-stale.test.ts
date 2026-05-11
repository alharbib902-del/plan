/**
 * Phase 8 PR 2e — unit tests for the canary stale-flag
 * computation.
 *
 * Layer-1 (no DB), runs as
 *   npm run test:operators-canary-stale
 *
 * The test focuses on the pure helper extracted from
 * getCronTickHealth so the stale-flag contract is asserted
 * without spinning up a Supabase client mock. The full
 * query path is exercised end-to-end during Probe 20 on
 * production.
 *
 * Cases covered:
 *   1. Just-ran tick is fresh
 *   2. 1x interval is fresh (one missed tick is normal jitter)
 *   3. Slightly less than 2x interval is fresh (boundary - 1)
 *   4. Exactly 2x interval is fresh (boundary, > comparison)
 *   5. Slightly more than 2x interval is stale (boundary + 1)
 *   6. Hours-old run on the 30-min OTP cron is stale
 *   7. Hours-old run on the 6h sessions cron is fresh
 *   8. Future timestamps (clock skew) report fresh
 *   9. Garbage ISO returns false (defensive)
 */

import { strict as assert } from 'node:assert';

import {
  computeIsStale,
  EXPECTED_INTERVAL_MINUTES,
  type OperatorCleanupJobName,
} from '@/lib/admin/operators/canary-queries';

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

const NOW = new Date('2026-05-15T12:00:00Z').getTime();
const ONE_MINUTE_MS = 60 * 1000;

function isoMinutesAgo(minutes: number): string {
  return new Date(NOW - minutes * ONE_MINUTE_MS).toISOString();
}

function isoMinutesAhead(minutes: number): string {
  return new Date(NOW + minutes * ONE_MINUTE_MS).toISOString();
}

const SESSIONS_JOB: OperatorCleanupJobName =
  'cleanup_expired_operator_sessions';
const OTP_JOB: OperatorCleanupJobName = 'cleanup_expired_otp_codes';

const SESSIONS_INTERVAL = EXPECTED_INTERVAL_MINUTES[SESSIONS_JOB]; // 360
const OTP_INTERVAL = EXPECTED_INTERVAL_MINUTES[OTP_JOB]; // 30

// 1. just-ran tick is fresh
test('just-ran tick is fresh', () => {
  assert.equal(computeIsStale(SESSIONS_JOB, isoMinutesAgo(0), NOW), false);
});

// 2. 1x interval is fresh
test('1x interval is fresh (one missed tick is normal)', () => {
  assert.equal(
    computeIsStale(SESSIONS_JOB, isoMinutesAgo(SESSIONS_INTERVAL), NOW),
    false
  );
});

// 3. boundary - 1 minute → fresh
test('2x interval - 1 minute is fresh (boundary)', () => {
  assert.equal(
    computeIsStale(
      SESSIONS_JOB,
      isoMinutesAgo(2 * SESSIONS_INTERVAL - 1),
      NOW
    ),
    false
  );
});

// 4. exactly 2x interval — fresh because the helper uses `>` not `>=`
test('exactly 2x interval is fresh (boundary, > not >=)', () => {
  assert.equal(
    computeIsStale(SESSIONS_JOB, isoMinutesAgo(2 * SESSIONS_INTERVAL), NOW),
    false
  );
});

// 5. boundary + 1 minute → stale
test('2x interval + 1 minute is stale', () => {
  assert.equal(
    computeIsStale(
      SESSIONS_JOB,
      isoMinutesAgo(2 * SESSIONS_INTERVAL + 1),
      NOW
    ),
    true
  );
});

// 6. 90-min-old OTP tick → stale (3x its 30-min interval)
test('90-min-old OTP tick is stale', () => {
  assert.equal(computeIsStale(OTP_JOB, isoMinutesAgo(90), NOW), true);
});

// 7. 90-min-old sessions tick → fresh (well under 2x its 6h interval)
test('90-min-old sessions tick is fresh', () => {
  assert.equal(
    computeIsStale(SESSIONS_JOB, isoMinutesAgo(90), NOW),
    false
  );
});

// 8. clock-skew safety: a tick "in the future" reports fresh
test('future timestamp reports fresh (clock skew defensive)', () => {
  assert.equal(
    computeIsStale(SESSIONS_JOB, isoMinutesAhead(60), NOW),
    false
  );
});

// 9. garbage ISO returns false (defensive against bad data)
test('garbage ISO returns false', () => {
  assert.equal(computeIsStale(SESSIONS_JOB, 'not-a-date', NOW), false);
});

// ============================================================
// Summary
// ============================================================

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
