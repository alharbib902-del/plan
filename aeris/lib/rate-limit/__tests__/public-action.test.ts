/**
 * Public-action rate-limit pure-logic test.
 *
 * Layer-1 (no DB, no env). Runs as
 * `npm run test:public-action-rate-limit`.
 *
 * Mirrors the admin login rate-limit test contract but per-
 * action: each action has its own limits and the same actor
 * across two actions should be throttled independently.
 */

import { strict as assert } from 'node:assert';

import {
  PUBLIC_ACTION_LIMITS,
  actorIdentityFromHeaders,
  evaluatePublicActionRateLimit,
  fingerprintPublicActionActor,
  firstForwardedIp,
} from '@/lib/rate-limit/public-action-core';

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
console.log('\n[public-action-rate-limit] running …\n');

const NOW = new Date('2026-06-15T12:00:00Z');
const minutesAgo = (m: number) =>
  new Date(NOW.getTime() - m * 60 * 1000).toISOString();

// ============================================================
// firstForwardedIp
// ============================================================

test('firstForwardedIp picks the first comma-separated entry', () => {
  assert.equal(firstForwardedIp('1.2.3.4, 5.6.7.8'), '1.2.3.4');
  assert.equal(firstForwardedIp('  9.9.9.9 '), '9.9.9.9');
});

test('firstForwardedIp returns null for empty or null', () => {
  assert.equal(firstForwardedIp(null), null);
  assert.equal(firstForwardedIp(''), null);
  assert.equal(firstForwardedIp('   '), null);
});

// ============================================================
// actorIdentityFromHeaders
// ============================================================

test('prefers forwardedFor first IP', () => {
  const id = actorIdentityFromHeaders({
    forwardedFor: '1.2.3.4, 5.6.7.8',
    realIp: '9.9.9.9',
    cfConnectingIp: '8.8.8.8',
    userAgent: 'Mozilla',
  });
  assert.equal(id, 'ip:1.2.3.4');
});

test('falls back to realIp when forwardedFor missing', () => {
  const id = actorIdentityFromHeaders({
    forwardedFor: null,
    realIp: '9.9.9.9',
    cfConnectingIp: '8.8.8.8',
    userAgent: 'Mozilla',
  });
  assert.equal(id, 'ip:9.9.9.9');
});

test('falls back to cfConnectingIp third', () => {
  const id = actorIdentityFromHeaders({
    forwardedFor: null,
    realIp: null,
    cfConnectingIp: '8.8.8.8',
    userAgent: 'Mozilla',
  });
  assert.equal(id, 'ip:8.8.8.8');
});

test('falls back to UA bucket when no IP available', () => {
  const id = actorIdentityFromHeaders({
    forwardedFor: null,
    realIp: null,
    cfConnectingIp: null,
    userAgent: 'CuriousBot/1.0',
  });
  assert.equal(id, 'unknown-ip:CuriousBot/1.0');
});

test('final fallback when nothing present', () => {
  const id = actorIdentityFromHeaders({
    forwardedFor: null,
    realIp: null,
    cfConnectingIp: null,
    userAgent: null,
  });
  assert.equal(id, 'unknown-ip:unknown-agent');
});

// ============================================================
// fingerprintPublicActionActor — per-action scoping
// ============================================================

test('same identity across different actions → different fingerprints', () => {
  const a = fingerprintPublicActionActor(
    'ip:1.2.3.4',
    'flight_request',
    'test-secret-32-bytes-long-aaaaaa'
  );
  const b = fingerprintPublicActionActor(
    'ip:1.2.3.4',
    'cargo_intake',
    'test-secret-32-bytes-long-aaaaaa'
  );
  assert.notEqual(a, b);
});

test('same identity + same action → stable fingerprint', () => {
  const a = fingerprintPublicActionActor(
    'ip:1.2.3.4',
    'flight_request',
    'test-secret-32-bytes-long-aaaaaa'
  );
  const b = fingerprintPublicActionActor(
    'ip:1.2.3.4',
    'flight_request',
    'test-secret-32-bytes-long-aaaaaa'
  );
  assert.equal(a, b);
});

test('different secret → different fingerprint (no secret leak via guess)', () => {
  const a = fingerprintPublicActionActor(
    'ip:1.2.3.4',
    'flight_request',
    'secret-a-32-bytes-long-aaaaaaaaa'
  );
  const b = fingerprintPublicActionActor(
    'ip:1.2.3.4',
    'flight_request',
    'secret-b-32-bytes-long-bbbbbbbbb'
  );
  assert.notEqual(a, b);
});

// ============================================================
// evaluatePublicActionRateLimit
// ============================================================

const FLIGHT_LIMITS = PUBLIC_ACTION_LIMITS.flight_request;
const CARGO_LIMITS = PUBLIC_ACTION_LIMITS.cargo_intake;

test('empty attempts → ok', () => {
  const v = evaluatePublicActionRateLimit([], FLIGHT_LIMITS, NOW);
  assert.equal(v.ok, true);
});

test('flight_request: under failure cap → ok', () => {
  const attempts = [
    { outcome: 'validation_failed' as const, attempted_at: minutesAgo(1) },
    { outcome: 'validation_failed' as const, attempted_at: minutesAgo(2) },
  ];
  const v = evaluatePublicActionRateLimit(attempts, FLIGHT_LIMITS, NOW);
  assert.equal(v.ok, true);
});

