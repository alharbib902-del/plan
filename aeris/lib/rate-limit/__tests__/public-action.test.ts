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
  PUBLIC_ACTION_BUCKETS,
  PUBLIC_ACTION_LIMITS,
  actorIdentityFromHeaders,
  bucketActorIdentity,
  emailActorIdentity,
  evaluatePublicActionRateLimit,
  fingerprintPublicActionActor,
  firstForwardedIp,
  lastForwardedIp,
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
// firstForwardedIp / lastForwardedIp
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

test('lastForwardedIp picks the rightmost (platform-appended) hop', () => {
  assert.equal(lastForwardedIp('1.2.3.4, 5.6.7.8'), '5.6.7.8');
  assert.equal(lastForwardedIp('1.2.3.4, 5.6.7.8, 9.9.9.9'), '9.9.9.9');
  assert.equal(lastForwardedIp('  9.9.9.9 '), '9.9.9.9');
});

test('lastForwardedIp returns null for empty or null', () => {
  assert.equal(lastForwardedIp(null), null);
  assert.equal(lastForwardedIp(''), null);
  assert.equal(lastForwardedIp('   '), null);
});

// ============================================================
// actorIdentityFromHeaders — IP-spoofing-resistant precedence
// ============================================================

test('prefers x-vercel-forwarded-for (platform-trusted client IP)', () => {
  const id = actorIdentityFromHeaders({
    vercelForwardedFor: '203.0.113.7',
    forwardedFor: '1.2.3.4, 5.6.7.8',
    realIp: '9.9.9.9',
    cfConnectingIp: '8.8.8.8',
    userAgent: 'Mozilla',
  });
  assert.equal(id, 'ip:203.0.113.7');
});

test('falls back to realIp when vercel header missing', () => {
  const id = actorIdentityFromHeaders({
    forwardedFor: '1.2.3.4, 5.6.7.8',
    realIp: '9.9.9.9',
    cfConnectingIp: '8.8.8.8',
    userAgent: 'Mozilla',
  });
  assert.equal(id, 'ip:9.9.9.9');
});

test('falls back to cfConnectingIp before raw XFF', () => {
  const id = actorIdentityFromHeaders({
    forwardedFor: '1.2.3.4, 5.6.7.8',
    realIp: null,
    cfConnectingIp: '8.8.8.8',
    userAgent: 'Mozilla',
  });
  assert.equal(id, 'ip:8.8.8.8');
});

test('raw XFF uses RIGHTMOST hop — a spoofed leftmost token is ignored', () => {
  // Attacker injects "X-Forwarded-For: 1.1.1.1" hoping to key the
  // limiter on a victim IP; Vercel appends the real client IP last,
  // so we must bucket on the rightmost hop, not the leftmost.
  const id = actorIdentityFromHeaders({
    forwardedFor: '1.1.1.1, 203.0.113.55',
    realIp: null,
    cfConnectingIp: null,
    userAgent: 'Mozilla',
  });
  assert.equal(id, 'ip:203.0.113.55');
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

test('token-derived identity fingerprints independently from IP identities', () => {
  const tokenScoped = fingerprintPublicActionActor(
    'token_hash:abc123',
    'client_authed_mutation',
    'test-secret-32-bytes-long-aaaaaa'
  );
  const ipScoped = fingerprintPublicActionActor(
    'ip:1.2.3.4',
    'client_authed_mutation',
    'test-secret-32-bytes-long-aaaaaa'
  );
  assert.notEqual(tokenScoped, ipScoped);
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

test('all public, login, and mobile mutation actions have a config', () => {
  assert.ok(PUBLIC_ACTION_LIMITS.flight_request);
  assert.ok(PUBLIC_ACTION_LIMITS.empty_leg_reserve);
  assert.ok(PUBLIC_ACTION_LIMITS.cargo_intake);
  assert.ok(PUBLIC_ACTION_LIMITS.medevac_intake);
  assert.ok(PUBLIC_ACTION_LIMITS.client_login);
  assert.ok(PUBLIC_ACTION_LIMITS.operator_login);
  assert.ok(PUBLIC_ACTION_LIMITS.client_authed_mutation);
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
// Sub-buckets (signup / password reset / OTP verify)
// ============================================================

// The DB CHECK constraint on public_action_attempts.action (migration
// 20260614000001) — buckets must store under one of these.
const DB_ALLOWED_ACTIONS = new Set([
  'flight_request',
  'empty_leg_reserve',
  'cargo_intake',
  'medevac_intake',
  'client_login',
  'operator_login',
  'client_authed_mutation',
]);

test('every bucket stores under a DB-allowed parent action (no migration)', () => {
  for (const [bucket, cfg] of Object.entries(PUBLIC_ACTION_BUCKETS)) {
    assert.ok(
      DB_ALLOWED_ACTIONS.has(cfg.action),
      `${bucket} → ${cfg.action} is not allowed by the CHECK constraint`
    );
  }
});

test('bucket fingerprints never collide with the parent action bucket', () => {
  const secret = 'test-secret-at-least-16-chars';
  const ip = 'ip:203.0.113.7';
  const loginFp = fingerprintPublicActionActor(ip, 'client_login', secret);
  const signupFp = fingerprintPublicActionActor(
    bucketActorIdentity('client_signup', ip),
    'client_login',
    secret
  );
  const resetFp = fingerprintPublicActionActor(
    bucketActorIdentity('client_password_reset', ip),
    'client_login',
    secret
  );
  assert.notEqual(signupFp, loginFp);
  assert.notEqual(resetFp, loginFp);
  assert.notEqual(signupFp, resetFp);
});

test('email identity is case/space-insensitive and distinct from IP identity', () => {
  assert.equal(
    emailActorIdentity('  Foo@Example.COM '),
    emailActorIdentity('foo@example.com')
  );
  assert.notEqual(emailActorIdentity('1.2.3.4'), 'ip:1.2.3.4');
});

test('per-email reset buckets allow 3/hour, then lock', () => {
  for (const bucket of [
    'client_password_reset_email',
    'operator_password_reset_email',
  ] as const) {
    const limits = PUBLIC_ACTION_BUCKETS[bucket].limits;
    const two = [5, 10].map((m) => ({
      outcome: 'success' as const,
      attempted_at: minutesAgo(m),
    }));
    assert.deepEqual(evaluatePublicActionRateLimit(two, limits, NOW), {
      ok: true,
    });
    const three = [...two, { outcome: 'success' as const, attempted_at: minutesAgo(1) }];
    const verdict = evaluatePublicActionRateLimit(three, limits, NOW);
    assert.equal(verdict.ok, false, bucket);
  }
});

test('signup bucket locks after 5 rejected signups in 15 min', () => {
  const limits = PUBLIC_ACTION_BUCKETS.client_signup.limits;
  const rejected = [1, 2, 3, 4, 5].map((m) => ({
    outcome: 'validation_failed' as const,
    attempted_at: minutesAgo(m),
  }));
  const verdict = evaluatePublicActionRateLimit(rejected, limits, NOW);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.reason, 'too_many_failures');
});

test('bucket limits are sane (failureWindow ≤ attemptWindow, caps ≥ 3)', () => {
  for (const [bucket, { limits }] of Object.entries(PUBLIC_ACTION_BUCKETS)) {
    assert.ok(
      limits.failureWindowMs <= limits.attemptWindowMs,
      `${bucket} failureWindow > attemptWindow`
    );
    assert.ok(limits.maxAttempts >= 3, `${bucket} maxAttempts < 3`);
    assert.ok(limits.maxFailures >= 3, `${bucket} maxFailures < 3`);
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
