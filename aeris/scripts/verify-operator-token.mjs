#!/usr/bin/env node
//
// Aeris — operator-token algorithm verification
//
// Algorithm-level verification of `lib/operator/token.ts`. The script
// inlines the same HMAC + base64url + payload format used by the lib
// and exercises the contract end-to-end:
//
//   1. v=1 issue + verify round-trip (Phase 4 path).
//   2. v=2 issue + verify round-trip (Phase 5 path).
//   3. v=2 byte-identical rebuild — `issueOperatorTokenFromTarget`
//      reproduces the exact same token as `issueOperatorTokenV2`
//      called with the same inputs. (Spec acceptance #14a / #34a /
//      iteration-3 P1 fix.)
//   4. v=2 determinism — issuing twice with the same inputs produces
//      the same token. (Necessary for refresh durability.)
//   5. Tampered token rejected (signature flip).
//   6. Expired token rejected (expires_at in the past).
//   7. Unknown payload version rejected (v=99).
//   8. Missing required v=1 / v=2 field rejected.
//   9. v=2 token NEVER decodes as v=1 (and vice versa) — the
//      version branch is strict, no fallback after signature
//      verification. (Spec iteration-2 P2 fix.)
//
// Why a separate `.mjs` script and not a unit test:
// - The project does not yet have a test framework installed.
// - The existing `scripts/` directory already houses helper scripts
//   (`generate-pwa-icons.mjs`, `preflight.ps1`).
// - A single self-contained Node script can be invoked from CI or
//   locally with: `node aeris/scripts/verify-operator-token.mjs`
//   without adding a dependency.
//
// Drift discipline:
// - This script is an INDEPENDENT implementation of the same wire
//   format described by `lib/operator/token.ts`. If either side
//   changes, the other must be updated to match. Codex review
//   confirms both implementations stay in agreement against the
//   spec at `docs/CLAUDE-TASK.md`.
// - The script seeds its own `OPERATOR_TOKEN_SECRET` (a 32-hex
//   constant) so it does NOT read or require the real production
//   secret. Tokens it produces are not valid against any deployed
//   environment.
//
// Exit codes:
//   0 — all checks PASS.
//   1 — any check FAIL.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Test-only secret (deliberately constant for determinism).
// ---------------------------------------------------------------------------
const TEST_SECRET =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// ---------------------------------------------------------------------------
// Algorithm — must match `lib/operator/token.ts`.
// ---------------------------------------------------------------------------

function base64urlEncode(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecodeToBuffer(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(normalized + '='.repeat(pad), 'base64');
}

function sign(payload, secret) {
  return base64urlEncode(createHmac('sha256', secret).update(payload).digest());
}

function buildToken(payload, secret) {
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function issueV1({ tripRequestId, ttlSeconds = 72 * 60 * 60, secret }) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    trip_request_id: tripRequestId,
    issued_at: issuedAt,
    expires_at: issuedAt + ttlSeconds,
    nonce: randomBytes(16).toString('hex'),
  };
  return { token: buildToken(payload, secret), payload };
}

function issueV2({ tripRequestId, targetId, nonce, sentAt, expiresAt, secret }) {
  const payload = {
    v: 2,
    trip_request_id: tripRequestId,
    dispatch_target_id: targetId,
    issued_at: Math.floor(sentAt.getTime() / 1000),
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    nonce,
  };
  return { token: buildToken(payload, secret), payload };
}

function issueV2FromTarget(target, secret) {
  return issueV2({
    tripRequestId: target.trip_request_id,
    targetId: target.id,
    nonce: target.nonce,
    sentAt: new Date(target.sent_at),
    expiresAt: new Date(target.expires_at),
    secret,
  });
}

