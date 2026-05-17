/**
 * Phase 12 PR 2 — Zod schema tests for the Aeris Shield
 * subscription surface.
 *
 * Runs as: npm run test:medevac-subscription-validators
 *
 * Cases (18 total):
 *   subscribeShieldSchema:
 *     1. happy path (individual plan + valid owner DOB) → ok
 *     2. happy with 2 covered members → ok
 *     3. invalid plan → fails
 *     4. owner_dob missing → fails
 *     5. owner_dob malformed shape → fails
 *     6. owner_dob = 2026-02-31 (shape-valid, semantically invalid) → fails
 *     7. owner_dob = 2026-13-01 → fails
 *     8. owner_dob in the future → fails
 *     9. covered_members > 20 → fails
 *    10. covered member missing name → fails
 *    11. covered member missing dob → fails
 *    12. covered member dob in the future → fails
 *    13. duplicate (name, dob) pair → fails (uniqueness)
 *    14. duplicate name with different DOB → ok (different person)
 *    15. unknown field rejected by .strict() → fails
 *   activateSubscriptionSchema:
 *    16. valid UUID → ok
 *    17. malformed UUID → fails
 *    18. missing subscription_id → fails
 */

import { strict as assert } from 'node:assert';

import {
  subscribeShieldSchema,
  activateSubscriptionSchema,
} from '@/lib/medevac/validators/medevac-subscription';

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
console.log('\n[medevac-subscription-validators] running …\n');

const happy = {
  plan: 'individual' as const,
  owner_dob: '1980-05-15',
  covered_members: [],
};

// 1
test('happy path (individual + valid owner DOB) → ok', () => {
  const r = subscribeShieldSchema.safeParse(happy);
  assert.equal(r.success, true);
});

// 2
test('happy with 2 covered members → ok', () => {
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    plan: 'family',
    covered_members: [
      { name: 'Spouse', relationship: 'spouse', dob: '1985-03-22' },
      { name: 'Child One', relationship: 'child', dob: '2015-07-10' },
    ],
  });
  assert.equal(r.success, true);
});

// 3
test('invalid plan → fails', () => {
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    plan: 'platinum',
  });
  assert.equal(r.success, false);
});

// 4
test('owner_dob missing → fails', () => {
  const { owner_dob: _drop, ...rest } = happy;
  const r = subscribeShieldSchema.safeParse(rest);
  assert.equal(r.success, false);
});

// 5
test('owner_dob malformed shape → fails', () => {
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    owner_dob: '15/05/1980',
  });
  assert.equal(r.success, false);
});

// 6
test('owner_dob = 2026-02-31 → fails (semantically invalid)', () => {
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    owner_dob: '2026-02-31',
  });
  assert.equal(r.success, false);
});

// 7
test('owner_dob = 2026-13-01 → fails (invalid month)', () => {
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    owner_dob: '2026-13-01',
  });
  assert.equal(r.success, false);
});

// 8
test('owner_dob in the future → fails', () => {
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    .toISOString()
    .slice(0, 10);
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    owner_dob: future,
  });
  assert.equal(r.success, false);
});

// 9
test('covered_members > 20 → fails', () => {
  const big = Array.from({ length: 21 }, (_, i) => ({
    name: `Member${i}`,
    relationship: 'child',
    dob: '2010-01-01',
  }));
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    covered_members: big,
  });
  assert.equal(r.success, false);
});

// 10
test('covered member missing name → fails', () => {
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    covered_members: [
      { name: '', relationship: 'child', dob: '2010-01-01' },
    ],
  });
  assert.equal(r.success, false);
});

// 11
test('covered member missing dob → fails', () => {
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    covered_members: [{ name: 'Test', relationship: 'child', dob: '' }],
  });
  assert.equal(r.success, false);
});

// 12
test('covered member dob in the future → fails', () => {
  const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    .toISOString()
    .slice(0, 10);
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    covered_members: [
      { name: 'Future', relationship: 'child', dob: future },
    ],
  });
  assert.equal(r.success, false);
});

// 13
test('duplicate (name, dob) pair → fails', () => {
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    covered_members: [
      { name: 'Mohammed', relationship: 'child', dob: '2010-01-01' },
      { name: 'mohammed', relationship: 'child', dob: '2010-01-01' },
    ],
  });
  assert.equal(r.success, false);
});

// 14
test('duplicate name with different DOB → ok', () => {
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    plan: 'family',
    covered_members: [
      { name: 'Mohammed', relationship: 'child', dob: '2010-01-01' },
      { name: 'Mohammed', relationship: 'child', dob: '2012-06-15' },
    ],
  });
  assert.equal(r.success, true);
});

// 15
test('unknown field rejected by .strict() → fails', () => {
  const r = subscribeShieldSchema.safeParse({
    ...happy,
    secret_marketing_optin: true,
  });
  assert.equal(r.success, false);
});

// 16
test('activate: valid UUID → ok', () => {
  const r = activateSubscriptionSchema.safeParse({
    subscription_id: '11111111-2222-4333-8444-555555555555',
  });
  assert.equal(r.success, true);
});

// 17
test('activate: malformed UUID → fails', () => {
  const r = activateSubscriptionSchema.safeParse({
    subscription_id: 'not-a-uuid',
  });
  assert.equal(r.success, false);
});

// 18
test('activate: missing subscription_id → fails', () => {
  const r = activateSubscriptionSchema.safeParse({});
  assert.equal(r.success, false);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
