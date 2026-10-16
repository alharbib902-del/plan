/**
 * Service-worker cache-bypass guard.
 *
 * Loads the real `public/sw.js` into an isolated VM context (with a
 * stub `self`) and exercises its `shouldBypassCache` so personal
 * pages can never be written to Cache Storage again. Cache Storage
 * ignores `no-store`, survives logout, and replays its entries
 * offline — a cached `/me` page (MedEvac patient details, phone,
 * email) would be served to the next person on a shared device.
 *
 * Runs as:
 *   npm run test:pwa-sw-bypass
 *
 * Cases covered:
 *   1.  Signed-in client portal (/me and children) bypasses
 *   2.  Token-gated personal pages bypass (/booking/<token>,
 *       /reset-password/<token>, /empty-legs/<leg>/reserved)
 *   3.  Admin / operator / api keep bypassing
 *   4.  Public marketing pages stay cacheable (offline survival)
 *   5.  Prefix match is exact-segment (/media is not /me)
 *   6.  CACHE_VERSION moved past v1 so old caches holding /me
 *       pages are purged on activate
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
// here = aeris/lib/pwa/__tests__
const SW_PATH = join(here, '..', '..', '..', 'public', 'sw.js');
const swSource = readFileSync(SW_PATH, 'utf8');

const context = createContext({
  self: { addEventListener: () => undefined },
  URL,
});
runInContext(swSource, context);
const shouldBypassCache = (context as { shouldBypassCache?: unknown })
  .shouldBypassCache as (pathname: string) => boolean;

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
    console.error(err);
    failed++;
  }
}

test('0. sw.js exposes shouldBypassCache', () => {
  assert.equal(typeof shouldBypassCache, 'function');
});

test('1. client portal bypasses', () => {
  for (const p of ['/me', '/me/', '/me/bookings', '/me/medevac/abc-123', '/me/profile']) {
    assert.equal(shouldBypassCache(p), true, p);
  }
});

test('2. token-gated personal pages bypass', () => {
  for (const p of [
    '/booking/tok123',
    '/booking/tok123/checkout-prep',
    '/reset-password/tok123',
    '/empty-legs/EL-0042/reserved',
    '/empty-legs/EL-0042/reserved/',
  ]) {
    assert.equal(shouldBypassCache(p), true, p);
  }
});

test('3. admin / operator / api keep bypassing', () => {
  for (const p of ['/admin', '/admin/trips', '/operator', '/operator/offer/x', '/api', '/api/cron/x']) {
    assert.equal(shouldBypassCache(p), true, p);
  }
});

test('4. public pages stay cacheable', () => {
  for (const p of ['/', '/offline', '/empty-legs', '/empty-legs/EL-0042', '/request', '/privilege', '/login']) {
    assert.equal(shouldBypassCache(p), false, p);
  }
});

test('5. prefix match is segment-exact', () => {
  for (const p of ['/media', '/meet', '/bookings-info', '/apis', '/empty-legs/EL-1/reserve']) {
    assert.equal(shouldBypassCache(p), false, p);
  }
});

test('6. CACHE_VERSION bumped past v1', () => {
  const m = swSource.match(/const CACHE_VERSION = '([^']+)'/);
  assert.ok(m, 'CACHE_VERSION literal not found');
  assert.notEqual(m[1], 'aeris-v1');
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  (process as unknown as { exit: (code: number) => void }).exit(1);
}