function verify(rawToken, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!rawToken) return { valid: false };
  const parts = rawToken.split('.');
  if (parts.length !== 2) return { valid: false };
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return { valid: false };

  const expectedSig = sign(encodedPayload, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return { valid: false };
  if (!timingSafeEqual(a, b)) return { valid: false };

  let parsed;
  try {
    parsed = JSON.parse(base64urlDecodeToBuffer(encodedPayload).toString('utf8'));
  } catch {
    return { valid: false };
  }
  if (typeof parsed !== 'object' || parsed === null) return { valid: false };

  if (parsed.v === 1) {
    if (
      typeof parsed.trip_request_id !== 'string' ||
      parsed.trip_request_id.length === 0 ||
      typeof parsed.issued_at !== 'number' ||
      !Number.isFinite(parsed.issued_at) ||
      typeof parsed.expires_at !== 'number' ||
      !Number.isFinite(parsed.expires_at) ||
      typeof parsed.nonce !== 'string' ||
      parsed.nonce.length === 0
    ) {
      return { valid: false };
    }
    if (parsed.expires_at <= nowSeconds) return { valid: false };
    return { valid: true, version: 1, payload: parsed };
  }

  if (parsed.v === 2) {
    if (
      typeof parsed.trip_request_id !== 'string' ||
      parsed.trip_request_id.length === 0 ||
      typeof parsed.dispatch_target_id !== 'string' ||
      parsed.dispatch_target_id.length === 0 ||
      typeof parsed.issued_at !== 'number' ||
      !Number.isFinite(parsed.issued_at) ||
      typeof parsed.expires_at !== 'number' ||
      !Number.isFinite(parsed.expires_at) ||
      typeof parsed.nonce !== 'string' ||
      parsed.nonce.length === 0
    ) {
      return { valid: false };
    }
    if (parsed.expires_at <= nowSeconds) return { valid: false };
    return { valid: true, version: 2, payload: parsed };
  }

  return { valid: false };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results = [];
function check(name, predicate, detail) {
  const ok = !!predicate;
  results.push({ name, ok, detail: detail ?? '' });
  const stamp = ok ? 'PASS' : 'FAIL';
  console.log(`  ${stamp}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
}

function section(title) {
  console.log(`\n• ${title}`);
}

console.log('Aeris operator-token verification\n');
console.log(`Test secret (deterministic): ${TEST_SECRET.slice(0, 8)}…${TEST_SECRET.slice(-4)}`);

// ---------------------------------------------------------------------------
// 1. v=1 round-trip
// ---------------------------------------------------------------------------
section('Check 1 — v=1 issue + verify round-trip');

const v1 = issueV1({
  tripRequestId: '11111111-1111-1111-1111-111111111111',
  secret: TEST_SECRET,
});

check(
  '1a. issueV1 returns token with two dot-separated parts',
  v1.token.split('.').length === 2,
  v1.token.slice(0, 24) + '…'
);
check('1b. payload.v is 1', v1.payload.v === 1);
check(
  '1c. payload.trip_request_id matches input',
  v1.payload.trip_request_id === '11111111-1111-1111-1111-111111111111'
);
check(
  '1d. payload.expires_at is issued_at + 72h',
  v1.payload.expires_at - v1.payload.issued_at === 72 * 60 * 60
);

const v1verified = verify(v1.token, TEST_SECRET);
check('1e. verify returns valid', v1verified.valid === true);
check(
  '1f. verify discriminator is version=1',
  v1verified.valid && v1verified.version === 1
);
check(
  '1g. verify payload trip_request_id matches issued',
  v1verified.valid &&
    v1verified.payload.trip_request_id === v1.payload.trip_request_id
);

// ---------------------------------------------------------------------------
// 2. v=2 round-trip
// ---------------------------------------------------------------------------
section('Check 2 — v=2 issue + verify round-trip');

const v2SentAt = new Date('2026-05-05T12:00:00.000Z');
const v2ExpiresAt = new Date('2026-05-08T12:00:00.000Z'); // +72h
const v2 = issueV2({
  tripRequestId: '22222222-2222-2222-2222-222222222222',
  targetId: '33333333-3333-3333-3333-333333333333',
  nonce: 'a3f2c14b8d7e9f0123456789abcdef01',
  sentAt: v2SentAt,
  expiresAt: v2ExpiresAt,
  secret: TEST_SECRET,
});

check(
  '2a. issueV2 returns token with two dot-separated parts',
  v2.token.split('.').length === 2
);
check('2b. payload.v is 2', v2.payload.v === 2);
check(
  '2c. payload.dispatch_target_id matches input',
  v2.payload.dispatch_target_id === '33333333-3333-3333-3333-333333333333'
);
check(
  '2d. payload.issued_at derived from sentAt',
  v2.payload.issued_at === Math.floor(v2SentAt.getTime() / 1000)
);
check(
  '2e. payload.expires_at derived from expiresAt',
  v2.payload.expires_at === Math.floor(v2ExpiresAt.getTime() / 1000)
);

// Verify against a "now" inside the validity window.
const v2VerifyNow =
  Math.floor(v2SentAt.getTime() / 1000) + 60 * 60; // 1h after sentAt
const v2verified = verify(v2.token, TEST_SECRET, v2VerifyNow);
check('2f. verify returns valid', v2verified.valid === true);
check(
  '2g. verify discriminator is version=2',
  v2verified.valid && v2verified.version === 2
);
check(
  '2h. verify payload preserves dispatch_target_id',
  v2verified.valid &&
    v2verified.payload.dispatch_target_id ===
      '33333333-3333-3333-3333-333333333333'
);

// ---------------------------------------------------------------------------
// 3. issueOperatorTokenFromTarget byte-identical rebuild
// ---------------------------------------------------------------------------
section('Check 3 — issueOperatorTokenFromTarget byte-identical rebuild');

const targetRow = {
  trip_request_id: '22222222-2222-2222-2222-222222222222',
  id: '33333333-3333-3333-3333-333333333333',
  nonce: 'a3f2c14b8d7e9f0123456789abcdef01',
  sent_at: v2SentAt.toISOString(),
  expires_at: v2ExpiresAt.toISOString(),
};
const v2Rebuilt = issueV2FromTarget(targetRow, TEST_SECRET);

check(
  '3a. rebuilt token equals original token byte-for-byte',
  v2Rebuilt.token === v2.token,
  v2Rebuilt.token === v2.token
    ? 'identical'
    : `original=${v2.token.slice(-8)} rebuilt=${v2Rebuilt.token.slice(-8)}`
);
check(
  '3b. rebuilt payload.issued_at equals original',
  v2Rebuilt.payload.issued_at === v2.payload.issued_at
);
check(
  '3c. rebuilt payload.expires_at equals original',
  v2Rebuilt.payload.expires_at === v2.payload.expires_at
);
check(
  '3d. rebuild does NOT read Date.now() — calling twice ms apart yields same token',
  (() => {
    const a = issueV2FromTarget(targetRow, TEST_SECRET).token;
    const b = issueV2FromTarget(targetRow, TEST_SECRET).token;
    return a === b;
  })()
);

// ---------------------------------------------------------------------------
// 4. v=2 determinism (same inputs → same token)
// ---------------------------------------------------------------------------
section('Check 4 — v=2 determinism');

const det1 = issueV2({
  tripRequestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  targetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  nonce: 'deadbeefcafebabe0011223344556677',
  sentAt: new Date('2026-06-01T08:00:00.000Z'),
  expiresAt: new Date('2026-06-04T08:00:00.000Z'),
  secret: TEST_SECRET,
});
const det2 = issueV2({
  tripRequestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  targetId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  nonce: 'deadbeefcafebabe0011223344556677',
  sentAt: new Date('2026-06-01T08:00:00.000Z'),
  expiresAt: new Date('2026-06-04T08:00:00.000Z'),
  secret: TEST_SECRET,
});
check('4a. two issues with identical inputs produce identical tokens', det1.token === det2.token);

// ---------------------------------------------------------------------------
// 5. Tampered token rejected
// ---------------------------------------------------------------------------
section('Check 5 — Tampered token rejected');

// Flip the LAST character of the signature (index = length-1).
const lastChar = v2.token.charAt(v2.token.length - 1);
const flippedChar = lastChar === 'a' ? 'b' : 'a';
const tampered = v2.token.slice(0, -1) + flippedChar;
const tamperedResult = verify(tampered, TEST_SECRET);
check('5a. flipped-signature token returns invalid', tamperedResult.valid === false);

// Flip the LAST character of the payload (index of last char in payload half).
const dotIdx = v2.token.indexOf('.');
const payloadHalf = v2.token.slice(0, dotIdx);
const sigHalf = v2.token.slice(dotIdx);
const lastPayloadChar = payloadHalf.charAt(payloadHalf.length - 1);
const flippedPayloadChar = lastPayloadChar === 'A' ? 'B' : 'A';
const payloadTampered = payloadHalf.slice(0, -1) + flippedPayloadChar + sigHalf;
const payloadTamperedResult = verify(payloadTampered, TEST_SECRET);
check(
  '5b. payload-tampered token returns invalid (HMAC mismatch)',
  payloadTamperedResult.valid === false
);

// Wrong secret.
const wrongSecretResult = verify(v2.token, 'wrong-secret-' + 'x'.repeat(50));
check('5c. wrong secret returns invalid', wrongSecretResult.valid === false);

// Garbage shape.
check('5d. empty string returns invalid', verify('', TEST_SECRET).valid === false);
check(
  '5e. token with no dot returns invalid',
  verify('nodothere', TEST_SECRET).valid === false
);
check(
  '5f. token with too many dots returns invalid',
  verify('a.b.c', TEST_SECRET).valid === false
);

// ---------------------------------------------------------------------------
// 6. Expired token rejected
// ---------------------------------------------------------------------------
section('Check 6 — Expired token rejected');

// Verify v=2 token with a "now" AFTER its expires_at.
const v2ExpiredNow = Math.floor(v2ExpiresAt.getTime() / 1000) + 60;
const expiredResult = verify(v2.token, TEST_SECRET, v2ExpiredNow);
check('6a. v=2 token verified after expires_at returns invalid', expiredResult.valid === false);

// Issue a token whose expires_at is already in the past.
const stale = issueV2({
  tripRequestId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  targetId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  nonce: 'cafebabedeadbeef0011223344556677',
  sentAt: new Date('2025-01-01T00:00:00.000Z'),
  expiresAt: new Date('2025-01-02T00:00:00.000Z'),
  secret: TEST_SECRET,
});
const staleResult = verify(stale.token, TEST_SECRET);
check('6b. token with past expires_at returns invalid', staleResult.valid === false);

// ---------------------------------------------------------------------------
// 7. Unknown payload version rejected
// ---------------------------------------------------------------------------
section('Check 7 — Unknown payload version rejected');

// Hand-craft a v=99 payload signed with the same secret.
const futurePayload = {
  v: 99,
  trip_request_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  issued_at: Math.floor(Date.now() / 1000),
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  nonce: 'a'.repeat(32),
};
const futureToken = buildToken(futurePayload, TEST_SECRET);
const futureResult = verify(futureToken, TEST_SECRET);
check('7a. correctly-signed v=99 token returns invalid (unknown version)', futureResult.valid === false);

// Missing v field
const missingVPayload = { ...futurePayload };
delete missingVPayload.v;
const missingVToken = buildToken(missingVPayload, TEST_SECRET);
check(
  '7b. correctly-signed token with no v field returns invalid',
  verify(missingVToken, TEST_SECRET).valid === false
);

// String v
const stringVToken = buildToken({ ...futurePayload, v: '2' }, TEST_SECRET);
check(
  '7c. correctly-signed token with v as string returns invalid',
  verify(stringVToken, TEST_SECRET).valid === false
);

// ---------------------------------------------------------------------------
// 8. Missing required fields rejected
// ---------------------------------------------------------------------------
section('Check 8 — Missing required fields rejected');

// v=1 missing nonce
const v1Bad = buildToken(
  {
    v: 1,
    trip_request_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    issued_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  },
  TEST_SECRET
);
check('8a. v=1 token missing nonce returns invalid', verify(v1Bad, TEST_SECRET).valid === false);

// v=2 missing dispatch_target_id
const v2Bad1 = buildToken(
  {
    v: 2,
    trip_request_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    issued_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    nonce: 'a'.repeat(32),
  },
  TEST_SECRET
);
check(
  '8b. v=2 token missing dispatch_target_id returns invalid',
  verify(v2Bad1, TEST_SECRET).valid === false
);

// v=2 with empty trip_request_id
const v2Bad2 = buildToken(
  {
    v: 2,
    trip_request_id: '',
    dispatch_target_id: 'gggggggg-gggg-gggg-gggg-gggggggggggg',
    issued_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    nonce: 'a'.repeat(32),
  },
  TEST_SECRET
);
check(
  '8c. v=2 token with empty trip_request_id returns invalid',
  verify(v2Bad2, TEST_SECRET).valid === false
);

// ---------------------------------------------------------------------------
// 9. Strict version branch (no fallback)
// ---------------------------------------------------------------------------
section('Check 9 — Strict version branch (no fallback after sig verify)');

// A v=2 payload that ALSO has a "nonce" field (which v=1 needs) but
// is missing v=1's required absence-of-dispatch_target_id. The
// verifier must NOT fall back to "treat as v=1" — it must use only
// the declared `v` discriminant. After signature verification, the
// payload is decoded ONCE and dispatched by `v`. A v=2 payload always
// returns version=2 (or invalid), never version=1.
check(
  '9a. v=2 payload returns version=2, never version=1',
  v2verified.valid && v2verified.version === 2
);
// And conversely.
check(
  '9b. v=1 payload returns version=1, never version=2',
  v1verified.valid && v1verified.version === 1
);
// Tampering the v field inside the payload would also fail HMAC, so
// "spoofed v=1 to access v=2 path" is defended at the signature
// layer; iteration-2 P2 fix made the verifier explicitly NOT retry
// against a different shape after sig success.
check(
  '9c. flipped-signature v=2 token does NOT silently fall back to v=1 verify path',
  tamperedResult.valid === false
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;

console.log(`\nTotal: ${results.length}   Passed: ${passed}   Failed: ${failed}`);

if (failed > 0) {
  console.log('\nFailing checks:');
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  - ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
  }
  process.exit(1);
} else {
  console.log('\nAll operator-token algorithm checks passed.');
  process.exit(0);
}
