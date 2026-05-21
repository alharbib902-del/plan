/**
 * RFC 6238 TOTP pure-logic tests.
 *
 * Layer-1 (no DB, no env). Runs as
 * `npm run test:admin-mfa-totp`.
 *
 * Includes the RFC 6238 Appendix B test vectors (SHA-1) to
 * regression-guard our HOTP/TOTP implementation against any
 * future "innocent" refactor.
 */

import { strict as assert } from 'node:assert';

import {
  base32Decode,
  base32Encode,
  buildOtpAuthUrl,
  counterForTimestamp,
  generateTotp,
  mintTotpSecret,
  TOTP_STEP_SECONDS,
  verifyTotp,
} from '@/lib/admin/mfa/totp';

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
console.log('\n[admin-mfa-totp] running …\n');

// ============================================================
// Base32
// ============================================================

test('base32Encode of "12345678901234567890" matches RFC fixture', () => {
  // Standard fixture used by RFC 4226/6238 test vectors.
  const enc = base32Encode(Buffer.from('12345678901234567890', 'utf8'));
  assert.equal(enc, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});

test('base32 roundtrip is lossless for random secrets', () => {
  for (let i = 0; i < 50; i++) {
    const { raw, base32 } = mintTotpSecret();
    const decoded = base32Decode(base32);
    assert.ok(decoded);
    assert.equal(decoded?.length, raw.length);
    assert.equal(decoded?.toString('hex'), raw.toString('hex'));
  }
});

test('base32Decode rejects invalid chars', () => {
  assert.equal(base32Decode('NOT-BASE32!'), null);
  assert.equal(base32Decode(''), null);
  assert.equal(base32Decode('   '), null);
});

test('base32Decode is whitespace/dash tolerant', () => {
  const a = base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const b = base32Decode(' GEZD-GNBV GY3T-QOJQ GEZD-GNBV GY3T-QOJQ ');
  const c = base32Decode('gezdgnbvgy3tqojqgezdgnbvgy3tqojq');
  assert.deepEqual(a?.toString('hex'), b?.toString('hex'));
  assert.deepEqual(a?.toString('hex'), c?.toString('hex'));
});

// ============================================================
// RFC 6238 Appendix B test vectors (SHA-1, 6-digit truncation
// of the published 8-digit codes — TOTP only takes the last
// `digits` of the dynamic-truncation integer modulo 10^digits)
// ============================================================

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const RFC_VECTORS: Array<{ t: number; otp: string; step: number }> = [
  { t: 59, otp: '287082', step: 1 },
  { t: 1111111109, otp: '081804', step: 37037036 },
  { t: 1111111111, otp: '050471', step: 37037037 },
  { t: 1234567890, otp: '005924', step: 41152263 },
  { t: 2000000000, otp: '279037', step: 66666666 },
];

for (const v of RFC_VECTORS) {
  test(`RFC vector T=${v.t} → OTP=${v.otp}`, () => {
    assert.equal(counterForTimestamp(v.t), v.step);
    const otp = generateTotp({
      secretBase32: RFC_SECRET,
      nowSeconds: v.t,
    });
    assert.equal(otp, v.otp);
  });
}

// ============================================================
// generateTotp + verifyTotp roundtrip
// ============================================================

test('verifyTotp accepts the code generated for the same step', () => {
  const { base32 } = mintTotpSecret();
  const now = 1700000000;
  const otp = generateTotp({ secretBase32: base32, nowSeconds: now })!;
  const verdict = verifyTotp({
    candidate: otp,
    secretBase32: base32,
    nowSeconds: now,
  });
  assert.equal(verdict.ok, true);
});

test('verifyTotp accepts a code from the previous step (within window)', () => {
  const { base32 } = mintTotpSecret();
  const now = 1700000000;
  const earlier = now - TOTP_STEP_SECONDS;
  const otp = generateTotp({ secretBase32: base32, nowSeconds: earlier })!;
  const verdict = verifyTotp({
    candidate: otp,
    secretBase32: base32,
    nowSeconds: now,
  });
  assert.equal(verdict.ok, true);
});

test('verifyTotp accepts a code from the next step (within window)', () => {
  const { base32 } = mintTotpSecret();
  const now = 1700000000;
  const later = now + TOTP_STEP_SECONDS;
  const otp = generateTotp({ secretBase32: base32, nowSeconds: later })!;
  const verdict = verifyTotp({
    candidate: otp,
    secretBase32: base32,
    nowSeconds: now,
  });
  assert.equal(verdict.ok, true);
});

test('verifyTotp rejects a code from 2 steps away (outside default window)', () => {
  const { base32 } = mintTotpSecret();
  const now = 1700000000;
  const stale = now - 2 * TOTP_STEP_SECONDS;
  const otp = generateTotp({ secretBase32: base32, nowSeconds: stale })!;
  const verdict = verifyTotp({
    candidate: otp,
    secretBase32: base32,
    nowSeconds: now,
  });
  assert.equal(verdict.ok, false);
});

test('verifyTotp rejects malformed OTP (letters / wrong length)', () => {
  const { base32 } = mintTotpSecret();
  const cases = ['', '12345', '1234567', 'abc123', '12345a', '   '];
  for (const c of cases) {
    const v = verifyTotp({ candidate: c, secretBase32: base32 });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, 'malformed');
  }
});

