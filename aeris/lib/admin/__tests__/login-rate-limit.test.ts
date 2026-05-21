import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_LOGIN_RATE_LIMIT,
  actorIdentityFromHeaders,
  evaluateAdminLoginRateLimit,
  fingerprintAdminLoginActor,
  firstForwardedIp,
  type AdminLoginAttemptRow,
} from '@/lib/admin/login-rate-limit-core';

const NOW = new Date('2026-05-21T12:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

function failures(count: number, minutes: number): AdminLoginAttemptRow[] {
  return Array.from({ length: count }, (_, index) => ({
    outcome: 'invalid_password',
    attempted_at: minutesAgo(minutes + index),
  }));
}

test('firstForwardedIp returns only the closest forwarded address', () => {
  assert.equal(firstForwardedIp('203.0.113.10, 10.0.0.1'), '203.0.113.10');
  assert.equal(firstForwardedIp('  '), null);
  assert.equal(firstForwardedIp(null), null);
});

test('actorIdentityFromHeaders prefers forwarded IP over fallback headers', () => {
  assert.equal(
    actorIdentityFromHeaders({
      forwardedFor: '203.0.113.10, 10.0.0.1',
      realIp: '198.51.100.2',
      cfConnectingIp: '198.51.100.3',
      userAgent: 'Mozilla',
    }),
    'ip:203.0.113.10'
  );
});

test('fingerprintAdminLoginActor produces stable HMAC without exposing actor', () => {
  const a = fingerprintAdminLoginActor('ip:203.0.113.10', 'secret-a');
  const b = fingerprintAdminLoginActor(' IP:203.0.113.10 ', 'secret-a');
  const c = fingerprintAdminLoginActor('ip:203.0.113.10', 'secret-b');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
  assert(!a.includes('203.0.113.10'));
});

test('evaluateAdminLoginRateLimit allows fewer than maxFailures', () => {
  const verdict = evaluateAdminLoginRateLimit(
    failures(ADMIN_LOGIN_RATE_LIMIT.maxFailures - 1, 1),
    NOW
  );
  assert.deepEqual(verdict, { ok: true });
});

test('evaluateAdminLoginRateLimit blocks at maxFailures', () => {
  const verdict = evaluateAdminLoginRateLimit(
    failures(ADMIN_LOGIN_RATE_LIMIT.maxFailures, 1),
    NOW
  );
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.reason, 'too_many_failures');
    assert(verdict.retryAfterSeconds > 0);
    assert(verdict.retryAfterSeconds <= 15 * 60);
  }
});

test('evaluateAdminLoginRateLimit ignores old failures', () => {
  const verdict = evaluateAdminLoginRateLimit(
    failures(ADMIN_LOGIN_RATE_LIMIT.maxFailures, 16),
    NOW
  );
  assert.deepEqual(verdict, { ok: true });
});

test('evaluateAdminLoginRateLimit enforces hourly attempt cap', () => {
  const attempts: AdminLoginAttemptRow[] = Array.from(
    { length: ADMIN_LOGIN_RATE_LIMIT.maxAttempts },
    (_, index) => ({
      outcome: index % 2 === 0 ? 'success' : 'invalid_input',
      attempted_at: minutesAgo(index + 1),
    })
  );

  const verdict = evaluateAdminLoginRateLimit(attempts, NOW);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.reason, 'too_many_attempts');
  }
});
