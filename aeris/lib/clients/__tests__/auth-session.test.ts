/**
 * Phase 9 PR 1 — unit tests for the client session token
 * mint/hash primitives.
 *
 * Layer-1 (no DB, no cookies — Next.js cookies API is not
 * imported in this test). Runs as
 *   npm run test:clients-auth-session
 *
 * Cases covered:
 *   1. mint produces 64-char lowercase hex raw token
 *   2. mint produces sha256-hex token_hash
 *   3. hashSessionToken roundtrip matches mint output
 *   4. remember_me=true produces 30-day expiry
 *   5. remember_me=false produces 7-day expiry
 *   6. two consecutive mints produce distinct tokens
 */

import { strict as assert } from 'node:assert';

import {
  mintClientSessionToken,
  hashSessionToken,
} from '@/lib/clients/session-token';

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

test('mint produces 64-char lowercase hex raw token', () => {
  const minted = mintClientSessionToken(false);
  assert.match(minted.raw_token, /^[0-9a-f]{64}$/);
});

test('mint produces sha256-hex token_hash', () => {
  const minted = mintClientSessionToken(false);
  assert.match(minted.token_hash, /^[0-9a-f]{64}$/);
});

test('hashSessionToken roundtrip matches mint output', () => {
  const minted = mintClientSessionToken(false);
  assert.equal(hashSessionToken(minted.raw_token), minted.token_hash);
});

test('remember_me=true produces ~30-day expiry', () => {
  const minted = mintClientSessionToken(true);
  const expectedMs = 30 * 24 * 60 * 60 * 1000;
  const actualMs = minted.expires_at.getTime() - Date.now();
  assert.ok(
    Math.abs(actualMs - expectedMs) < 5000,
    `expected ~30d, got ${actualMs}ms`
  );
  assert.equal(minted.remember_me, true);
});

test('remember_me=false produces ~7-day expiry', () => {
  const minted = mintClientSessionToken(false);
  const expectedMs = 7 * 24 * 60 * 60 * 1000;
  const actualMs = minted.expires_at.getTime() - Date.now();
  assert.ok(
    Math.abs(actualMs - expectedMs) < 5000,
    `expected ~7d, got ${actualMs}ms`
  );
  assert.equal(minted.remember_me, false);
});

test('two consecutive mints produce distinct tokens', () => {
  const a = mintClientSessionToken(false);
  const b = mintClientSessionToken(false);
  assert.notEqual(a.raw_token, b.raw_token);
  assert.notEqual(a.token_hash, b.token_hash);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