test('verifyTotp rejects wrong OTP with reason=mismatch', () => {
  const { base32 } = mintTotpSecret();
  const v = verifyTotp({
    candidate: '000000',
    secretBase32: base32,
    nowSeconds: 1700000000,
  });
  if (v.ok) {
    // Astronomically unlikely (1 / 10^6); skip the assertion.
    return;
  }
  assert.equal(v.reason, 'mismatch');
});

test('verifyTotp rejects malformed secret', () => {
  const v = verifyTotp({
    candidate: '123456',
    secretBase32: 'NOT-VALID!',
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'malformed');
});

test('verifyTotp returns matched_step on success (replay defense input)', () => {
  const { base32 } = mintTotpSecret();
  const now = 1700000000;
  const otp = generateTotp({ secretBase32: base32, nowSeconds: now })!;
  const v = verifyTotp({
    candidate: otp,
    secretBase32: base32,
    nowSeconds: now,
  });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.matched_step, Math.floor(now / TOTP_STEP_SECONDS));
});

// ============================================================
// mintTotpSecret
// ============================================================

test('mintTotpSecret produces 32-char base32', () => {
  for (let i = 0; i < 20; i++) {
    const { raw, base32 } = mintTotpSecret();
    assert.equal(raw.length, 20);
    assert.equal(base32.length, 32);
    assert.match(base32, /^[A-Z2-7]+$/);
  }
});

test('two mints produce different secrets', () => {
  const a = mintTotpSecret();
  const b = mintTotpSecret();
  assert.notEqual(a.base32, b.base32);
});

// ============================================================
// buildOtpAuthUrl
// ============================================================

test('otpauth URL embeds issuer + label + secret + canonical params', () => {
  const url = buildOtpAuthUrl({
    issuer: 'Aeris',
    label: 'founder@aeris.sa',
    secretBase32: RFC_SECRET,
  });
  assert.match(url, /^otpauth:\/\/totp\/Aeris:/);
  assert.match(url, /founder%40aeris\.sa/);
  assert.match(url, new RegExp(`secret=${RFC_SECRET}`));
  assert.match(url, /issuer=Aeris/);
  assert.match(url, /algorithm=SHA1/);
  assert.match(url, /digits=6/);
  assert.match(url, /period=30/);
});

test('otpauth URL strips trailing = padding from secret', () => {
  const url = buildOtpAuthUrl({
    issuer: 'Aeris',
    label: 'a@b.co',
    secretBase32: 'JBSWY3DPEHPK3PXP====', // padded
  });
  assert.match(url, /secret=JBSWY3DPEHPK3PXP&/);
});

// ============================================================
// counterForTimestamp
// ============================================================

test('counterForTimestamp returns floor(t / 30)', () => {
  assert.equal(counterForTimestamp(0), 0);
  assert.equal(counterForTimestamp(29), 0);
  assert.equal(counterForTimestamp(30), 1);
  assert.equal(counterForTimestamp(59), 1);
  assert.equal(counterForTimestamp(60), 2);
});

// ============================================================
// Wrap up
// ============================================================

// eslint-disable-next-line no-console
console.log(`\n[admin-mfa-totp] ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
