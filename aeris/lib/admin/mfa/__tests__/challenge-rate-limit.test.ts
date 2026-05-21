/**
 * MFA challenge rate-limit pure-logic tests.
 *
 * Layer-1 (no DB, no env). Runs as
 * `npm run test:admin-mfa-challenge-rate-limit`.
 */

import { strict as assert } from 'node:assert';

import {
  ADMIN_MFA_CHALLENGE_ADMIN_LIMIT,
  ADMIN_MFA_CHALLENGE_RATE_LIMIT,
  evaluateAdminMfaChallengeRateLimit,
  evaluateAdminMfaChallengeRateLimitAdminScope,
  fingerprintMfaChallengeActor,
} from '@/lib/admin/mfa/challenge-rate-limit-core';

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
console.log('\n[admin-mfa-challenge-rate-limit] running …\n');

const NOW = new Date('2026-06-15T12:00:00Z');
const minutesAgo = (m: number) =>
  new Date(NOW.getTime() - m * 60 * 1000).toISOString();

// ============================================================
// fingerprint isolation
// ============================================================

test('same identity + different admins → different fingerprints', () => {
  const a = fingerprintMfaChallengeActor(
    'ip:1.2.3.4',
    'admin-A',
    'super-secret-32-bytes-aaaaaaaaaa'
  );
  const b = fingerprintMfaChallengeActor(
    'ip:1.2.3.4',
    'admin-B',
    'super-secret-32-bytes-aaaaaaaaaa'
  );
  assert.notEqual(a, b);
});

test('same identity + same admin → stable fingerprint', () => {
  const a = fingerprintMfaChallengeActor(
    'ip:1.2.3.4',
    'admin-A',
    'super-secret-32-bytes-aaaaaaaaaa'
  );
  const b = fingerprintMfaChallengeActor(
    'ip:1.2.3.4',
    'admin-A',
    'super-secret-32-bytes-aaaaaaaaaa'
  );
  assert.equal(a, b);
});

test('different secret → different fingerprint', () => {
  const a = fingerprintMfaChallengeActor(
    'ip:1.2.3.4',
    'admin-A',
    'secret-aaa-32-bytes-long-padding'
  );
  const b = fingerprintMfaChallengeActor(
    'ip:1.2.3.4',
    'admin-A',
    'secret-bbb-32-bytes-long-padding'
  );
  assert.notEqual(a, b);
});

// ============================================================
// evaluate
// ============================================================

test('empty attempts → ok', () => {
  const v = evaluateAdminMfaChallengeRateLimit([], NOW);
  assert.equal(v.ok, true);
});

test('under failure cap → ok', () => {
  const attempts = [
    { outcome: 'invalid_otp' as const, attempted_at: minutesAgo(1) },
    { outcome: 'invalid_otp' as const, attempted_at: minutesAgo(5) },
  ];
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, true);
});

