import assert from 'node:assert/strict';

import {
  PUBLIC_ACTION_LIMITS,
  evaluatePublicActionRateLimit,
  type PublicActionAttemptRow,
} from '../public-action-core';

/**
 * SEC-02 — client + operator login are registered in the shared
 * public-action limiter with strict caps, and an authenticated brute
 * force is locked out after maxFailures within the failure window.
 */

for (const action of ['client_login', 'operator_login'] as const) {
  const cfg = PUBLIC_ACTION_LIMITS[action];
  assert.ok(cfg, `${action} must have a rate-limit config`);
  assert.equal(cfg.maxFailures, 5, `${action} failure cap = 5`);
  assert.equal(cfg.maxAttempts, 10, `${action} attempt cap = 10`);
}

assert.ok(
  PUBLIC_ACTION_LIMITS.client_authed_mutation,
  'client_authed_mutation must have a rate-limit config'
);
assert.equal(
  PUBLIC_ACTION_LIMITS.client_authed_mutation.maxAttempts,
  40,
  'client_authed_mutation attempt cap = 40'
);

const now = new Date('2026-06-02T12:00:00Z');

// 5 auth failures inside the failure window -> locked.
const fiveFailures: PublicActionAttemptRow[] = Array.from(
  { length: 5 },
  (_, i) => ({
    outcome: 'auth_failed',
    attempted_at: new Date(now.getTime() - i * 1000).toISOString(),
  })
);
const locked = evaluatePublicActionRateLimit(
  fiveFailures,
  PUBLIC_ACTION_LIMITS.client_login,
  now
);
assert.equal(locked.ok, false, 'locks after 5 auth failures');
if (!locked.ok) assert.equal(locked.reason, 'too_many_failures');

// 4 failures is still allowed.
const allowed = evaluatePublicActionRateLimit(
  fiveFailures.slice(0, 4),
  PUBLIC_ACTION_LIMITS.operator_login,
  now
);
assert.equal(allowed.ok, true, '4 failures still allowed');

console.log('login-rate-limit.test: all assertions passed');