test('flight_request: hit failure cap (5 in 15min) → too_many_failures', () => {
  const attempts = Array.from({ length: 5 }, (_, i) => ({
    outcome: 'validation_failed' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluatePublicActionRateLimit(attempts, FLIGHT_LIMITS, NOW);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.reason, 'too_many_failures');
    assert.ok(v.retryAfterSeconds > 0);
  }
});

test('cargo_intake: lower failure cap (3) trips faster', () => {
  const attempts = Array.from({ length: 3 }, (_, i) => ({
    outcome: 'validation_failed' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluatePublicActionRateLimit(attempts, CARGO_LIMITS, NOW);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'too_many_failures');
});

test('flight_request: 4 failures → still ok (cap = 5)', () => {
  const attempts = Array.from({ length: 4 }, (_, i) => ({
    outcome: 'validation_failed' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluatePublicActionRateLimit(attempts, FLIGHT_LIMITS, NOW);
  assert.equal(v.ok, true);
});

test('hit attempt cap (20 mixed) → too_many_attempts', () => {
  const attempts = Array.from({ length: 20 }, (_, i) => ({
    outcome: i % 2 === 0 ? ('success' as const) : ('validation_failed' as const),
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluatePublicActionRateLimit(attempts, FLIGHT_LIMITS, NOW);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'too_many_attempts');
});

test('old failures (outside failureWindow) → ignored', () => {
  // 5 failures all > 15min ago shouldn't trip the failure cap.
  const attempts = Array.from({ length: 5 }, (_, i) => ({
    outcome: 'validation_failed' as const,
    attempted_at: minutesAgo(20 + i),
  }));
  const v = evaluatePublicActionRateLimit(attempts, FLIGHT_LIMITS, NOW);
  assert.equal(v.ok, true);
});

test('success-only attempts NEVER trip the failure cap', () => {
  const attempts = Array.from({ length: 10 }, (_, i) => ({
    outcome: 'success' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluatePublicActionRateLimit(attempts, FLIGHT_LIMITS, NOW);
  assert.equal(v.ok, true);
});

test('honeypot counts as failure (NOT success)', () => {
  const attempts = Array.from({ length: 5 }, (_, i) => ({
    outcome: 'honeypot' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluatePublicActionRateLimit(attempts, FLIGHT_LIMITS, NOW);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'too_many_failures');
});

test('rate_limited rows count as failure (extends lockout)', () => {
  const attempts = Array.from({ length: 5 }, (_, i) => ({
    outcome: 'rate_limited' as const,
    attempted_at: minutesAgo(i + 1),
  }));
  const v = evaluatePublicActionRateLimit(attempts, FLIGHT_LIMITS, NOW);
  assert.equal(v.ok, false);
});

test('malformed timestamp rows are dropped silently', () => {
  const attempts = [
    { outcome: 'validation_failed' as const, attempted_at: 'not-an-iso' },
    { outcome: 'validation_failed' as const, attempted_at: minutesAgo(1) },
  ];
  const v = evaluatePublicActionRateLimit(attempts, FLIGHT_LIMITS, NOW);
  // Only 1 valid failure → still ok
  assert.equal(v.ok, true);
});

test('future timestamps are dropped (defense against clock skew)', () => {
  const attempts = Array.from({ length: 5 }, () => ({
    outcome: 'validation_failed' as const,
    attempted_at: new Date(NOW.getTime() + 60_000).toISOString(),
  }));
  const v = evaluatePublicActionRateLimit(attempts, FLIGHT_LIMITS, NOW);
  assert.equal(v.ok, true);
});

// ============================================================
// Limit configuration sanity
// ============================================================

test('all four actions have a config', () => {
  assert.ok(PUBLIC_ACTION_LIMITS.flight_request);
  assert.ok(PUBLIC_ACTION_LIMITS.empty_leg_reserve);
  assert.ok(PUBLIC_ACTION_LIMITS.cargo_intake);
  assert.ok(PUBLIC_ACTION_LIMITS.medevac_intake);
});

test('failure caps are reasonable (≥3, ≤10)', () => {
  for (const [action, cfg] of Object.entries(PUBLIC_ACTION_LIMITS)) {
    assert.ok(
      cfg.maxFailures >= 3 && cfg.maxFailures <= 10,
      `${action} maxFailures=${cfg.maxFailures} outside [3,10]`
    );
  }
});

test('attempt caps are reasonable (≥10, ≤50)', () => {
  for (const [action, cfg] of Object.entries(PUBLIC_ACTION_LIMITS)) {
    assert.ok(
      cfg.maxAttempts >= 10 && cfg.maxAttempts <= 50,
      `${action} maxAttempts=${cfg.maxAttempts} outside [10,50]`
    );
  }
});

test('failureWindow < attemptWindow for every action', () => {
  for (const [action, cfg] of Object.entries(PUBLIC_ACTION_LIMITS)) {
    assert.ok(
      cfg.failureWindowMs < cfg.attemptWindowMs,
      `${action} failureWindow >= attemptWindow`
    );
  }
});

// ============================================================
// Wrap up
// ============================================================

// eslint-disable-next-line no-console
console.log(
  `\n[public-action-rate-limit] ${passed} passed, ${failed} failed\n`
);
if (failed > 0) process.exit(1);
