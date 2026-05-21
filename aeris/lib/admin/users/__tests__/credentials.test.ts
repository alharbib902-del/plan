/**
 * Admin credential helpers — pure logic tests.
 *
 * Layer-1 (no DB). Runs as
 * `npm run test:admin-user-credentials`.
 *
 * Covers email normalization, password strength rules, bcrypt
 * hash/verify, session-token mint + hash invariants, and the
 * constant-time hex comparator.
 */

import { strict as assert } from 'node:assert';

import {
  BCRYPT_COST,
  constantTimeEqualHex,
  hashAdminPassword,
  mintSessionToken,
  normalizeAdminEmail,
  sessionTokenHash,
  validateAdminEmail,
  validateAdminPassword,
  validateAdminUserCreateInput,
  verifyAdminPassword,
} from '@/lib/admin/users/credentials';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  const wrap = (err: unknown) => {
    // eslint-disable-next-line no-console
    console.log(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  };
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(
        () => {
          // eslint-disable-next-line no-console
          console.log(`  ✓ ${name}`);
          passed++;
        },
        wrap
      ) as unknown as void;
    }
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    wrap(err);
  }
}

// eslint-disable-next-line no-console
console.log('\n[admin-user-credentials] running …\n');

async function run() {
  // --------------------------------------------------------
  // normalizeAdminEmail
  // --------------------------------------------------------

  test('normalize lowercases', () => {
    assert.equal(normalizeAdminEmail('Founder@Aeris.SA'), 'founder@aeris.sa');
  });

  test('normalize trims whitespace', () => {
    assert.equal(normalizeAdminEmail('  a@b.co  '), 'a@b.co');
  });

  // --------------------------------------------------------
  // validateAdminEmail
  // --------------------------------------------------------

  test('valid email passes', () => {
    const v = validateAdminEmail('Founder@Aeris.SA');
    assert.equal(v.ok, true);
    if (v.ok) assert.equal(v.email, 'founder@aeris.sa');
  });

  test('empty email → email_empty', () => {
    const v = validateAdminEmail('');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'email_empty');
  });

  test('whitespace-only email → email_empty', () => {
    const v = validateAdminEmail('   ');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'email_empty');
  });

  test('missing @ → email_format', () => {
    const v = validateAdminEmail('notanemail');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'email_format');
  });

  test('missing TLD → email_format', () => {
    const v = validateAdminEmail('a@b');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'email_format');
  });

  test('spaces inside → email_format', () => {
    const v = validateAdminEmail('a b@c.co');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'email_format');
  });

  test('over 254 chars → email_too_long', () => {
    const v = validateAdminEmail('a'.repeat(250) + '@x.co');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'email_too_long');
  });

  // --------------------------------------------------------
  // validateAdminPassword
  // --------------------------------------------------------

  test('strong password passes', () => {
    const v = validateAdminPassword('SuperSecret9X!');
    assert.equal(v.ok, true);
  });

  test('11 chars → password_too_short', () => {
    const v = validateAdminPassword('Short99Ab12');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'password_too_short');
  });

  test('over 128 chars → password_too_long', () => {
    const v = validateAdminPassword('A1b'.repeat(50));
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'password_too_long');
  });

  test('all lowercase digits → password_weak (no uppercase)', () => {
    const v = validateAdminPassword('alllower12345678');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'password_weak');
  });

  test('no digit → password_weak', () => {
    const v = validateAdminPassword('NoDigitsAtAllHere');
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'password_weak');
  });

  test('long passphrase with lower/upper/digit passes', () => {
    const v = validateAdminPassword('correct horse Battery 42 staple');
    assert.equal(v.ok, true);
  });

  // --------------------------------------------------------
  // bcrypt hash + verify
  // --------------------------------------------------------

  test('hash + verify roundtrip succeeds', async () => {
    const hash = await hashAdminPassword('CorrectHorseBattery42!');
    assert.ok(hash.startsWith('$2'));
    const ok = await verifyAdminPassword('CorrectHorseBattery42!', hash);
    assert.equal(ok, true);
  });

  test('verify rejects wrong password', async () => {
    const hash = await hashAdminPassword('CorrectHorseBattery42!');
    const ok = await verifyAdminPassword('WrongPasswordX1234', hash);
    assert.equal(ok, false);
  });

  test('verify rejects empty inputs', async () => {
    assert.equal(await verifyAdminPassword('', 'anyhash'), false);
    assert.equal(await verifyAdminPassword('whatever', ''), false);
  });

  test('hash cost factor matches BCRYPT_COST constant', async () => {
    const hash = await hashAdminPassword('Test123Hash!');
    // $2a$12$... — cost is the segment between second/third $.
    const parts = hash.split('$');
    assert.equal(Number(parts[2]), BCRYPT_COST);
  });

  // --------------------------------------------------------
  // session token mint + hash
  // --------------------------------------------------------

  test('mintSessionToken returns base64url token + sha256 hash', () => {
    const { token, hash } = mintSessionToken();
    // Base64url: a-z A-Z 0-9 _ - only. 32 random bytes → 43 chars.
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.ok(token.length >= 42);
    assert.equal(hash.length, 64); // sha256 hex = 64
    assert.match(hash, /^[a-f0-9]+$/);
  });

  test('two mints differ', () => {
    const a = mintSessionToken();
    const b = mintSessionToken();
    assert.notEqual(a.token, b.token);
    assert.notEqual(a.hash, b.hash);
  });

  test('sessionTokenHash is deterministic for same input', () => {
    const a = sessionTokenHash('some-token-value');
    const b = sessionTokenHash('some-token-value');
    assert.equal(a, b);
  });

  test('sessionTokenHash differs for different inputs', () => {
    const a = sessionTokenHash('token-a');
    const b = sessionTokenHash('token-b');
    assert.notEqual(a, b);
  });

  // --------------------------------------------------------
  // constantTimeEqualHex
  // --------------------------------------------------------

  test('equal hex strings → true', () => {
    assert.equal(
      constantTimeEqualHex('deadbeef', 'deadbeef'),
      true
    );
  });

  test('different hex strings (same length) → false', () => {
    assert.equal(
      constantTimeEqualHex('deadbeef', 'feedbabe'),
      false
    );
  });

  test('different lengths → false', () => {
    assert.equal(constantTimeEqualHex('dead', 'deadbeef'), false);
  });

  test('non-hex strings → false (Buffer.from fails silently)', () => {
    assert.equal(constantTimeEqualHex('zzzz', 'zzzz'), false);
  });

  // --------------------------------------------------------
  // validateAdminUserCreateInput (PR #88 round-1 P2 fix)
  // --------------------------------------------------------

  test('valid create input passes + normalizes email + trims name', () => {
    const v = validateAdminUserCreateInput({
      email: '  Founder@Aeris.SA  ',
      password: 'CorrectHorseBattery42!',
      full_name: '  Basem Alharbi  ',
    });
    assert.equal(v.ok, true);
    if (v.ok) {
      assert.equal(v.email, 'founder@aeris.sa');
      assert.equal(v.full_name, 'Basem Alharbi');
    }
  });

  test('create rejects bad email FIRST', () => {
    const v = validateAdminUserCreateInput({
      email: 'not-an-email',
      password: 'StrongPass99X!',
      full_name: 'Valid Name',
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'email_format');
  });

  test('create rejects weak password', () => {
    const v = validateAdminUserCreateInput({
      email: 'ok@aeris.sa',
      password: 'alllower12345678',
      full_name: 'Valid Name',
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'password_weak');
  });

  test('create rejects too-short full_name (after trim)', () => {
    const v = validateAdminUserCreateInput({
      email: 'ok@aeris.sa',
      password: 'StrongPass99X!',
      full_name: ' a ',
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'full_name_too_short');
  });

  test('create rejects too-long full_name', () => {
    const v = validateAdminUserCreateInput({
      email: 'ok@aeris.sa',
      password: 'StrongPass99X!',
      full_name: 'x'.repeat(121),
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'full_name_too_long');
  });

  test('create rejects empty full_name', () => {
    const v = validateAdminUserCreateInput({
      email: 'ok@aeris.sa',
      password: 'StrongPass99X!',
      full_name: '',
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.error, 'full_name_too_short');
  });

  await Promise.resolve();
}

run().then(() => {
  // eslint-disable-next-line no-console
  console.log(`\n[admin-user-credentials] ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
});
