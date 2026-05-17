/**
 * Phase 12 PR 2 — tests for the J5 Shield routing
 * discriminator + payload schema (lib/medevac/shield-routing.ts).
 *
 * Round 1 PR #76 P1 #1 fix moved J5 dispatch from §4.2 RPC
 * into the Server Action layer. The isUseSubscriptionTruthy
 * helper + shieldRoutingSchema are the contract; this test
 * is regression coverage so a future refactor doesn't
 * accidentally widen / narrow the truthy set or drop a
 * required field.
 *
 * Runs as: npm run test:medevac-shield-consume-routing
 *
 * Cases (16 total):
 *   isUseSubscriptionTruthy:
 *     1. true → truthy
 *     2. 'true' → truthy
 *     3. 1 → truthy
 *     4. '1' → truthy
 *     5. false → falsy
 *     6. 'false' → falsy
 *     7. 0 → falsy
 *     8. null → falsy
 *     9. undefined → falsy
 *    10. 'yes' → falsy (TS layer narrow; RPC accepts as DiD)
 *    11. '' → falsy
 *   shieldRoutingSchema:
 *    12. happy → ok
 *    13. use_subscription: false → fails (literal mismatch)
 *    14. subscription_id missing → fails
 *    15. patient_member_name missing → fails
 *    16. patient_member_dob malformed → fails
 */

import { strict as assert } from 'node:assert';

import {
  isUseSubscriptionTruthy,
  shieldRoutingSchema,
} from '@/lib/medevac/shield-routing';

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
console.log('\n[medevac-shield-consume-routing] running …\n');

// ============================================================
// isUseSubscriptionTruthy — discriminator regression coverage
// ============================================================

test('1.  true → truthy', () => {
  assert.equal(isUseSubscriptionTruthy(true), true);
});
test("2.  'true' → truthy", () => {
  assert.equal(isUseSubscriptionTruthy('true'), true);
});
test('3.  1 → truthy', () => {
  assert.equal(isUseSubscriptionTruthy(1), true);
});
test("4.  '1' → truthy", () => {
  assert.equal(isUseSubscriptionTruthy('1'), true);
});
test('5.  false → falsy', () => {
  assert.equal(isUseSubscriptionTruthy(false), false);
});
test("6.  'false' → falsy", () => {
  assert.equal(isUseSubscriptionTruthy('false'), false);
});
test('7.  0 → falsy', () => {
  assert.equal(isUseSubscriptionTruthy(0), false);
});
test('8.  null → falsy', () => {
  assert.equal(isUseSubscriptionTruthy(null), false);
});
test('9.  undefined → falsy', () => {
  assert.equal(isUseSubscriptionTruthy(undefined), false);
});
test("10. 'yes' → falsy (TS layer; RPC mirrors DiD with wider set)", () => {
  assert.equal(isUseSubscriptionTruthy('yes'), false);
});
test("11. '' → falsy", () => {
  assert.equal(isUseSubscriptionTruthy(''), false);
});

// ============================================================
// shieldRoutingSchema — payload shape regression coverage
// ============================================================

const happy = {
  use_subscription: true as const,
  subscription_id: '11111111-2222-4333-8444-555555555555',
  patient_member_name: 'Ahmed Al-Test',
  patient_member_dob: '1980-05-15',
  // .passthrough() means unknown fields are kept (not rejected)
  // — that's intentional, so the base request fields ride
  // along with the routing fields in one payload.
  service_level: 'BMT',
};

test('12. happy routing payload → ok', () => {
  const r = shieldRoutingSchema.safeParse(happy);
  assert.equal(r.success, true);
});

test('13. use_subscription: false → fails (literal true required)', () => {
  const r = shieldRoutingSchema.safeParse({
    ...happy,
    use_subscription: false,
  });
  assert.equal(r.success, false);
});

test('14. subscription_id missing → fails', () => {
  const { subscription_id: _drop, ...rest } = happy;
  const r = shieldRoutingSchema.safeParse(rest);
  assert.equal(r.success, false);
});

test('15. patient_member_name missing → fails', () => {
  const { patient_member_name: _drop, ...rest } = happy;
  const r = shieldRoutingSchema.safeParse(rest);
  assert.equal(r.success, false);
});

test('16. patient_member_dob malformed shape → fails', () => {
  const r = shieldRoutingSchema.safeParse({
    ...happy,
    patient_member_dob: '15-05-1980',
  });
  assert.equal(r.success, false);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
