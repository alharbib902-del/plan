/**
 * Unit tests for `resolveActiveNavHref`.
 *
 * Pins the admin/operator shell nav contract: exactly one link is
 * `aria-current="page"`, and a parent entry never lights up together
 * with a more specific sibling from the same nav.
 *
 * Runs as:
 *   npm run test:utils-active-nav-href
 */

import { strict as assert } from 'node:assert';

import { resolveActiveNavHref } from '../active-nav-href';

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

const ADMIN = [
  '/admin/leads',
  '/admin/trips',
  '/admin/empty-legs',
  '/admin/empty-legs/outreach-queue',
  '/admin/empty-legs/operators',
];

const OPERATOR = [
  '/operator/dashboard',
  '/operator/cargo',
  '/operator/cargo/offers',
  '/operator/profile',
];

test('1. exact match is active', () => {
  assert.equal(resolveActiveNavHref('/admin/trips', ADMIN), '/admin/trips');
});

test('2. detail page activates its list link', () => {
  assert.equal(
    resolveActiveNavHref('/admin/leads/3f2a', ADMIN),
    '/admin/leads'
  );
});

test('3. specific child beats its parent', () => {
  assert.equal(
    resolveActiveNavHref('/admin/empty-legs/operators', ADMIN),
    '/admin/empty-legs/operators'
  );
  assert.equal(
    resolveActiveNavHref('/operator/cargo/offers/9', OPERATOR),
    '/operator/cargo/offers'
  );
});

test('4. parent stays active for its non-listed children', () => {
  assert.equal(
    resolveActiveNavHref('/admin/empty-legs/new', ADMIN),
    '/admin/empty-legs'
  );
  assert.equal(
    resolveActiveNavHref('/operator/cargo/abc', OPERATOR),
    '/operator/cargo'
  );
});

test('5. sibling sharing a string prefix is not matched', () => {
  assert.equal(resolveActiveNavHref('/admin/trips-archive', ADMIN), null);
  assert.equal(
    resolveActiveNavHref('/operator/profile-password', OPERATOR),
    null
  );
});

test('6. nested profile route keeps profile active', () => {
  assert.equal(
    resolveActiveNavHref('/operator/profile/password', OPERATOR),
    '/operator/profile'
  );
});

test('7. unrelated path and empty list return null', () => {
  assert.equal(resolveActiveNavHref('/admin/clients/1', ADMIN), null);
  assert.equal(resolveActiveNavHref('/admin/leads', []), null);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
