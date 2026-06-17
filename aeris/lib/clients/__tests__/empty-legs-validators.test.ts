/**
 * Phase 10 PR 1 — Zod schema tests for the 3 client-facing
 * empty-legs Server Actions.
 *
 * Layer-1 (no DB): pure schema parses. Runs as:
 *   npm run test:clients-empty-legs-validators
 *
 * Cases covered:
 *   reserveEmptyLegSchema (3):
 *     1. valid UUID → ok
 *     2. non-UUID string → fails
 *     3. missing field → fails
 *   cancelMyEmptyLegReservationSchema (2):
 *     4. valid UUID → ok
 *     5. extra unknown key → ignored (z.object default; not strict)
 *   notificationPreferencesSchema (5):
 *     6. valid full shape → ok
 *     7. missing empty_legs.email → fails
 *     8. extra unknown top-level key → fails (strict)
 *     9. extra unknown nested key → fails (strict on inner object)
 *    10. wrong type (string instead of boolean) → fails
 */

import { strict as assert } from 'node:assert';

import {
  reserveEmptyLegSchema,
  cancelMyEmptyLegReservationSchema,
  notificationPreferencesSchema,
} from '@/lib/validators/clients';

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
console.log('\n[clients-empty-legs-validators] running …\n');

// ============================================================
// reserveEmptyLegSchema
// ============================================================

test('reserve: valid UUID → ok', () => {
  const result = reserveEmptyLegSchema.safeParse({
    leg_id: '11111111-2222-3333-4444-555555555555',
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.leg_id, '11111111-2222-3333-4444-555555555555');
  }
});

test('reserve: non-UUID string → fails', () => {
  const result = reserveEmptyLegSchema.safeParse({
    leg_id: 'not-a-uuid',
  });
  assert.equal(result.success, false);
});

test('reserve: missing leg_id → fails', () => {
  const result = reserveEmptyLegSchema.safeParse({});
  assert.equal(result.success, false);
});

// ============================================================
// cancelMyEmptyLegReservationSchema
// ============================================================

test('cancel: valid UUID → ok', () => {
  const result = cancelMyEmptyLegReservationSchema.safeParse({
    leg_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  });
  assert.equal(result.success, true);
});

test('cancel: extra unknown key passes through (object not strict)', () => {
  // Cancel schema is not declared .strict() — extra keys are allowed
  // but stripped from result.data. This is intentional — only leg_id
  // matters for the §4.6 RPC, and a malicious payload with extra keys
  // can't smuggle anything because we only read parsed.data.leg_id.
  const result = cancelMyEmptyLegReservationSchema.safeParse({
    leg_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    extra: 'ignored',
  });
  assert.equal(result.success, true);
  if (result.success) {
    // Extra key not in result.data
    assert.equal('extra' in result.data, false);
  }
});

// ============================================================
// notificationPreferencesSchema
// ============================================================

test('prefs: valid full shape → ok', () => {
  const result = notificationPreferencesSchema.safeParse({
    empty_legs: { email: true, wa_link: false },
    marketing: false,
  });
  assert.equal(result.success, true);
});

test('prefs: missing empty_legs.email → fails', () => {
  const result = notificationPreferencesSchema.safeParse({
    empty_legs: { wa_link: true } as { wa_link: boolean },
    marketing: true,
  });
  assert.equal(result.success, false);
});

test('prefs: extra top-level key rejected (strict)', () => {
  const result = notificationPreferencesSchema.safeParse({
    empty_legs: { email: true, wa_link: true },
    marketing: false,
    rogue_category: { spam: true },
  });
  assert.equal(result.success, false);
});

test('prefs: extra nested key rejected (strict)', () => {
  const result = notificationPreferencesSchema.safeParse({
    empty_legs: { email: true, wa_link: true, sms: true },
    marketing: false,
  });
  assert.equal(result.success, false);
});

test('prefs: wrong type (string instead of boolean) → fails', () => {
  const result = notificationPreferencesSchema.safeParse({
    empty_legs: { email: 'true', wa_link: true },
    marketing: false,
  });
  assert.equal(result.success, false);
});

test('prefs: PR2 backward-compat — old payload WITHOUT push is valid', () => {
  const result = notificationPreferencesSchema.safeParse({
    empty_legs: { email: true, wa_link: true },
    marketing: false,
  });
  assert.equal(result.success, true);
});

test('prefs: new payload WITH push (boolean) is valid', () => {
  const result = notificationPreferencesSchema.safeParse({
    empty_legs: { email: true, wa_link: true, push: true },
    marketing: false,
  });
  assert.equal(result.success, true);
});

test('prefs: push wrong type (string) → fails', () => {
  const result = notificationPreferencesSchema.safeParse({
    empty_legs: { email: true, wa_link: true, push: 'true' },
    marketing: false,
  });
  assert.equal(result.success, false);
});

// eslint-disable-next-line no-console
console.log(
  `\n[clients-empty-legs-validators] ${passed} passed, ${failed} failed\n`
);

if (failed > 0) {
  process.exit(1);
}
