/**
 * MFA recovery code pure-logic tests.
 *
 * Layer-1 (no DB). Runs as
 * `npm run test:admin-mfa-recovery-codes`.
 */

import { strict as assert } from 'node:assert';

import {
  canonicalizeRecoveryCode,
  constantTimeRecoveryCodeHashEqual,
  hashRecoveryCode,
  isWellFormedRawRecoveryCode,
  mintRecoveryCodes,
  RECOVERY_CODE_COUNT,
} from '@/lib/admin/mfa/recovery-codes';

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
console.log('\n[admin-mfa-recovery-codes] running …\n');

// ============================================================
// mintRecoveryCodes
// ============================================================

test('mintRecoveryCodes default returns 10 codes', () => {
  const codes = mintRecoveryCodes();
  assert.equal(codes.length, RECOVERY_CODE_COUNT);
});

test('every code matches the ABCD-EFGH-JKLM shape', () => {
  const codes = mintRecoveryCodes();
  for (const c of codes) {
    assert.match(c, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  }
});

test('codes never contain the ambiguous chars I, O, 0, 1', () => {
  // The alphabet must stay 32 chars for clean base32 math, so we
  // keep L (not commonly confused with the other allowed chars in
  // the codeword context) and exclude only the genuinely
  // ambiguous I/O/0/1 quartet.
  const codes = mintRecoveryCodes(100);
  for (const c of codes) {
    assert.equal(c.includes('I'), false);
    assert.equal(c.includes('O'), false);
    assert.equal(c.includes('0'), false);
    assert.equal(c.includes('1'), false);
  }
});

test('within a single batch all codes are unique', () => {
  for (let i = 0; i < 10; i++) {
    const codes = mintRecoveryCodes();
    const set = new Set(codes);
    assert.equal(set.size, codes.length);
  }
});

test('mintRecoveryCodes(N) returns N codes', () => {
  assert.equal(mintRecoveryCodes(1).length, 1);
  assert.equal(mintRecoveryCodes(3).length, 3);
  assert.equal(mintRecoveryCodes(15).length, 15);
});

// ============================================================
// canonicalizeRecoveryCode
// ============================================================

test('canonicalize uppercases + strips dashes/spaces', () => {
  assert.equal(canonicalizeRecoveryCode('abcd-efgh-jklm'), 'ABCDEFGHJKLM');
  assert.equal(canonicalizeRecoveryCode('  ABCD EFGH JKLM  '), 'ABCDEFGHJKLM');
  assert.equal(canonicalizeRecoveryCode('AB-CD-EF-GH-JK-LM'), 'ABCDEFGHJKLM');
});

test('canonicalize returns empty for non-string input', () => {
  // @ts-expect-error — testing runtime guard
  assert.equal(canonicalizeRecoveryCode(null), '');
  // @ts-expect-error
  assert.equal(canonicalizeRecoveryCode(undefined), '');
  // @ts-expect-error
  assert.equal(canonicalizeRecoveryCode(123), '');
});

// ============================================================
// hashRecoveryCode
// ============================================================

test('hash is deterministic for same canonicalized input', () => {
  const a = hashRecoveryCode('abcd-efgh-jklm');
  const b = hashRecoveryCode('ABCD-EFGH-JKLM');
  const c = hashRecoveryCode(' ABCD EFGH JKLM ');
  assert.equal(a, b);
  assert.equal(a, c);
});

test('hash returns 64-char hex (sha256)', () => {
  const h = hashRecoveryCode('any code here');
  assert.equal(h.length, 64);
  assert.match(h, /^[a-f0-9]{64}$/);
});

test('different codes hash to different digests', () => {
  const a = hashRecoveryCode('ABCD-EFGH-JKLM');
  const b = hashRecoveryCode('XYZW-EFGH-JKLM');
  assert.notEqual(a, b);
});

// ============================================================
// constantTimeRecoveryCodeHashEqual
// ============================================================

test('equal valid hex hashes → true', () => {
  const h = hashRecoveryCode('ABCD-EFGH-JKLM');
  assert.equal(constantTimeRecoveryCodeHashEqual(h, h), true);
});

test('different valid hex hashes → false', () => {
  const a = hashRecoveryCode('AAAA-AAAA-AAAA');
  const b = hashRecoveryCode('BBBB-BBBB-BBBB');
  assert.equal(constantTimeRecoveryCodeHashEqual(a, b), false);
});

test('non-hex input → false', () => {
  assert.equal(
    constantTimeRecoveryCodeHashEqual('zzzz', 'zzzz'),
    false
  );
  assert.equal(
    constantTimeRecoveryCodeHashEqual('not-a-hash', 'not-a-hash'),
    false
  );
});

test('length mismatch → false', () => {
  const h = hashRecoveryCode('ABCD-EFGH-JKLM');
  assert.equal(constantTimeRecoveryCodeHashEqual(h.slice(0, 32), h), false);
});

// ============================================================
// isWellFormedRawRecoveryCode
// ============================================================

test('accepts canonical recovery code', () => {
  const code = mintRecoveryCodes(1)[0];
  assert.equal(isWellFormedRawRecoveryCode(code), true);
});

test('accepts case-insensitive + dash variants', () => {
  const code = mintRecoveryCodes(1)[0];
  assert.equal(isWellFormedRawRecoveryCode(code.toLowerCase()), true);
  assert.equal(isWellFormedRawRecoveryCode(code.replace(/-/g, ' ')), true);
});

test('rejects 6-digit TOTP (common mistake)', () => {
  assert.equal(isWellFormedRawRecoveryCode('123456'), false);
});

test('rejects empty / whitespace', () => {
  assert.equal(isWellFormedRawRecoveryCode(''), false);
  assert.equal(isWellFormedRawRecoveryCode('   '), false);
});

test('rejects code with banned chars (I/O/0/1)', () => {
  assert.equal(isWellFormedRawRecoveryCode('IIII-IIII-IIII'), false);
  assert.equal(isWellFormedRawRecoveryCode('1111-1111-1111'), false);
  assert.equal(isWellFormedRawRecoveryCode('OOOO-OOOO-OOOO'), false);
  assert.equal(isWellFormedRawRecoveryCode('0000-0000-0000'), false);
});

test('rejects wrong length', () => {
  assert.equal(isWellFormedRawRecoveryCode('ABCD-EFGH'), false); // 8 chars
  assert.equal(isWellFormedRawRecoveryCode('ABCD-EFGH-JKLM-NPQR'), false); // 16
});

// ============================================================
// Wrap up
// ============================================================

// eslint-disable-next-line no-console
console.log(
  `\n[admin-mfa-recovery-codes] ${passed} passed, ${failed} failed\n`
);
if (failed > 0) process.exit(1);
