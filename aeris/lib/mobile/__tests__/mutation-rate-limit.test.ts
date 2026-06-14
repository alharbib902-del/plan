/**
 * Phase 0 (mobile API) — unit tests for the mobile mutation
 * rate-limit core (bucket / identity / outcome / status mapping).
 *
 * Layer-1 (no DB). Runs as `npm run test:mobile-mutation-rate-limit`.
 *
 * Closes the Codex P3 follow-up on PR #149. Pins that every mutation
 * route (reserve / release / alerts) goes through the per-TOKEN
 * `client_authed_mutation` limiter path and that a throttle verdict
 * maps to a 429 (infra faults to 503):
 *   - the action bucket is `client_authed_mutation` and is configured,
 *   - the limiter is keyed on the session token hash, NOT the IP,
 *   - a check-phase denial → the right wire code + recorded outcome,
 *   - a core/route failure → the right recorded outcome.
 */

import { strict as assert } from 'node:assert';

import {
  PUBLIC_ACTION_LIMITS,
  fingerprintPublicActionActor,
} from '@/lib/rate-limit/public-action-core';
import { statusForError } from '@/lib/mobile/http';
import {
  MOBILE_MUTATION_ACTION,
  mobileMutationActorIdentity,
  mobileRateLimitDenialCode,
  mobileRateLimitDenialOutcome,
  mutationOutcomeForError,
} from '@/lib/mobile/mutation-rate-limit-core';

const SECRET = 'test-secret-32-bytes-long-aaaaaa';

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

// ============================================================
// the per-token mutation bucket
// ============================================================

test('mutations share the client_authed_mutation bucket, and it is configured', () => {
  assert.equal(MOBILE_MUTATION_ACTION, 'client_authed_mutation');
  assert.ok(
    PUBLIC_ACTION_LIMITS[MOBILE_MUTATION_ACTION],
    'client_authed_mutation must have a rate-limit config'
  );
});

test('identity is keyed on the token hash, not the IP', () => {
  assert.equal(mobileMutationActorIdentity('HASH123'), 'token_hash:HASH123');
  assert.ok(
    !mobileMutationActorIdentity('HASH123').startsWith('ip:'),
    'must not be IP-scoped'
  );
});

test('two clients hash to distinct limiter fingerprints (no cross-throttle)', () => {
  const a = fingerprintPublicActionActor(
    mobileMutationActorIdentity('hash-A'),
    MOBILE_MUTATION_ACTION,
    SECRET
  );
  const b = fingerprintPublicActionActor(
    mobileMutationActorIdentity('hash-B'),
    MOBILE_MUTATION_ACTION,
    SECRET
  );
  assert.notEqual(a, b);
});

test('a token identity fingerprints apart from an IP identity in the same bucket', () => {
  const tokenFp = fingerprintPublicActionActor(
    mobileMutationActorIdentity('hash-A'),
    MOBILE_MUTATION_ACTION,
    SECRET
  );
  const ipFp = fingerprintPublicActionActor(
    'ip:1.2.3.4',
    MOBILE_MUTATION_ACTION,
    SECRET
  );
  assert.notEqual(tokenFp, ipFp);
});

// ============================================================
// check-phase denial → wire code + status (req 4: "429 maps")
// ============================================================

test('a throttle verdict → rate_limited code → HTTP 429', () => {
  for (const reason of ['too_many_attempts', 'too_many_failures']) {
    const code = mobileRateLimitDenialCode(reason);
    assert.equal(code, 'rate_limited');
    assert.equal(statusForError(code), 429);
  }
});

test('an infra fault → its own code → HTTP 503 (not a 429)', () => {
  for (const reason of ['secret_missing', 'storage_error']) {
    const code = mobileRateLimitDenialCode(reason);
    assert.equal(code, reason);
    assert.equal(statusForError(code), 503);
  }
});

// ============================================================
// recorded attempt outcomes
// ============================================================

test('denial outcome: throttle → rate_limited, infra → rpc_error', () => {
  assert.equal(mobileRateLimitDenialOutcome('too_many_attempts'), 'rate_limited');
  assert.equal(mobileRateLimitDenialOutcome('too_many_failures'), 'rate_limited');
  assert.equal(mobileRateLimitDenialOutcome('secret_missing'), 'rpc_error');
  assert.equal(mobileRateLimitDenialOutcome('storage_error'), 'rpc_error');
});

test('mutationOutcomeForError: validation noise → validation_failed', () => {
  assert.equal(mutationOutcomeForError('validation_failed'), 'validation_failed');
  assert.equal(mutationOutcomeForError('malformed_body'), 'validation_failed');
});

test('mutationOutcomeForError: dependency faults → rpc_error', () => {
  for (const code of ['rpc_failed', 'rpc_error', 'storage_error', 'secret_missing']) {
    assert.equal(mutationOutcomeForError(code), 'rpc_error');
  }
});

test('mutationOutcomeForError: a state conflict defaults to validation_failed', () => {
  // A business-rule conflict (e.g. leg already reserved) is the
  // caller's problem, not a dependency fault — it counts as a
  // validation-class attempt, not rpc_error.
  assert.equal(mutationOutcomeForError('leg_already_reserved'), 'validation_failed');
  assert.equal(mutationOutcomeForError('cancel_not_allowed'), 'validation_failed');
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
