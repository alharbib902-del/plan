/**
 * Phase 9 PR 1 — unit tests for the client password-reset
 * HMAC token module.
 *
 * Layer-1 (no DB), runs as
 *   npm run test:clients-password-reset-token
 *
 * Cases covered:
 *   1. mint → verify roundtrip succeeds
 *   2. token_hash is sha256-hex (64-char lowercase)
 *   3. expired token rejected
 *   4. tampered payload rejected
 *   5. tampered signature rejected
 *   6. malformed (no dot) rejected
 *   7. wrong-secret token rejected
 *   8. missing-env mint throws
 *   9. missing-env verify returns env_missing
 *  10. unsupported version rejected
 */

import { strict as assert } from 'node:assert';

const SECRET_ENV = 'CLIENT_PASSWORD_RESET_TOKEN_SECRET';
const TEST_SECRET = 'test-client-reset-secret-do-not-use-in-prod-XYZ';
process.env[SECRET_ENV] = TEST_SECRET;

import {
  mintClientPasswordResetToken,
  verifyClientPasswordResetToken,
  ClientPasswordResetTokenEnvError,
} from '@/lib/clients/password-reset-token';

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

const FAKE_CLIENT_ID = '00000000-0000-0000-0000-000000000001';

// 1. mint → verify roundtrip
test('mint → verify roundtrip succeeds', () => {
  const minted = mintClientPasswordResetToken({ client_id: FAKE_CLIENT_ID });
  const verified = verifyClientPasswordResetToken(minted.raw_token);
  assert.equal(verified.valid, true);
  if (verified.valid) {
    assert.equal(verified.payload.client_id, FAKE_CLIENT_ID);
    assert.equal(verified.token_hash, minted.token_hash);
  }
});

// 2. sha256-hex shape
test('token_hash is sha256-hex (64-char lowercase)', () => {
  const minted = mintClientPasswordResetToken({ client_id: FAKE_CLIENT_ID });
  assert.match(minted.token_hash, /^[0-9a-f]{64}$/);
});

// 3. expired token
test('expired token rejected', () => {
  const minted = mintClientPasswordResetToken({
    client_id: FAKE_CLIENT_ID,
    ttl_seconds: -10, // already expired
  });
  const verified = verifyClientPasswordResetToken(minted.raw_token);
  assert.equal(verified.valid, false);
  if (!verified.valid) assert.equal(verified.reason, 'expired');
});

// 4. tampered payload
test('tampered payload rejected', () => {
  const minted = mintClientPasswordResetToken({ client_id: FAKE_CLIENT_ID });
  const [, sig] = minted.raw_token.split('.');
  const tampered = `eyJtb2RpZmllZCI6dHJ1ZX0.${sig}`;
  const verified = verifyClientPasswordResetToken(tampered);
  assert.equal(verified.valid, false);
});

// 5. tampered signature
test('tampered signature rejected', () => {
  const minted = mintClientPasswordResetToken({ client_id: FAKE_CLIENT_ID });
  const [payload] = minted.raw_token.split('.');
  const tampered = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  const verified = verifyClientPasswordResetToken(tampered);
  assert.equal(verified.valid, false);
});

// 6. malformed (no dot)
test('malformed (no dot) rejected', () => {
  const verified = verifyClientPasswordResetToken('not-a-token');
  assert.equal(verified.valid, false);
  if (!verified.valid) assert.equal(verified.reason, 'malformed');
});

// 7. wrong-secret token rejected
test('wrong-secret token rejected', () => {
  const minted = mintClientPasswordResetToken({ client_id: FAKE_CLIENT_ID });
  // Swap secret, then verify
  const original = process.env[SECRET_ENV];
  process.env[SECRET_ENV] = 'different-secret-value-XYZ-321';
  const verified = verifyClientPasswordResetToken(minted.raw_token);
  process.env[SECRET_ENV] = original;
  assert.equal(verified.valid, false);
  if (!verified.valid) assert.equal(verified.reason, 'signature_mismatch');
});

// 8. missing-env mint throws
test('missing-env mint throws ClientPasswordResetTokenEnvError', () => {
  const original = process.env[SECRET_ENV];
  delete process.env[SECRET_ENV];
  let thrown: unknown = null;
  try {
    mintClientPasswordResetToken({ client_id: FAKE_CLIENT_ID });
  } catch (err) {
    thrown = err;
  }
  process.env[SECRET_ENV] = original;
  assert.ok(thrown instanceof ClientPasswordResetTokenEnvError);
});

// 9. missing-env verify returns env_missing
test('missing-env verify returns env_missing', () => {
  const original = process.env[SECRET_ENV];
  delete process.env[SECRET_ENV];
  const verified = verifyClientPasswordResetToken('anything.anything');
  process.env[SECRET_ENV] = original;
  assert.equal(verified.valid, false);
  if (!verified.valid) assert.equal(verified.reason, 'env_missing');
});

// 10. unsupported version
test('unsupported version rejected', () => {
  // Forge a v=99 payload + sign with current secret to ensure
  // ONLY the version check fires, not signature_mismatch.
  const { createHmac } = require('crypto') as typeof import('crypto');
  const payload = JSON.stringify({
    v: 99,
    client_id: FAKE_CLIENT_ID,
    issued_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 60,
    nonce: 'abc',
  });
  const b64 = (s: string) =>
    Buffer.from(s, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const payloadEnc = b64(payload);
  const sig = createHmac('sha256', TEST_SECRET)
    .update(payloadEnc)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const verified = verifyClientPasswordResetToken(`${payloadEnc}.${sig}`);
  assert.equal(verified.valid, false);
  if (!verified.valid) assert.equal(verified.reason, 'unsupported_version');
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