test('hit failure cap (5 in 15 min) → too_many_failures', () => {
  const attempts = Array.from({ length: 5 }, (_, i) => ({
    outcome: 'invalid_otp' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.reason, 'too_many_failures');
    assert.ok(v.retryAfterSeconds > 0);
  }
});

test('4 failures → still ok (cap = 5)', () => {
  const attempts = Array.from({ length: 4 }, (_, i) => ({
    outcome: 'invalid_otp' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, true);
});

test('hit attempt cap (20 mixed) → too_many_attempts', () => {
  const attempts = Array.from({ length: 20 }, (_, i) => ({
    outcome:
      i % 4 === 0
        ? ('success' as const)
        : i % 4 === 1
          ? ('invalid_otp' as const)
          : i % 4 === 2
            ? ('invalid_recovery' as const)
            : ('replay_same_step' as const),
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'too_many_attempts');
});

test('old failures (outside 15-min window) → ignored', () => {
  const attempts = Array.from({ length: 5 }, (_, i) => ({
    outcome: 'invalid_otp' as const,
    attempted_at: minutesAgo(20 + i),
  }));
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, true);
});

test('success-only attempts NEVER trip the failure cap', () => {
  const attempts = Array.from({ length: 10 }, (_, i) => ({
    outcome: 'success' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, true);
});

test('invalid_otp counts as failure', () => {
  const attempts = Array.from({ length: 5 }, (_, i) => ({
    outcome: 'invalid_otp' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, false);
});

test('invalid_recovery counts as failure', () => {
  const attempts = Array.from({ length: 5 }, (_, i) => ({
    outcome: 'invalid_recovery' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, false);
});

test('replay_same_step counts as failure', () => {
  const attempts = Array.from({ length: 5 }, (_, i) => ({
    outcome: 'replay_same_step' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, false);
});

test('rate_limited rows count as failure (extends lockout)', () => {
  const attempts = Array.from({ length: 5 }, (_, i) => ({
    outcome: 'rate_limited' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, false);
});

test('mix of 4 failures + 1 success → not over cap', () => {
  const attempts = [
    { outcome: 'success' as const, attempted_at: minutesAgo(1) },
    ...Array.from({ length: 4 }, (_, i) => ({
      outcome: 'invalid_otp' as const,
      attempted_at: minutesAgo(i + 2),
    })),
  ];
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, true);
});

test('malformed timestamp rows dropped silently', () => {
  const attempts = [
    { outcome: 'invalid_otp' as const, attempted_at: 'not-an-iso' },
    { outcome: 'invalid_otp' as const, attempted_at: minutesAgo(1) },
  ];
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, true);
});

test('future timestamps dropped (clock-skew defense)', () => {
  const attempts = Array.from({ length: 5 }, () => ({
    outcome: 'invalid_otp' as const,
    attempted_at: new Date(NOW.getTime() + 60_000).toISOString(),
  }));
  const v = evaluateAdminMfaChallengeRateLimit(attempts, NOW);
  assert.equal(v.ok, true);
});

// ============================================================
// Limit sanity
// ============================================================

test('failure cap is in tight range [3, 10]', () => {
  assert.ok(
    ADMIN_MFA_CHALLENGE_RATE_LIMIT.maxFailures >= 3 &&
      ADMIN_MFA_CHALLENGE_RATE_LIMIT.maxFailures <= 10
  );
});

test('attempt cap is in range [10, 50]', () => {
  assert.ok(
    ADMIN_MFA_CHALLENGE_RATE_LIMIT.maxAttempts >= 10 &&
      ADMIN_MFA_CHALLENGE_RATE_LIMIT.maxAttempts <= 50
  );
});

test('failureWindow < attemptWindow', () => {
  assert.ok(
    ADMIN_MFA_CHALLENGE_RATE_LIMIT.failureWindowMs <
      ADMIN_MFA_CHALLENGE_RATE_LIMIT.attemptWindowMs
  );
});

// ============================================================
// Admin-scope evaluator (round-2 hardening on PR #92)
// ============================================================

test('admin-scope cap is STRICTLY LARGER than per-actor cap', () => {
  // The admin-scope check legitimately includes attempts from
  // multiple devices for the same admin (laptop + phone). If
  // its limits were <= per-actor, a single-IP burst would
  // trip admin scope BEFORE actor scope — defeating the
  // intended layering.
  assert.ok(
    ADMIN_MFA_CHALLENGE_ADMIN_LIMIT.maxFailures >
      ADMIN_MFA_CHALLENGE_RATE_LIMIT.maxFailures
  );
  assert.ok(
    ADMIN_MFA_CHALLENGE_ADMIN_LIMIT.maxAttempts >
      ADMIN_MFA_CHALLENGE_RATE_LIMIT.maxAttempts
  );
});

test('admin-scope failureWindow >= per-actor failureWindow', () => {
  // Wider window = more historical attempts considered =
  // stricter throttle for the same cap number.
  assert.ok(
    ADMIN_MFA_CHALLENGE_ADMIN_LIMIT.failureWindowMs >=
      ADMIN_MFA_CHALLENGE_RATE_LIMIT.failureWindowMs
  );
});

test('admin-scope: empty attempts → ok', () => {
  const v = evaluateAdminMfaChallengeRateLimitAdminScope([], NOW);
  assert.equal(v.ok, true);
});

test('admin-scope: hits at admin maxFailures → too_many_failures', () => {
  const attempts = Array.from(
    { length: ADMIN_MFA_CHALLENGE_ADMIN_LIMIT.maxFailures },
    (_, i) => ({
      outcome: 'invalid_otp' as const,
      attempted_at: minutesAgo(i + 1),
    })
  );
  const v = evaluateAdminMfaChallengeRateLimitAdminScope(attempts, NOW);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.reason, 'too_many_failures');
  }
});

test('admin-scope: one below admin maxFailures → still ok', () => {
  const attempts = Array.from(
    { length: ADMIN_MFA_CHALLENGE_ADMIN_LIMIT.maxFailures - 1 },
    (_, i) => ({
      outcome: 'invalid_otp' as const,
      attempted_at: minutesAgo(i + 1),
    })
  );
  const v = evaluateAdminMfaChallengeRateLimitAdminScope(attempts, NOW);
  assert.equal(v.ok, true);
});

test('admin-scope: distributed scenario simulation', () => {
  // 6 different IPs × 4 failures each = 24 admin-scope
  // failures. Per-actor would never trip (each ≤ 4 < 5).
  // Admin scope WILL trip if maxFailures < 24.
  const attempts: Array<{
    outcome: 'invalid_otp';
    attempted_at: string;
  }> = [];
  for (let ip = 0; ip < 6; ip++) {
    for (let n = 0; n < 4; n++) {
      attempts.push({
        outcome: 'invalid_otp' as const,
        attempted_at: minutesAgo(ip * 4 + n + 1),
      });
    }
  }
  const v = evaluateAdminMfaChallengeRateLimitAdminScope(attempts, NOW);
  // We have 24 failures; admin-scope cap is 15 → must trip.
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'too_many_failures');
});

test('admin-scope: success-only never trips failure cap', () => {
  const attempts = Array.from({ length: 30 }, (_, i) => ({
    outcome: 'success' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluateAdminMfaChallengeRateLimitAdminScope(attempts, NOW);
  // Still trips attempt cap (30 > 50? no — 30 < 50). Should pass.
  assert.equal(v.ok, true);
});

test('admin-scope: attempt cap (any outcome)', () => {
  const attempts = Array.from(
    { length: ADMIN_MFA_CHALLENGE_ADMIN_LIMIT.maxAttempts },
    (_, i) => ({
      outcome:
        i % 2 === 0 ? ('success' as const) : ('invalid_otp' as const),
      attempted_at: minutesAgo(i + 1),
    })
  );
  const v = evaluateAdminMfaChallengeRateLimitAdminScope(attempts, NOW);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'too_many_attempts');
});

// ============================================================
// Wrap up
// ============================================================

// eslint-disable-next-line no-console
console.log(
  `\n[admin-mfa-challenge-rate-limit] ${passed} passed, ${failed} failed\n`
);
if (failed > 0) process.exit(1);
