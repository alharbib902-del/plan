/**
 * Phase 7 PR 2e — cron auth helper parity test.
 *
 * Layer-1 (no DB), runs as `npm run test:empty-legs-cron-auth`.
 * Asserts the shared `verifyCronAuth` helper rejects every
 * malformed / missing / mismatched authorization header
 * with the right reason code.
 *
 * The helper backs the 3 cron routes + the internal
 * match-trigger route. A regression here would let
 * unauthorized callers drain the outbox, expire reservations,
 * or push price ticks.
 */

import { strict as assert } from 'node:assert';

const SECRET_ENV = 'CRON_SECRET';
const TEST_SECRET = 'test-cron-secret-do-not-use-in-prod-XYZ';
process.env[SECRET_ENV] = TEST_SECRET;

import {
  verifyCronAuth,
  unauthorizedJsonResponse,
} from '@/lib/empty-legs/cron-auth';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const r = fn();
    if (r instanceof Promise) {
      r.then(
        () => {
          // eslint-disable-next-line no-console
          console.log(`  ✓ ${name}`);
          passed++;
        },
        (err: unknown) => {
          // eslint-disable-next-line no-console
          console.log(`  ✗ ${name}`);
          // eslint-disable-next-line no-console
          console.log(
            `    ${err instanceof Error ? err.message : String(err)}`
          );
          failed++;
        }
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(`  ✓ ${name}`);
      passed++;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// eslint-disable-next-line no-console
console.log('\n[empty-legs-cron-auth] running …\n');

function headersWith(value: string | undefined): Headers {
  const h = new Headers();
  if (value !== undefined) h.set('authorization', value);
  return h;
}

test('valid Bearer + correct secret → ok:true', () => {
  const verdict = verifyCronAuth(headersWith(`Bearer ${TEST_SECRET}`));
  assert.equal(verdict.ok, true);
});

test('case-insensitive Bearer prefix → ok:true', () => {
  const verdict = verifyCronAuth(headersWith(`bearer ${TEST_SECRET}`));
  assert.equal(verdict.ok, true);
});

test('extra whitespace around the header value → ok:true', () => {
  const verdict = verifyCronAuth(
    headersWith(`  Bearer ${TEST_SECRET}  `)
  );
  assert.equal(verdict.ok, true);
});

test('missing authorization header → reason:missing_header', () => {
  const verdict = verifyCronAuth(headersWith(undefined));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.reason, 'missing_header');
  }
});

test('non-Bearer scheme → reason:malformed', () => {
  const verdict = verifyCronAuth(headersWith(`Basic ${TEST_SECRET}`));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.reason, 'malformed');
  }
});

test('Bearer without token → reason:malformed', () => {
  const verdict = verifyCronAuth(headersWith('Bearer'));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.reason, 'malformed');
  }
});

test('Bearer with wrong secret of same length → reason:mismatch', () => {
  const wrong = TEST_SECRET.slice(0, -1) + 'X';
  const verdict = verifyCronAuth(headersWith(`Bearer ${wrong}`));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.reason, 'mismatch');
  }
});

test('Bearer with shorter secret → reason:mismatch', () => {
  const verdict = verifyCronAuth(headersWith(`Bearer short`));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.reason, 'mismatch');
  }
});

test('env var unset → reason:env_missing', () => {
  const original = process.env[SECRET_ENV];
  process.env[SECRET_ENV] = '';
  try {
    const verdict = verifyCronAuth(
      headersWith(`Bearer ${TEST_SECRET}`)
    );
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.reason, 'env_missing');
    }
  } finally {
    process.env[SECRET_ENV] = original;
  }
});

test('unauthorizedJsonResponse → 401 + structured body', () => {
  const r = unauthorizedJsonResponse();
  assert.equal(r.status, 401);
  // Body parse roundtrip via Promise; sync-friendly via
  // .text() on Response.
  return r.text().then((body) => {
    const parsed = JSON.parse(body) as { ok: boolean; error: string };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, 'unauthorized');
  });
});

// eslint-disable-next-line no-console
setTimeout(() => {
  // eslint-disable-next-line no-console
  console.log(
    `\n[empty-legs-cron-auth] ${passed} passed, ${failed} failed\n`
  );
  if (failed > 0) {
    process.exit(1);
  }
}, 100);
