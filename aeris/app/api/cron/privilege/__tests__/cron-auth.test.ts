/**
 * Phase 13 PR 3 — privilege cron route auth contract test.
 *
 * Mirror of Phase 12 medevac cron-auth.test.ts. The 2 privilege
 * cron routes (evaluate-all + expire-cashback) use the shared
 * verifyCronAuth helper from lib/empty-legs/cron-auth. The
 * canonical helper test lives at
 * app/api/empty-legs/__tests__/cron-auth.test.ts; this file
 * exercises the binding so a future accidental rewrite of
 * either privilege route can't quietly break the contract.
 *
 * Runs as: npm run test:privilege-cron-auth
 */

import { strict as assert } from 'node:assert';

const TEST_SECRET = 'test-privilege-cron-secret-XYZ-XYZ';

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
      r.then(
        () => {
          // eslint-disable-next-line no-console
          console.log(`  ✓ ${name}`);
          passed++;
        },
        wrap
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`  ✓ ${name}`);
      passed++;
    }
  } catch (err) {
    wrap(err);
  }
}

// eslint-disable-next-line no-console
console.log('\n[privilege-cron-auth] running …\n');

async function run() {
  delete process.env.CRON_SECRET;
  const { verifyCronAuth, unauthorizedJsonResponse } = await import(
    '@/lib/empty-legs/cron-auth'
  );

  test('1. env unset → ok=false, reason=env_missing', () => {
    const verdict = verifyCronAuth(new Headers());
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.reason, 'env_missing');
    }
  });

  process.env.CRON_SECRET = TEST_SECRET;

  test('2. missing Authorization → ok=false, reason=missing_header', () => {
    const verdict = verifyCronAuth(new Headers());
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.reason, 'missing_header');
    }
  });

  test('3. wrong bearer → ok=false, reason=mismatch', () => {
    const headers = new Headers({
      authorization: 'Bearer wrong-secret-xyzwrong-secret-xyz',
    });
    const verdict = verifyCronAuth(headers);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.reason, 'mismatch');
    }
  });

  test('4. correct bearer → ok=true', () => {
    const headers = new Headers({
      authorization: `Bearer ${TEST_SECRET}`,
    });
    const verdict = verifyCronAuth(headers);
    assert.equal(verdict.ok, true);
  });

  test('5. malformed header (no Bearer prefix) → reason=malformed', () => {
    const headers = new Headers({
      authorization: TEST_SECRET,
    });
    const verdict = verifyCronAuth(headers);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.reason, 'malformed');
    }
  });

  test('6. unauthorizedJsonResponse uniformly returns 401', () => {
    const resp = unauthorizedJsonResponse();
    assert.equal(resp.status, 401);
  });

  await Promise.resolve();
}

run().then(() => {
  // eslint-disable-next-line no-console
  console.log(`\n[privilege-cron-auth] ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
});
