/**
 * Phase 13 PR 1 — tests for ForceTierInputSchema (Zod) used by
 * forceTierChangeAction Server Action.
 *
 * Runs as: npm run test:privilege-admin-validators
 *
 * Coverage:
 *   - client_id: UUID validation
 *   - new_tier: enum validation
 *   - reason: length 10-500 trim
 *   - lock_until: YYYY-MM-DD pattern or null
 */

import { strict as assert } from 'node:assert';
import { z } from 'zod';

import { isUuid } from '@/lib/utils/uuid';

// Re-derive the schema inline (mirror app/actions/privilege-admin.ts)
// rather than importing the action (which is 'use server' — can't
// import in unit tests).
const ForceTierInputSchema = z.object({
  client_id: z.string().refine(isUuid, {
    message: 'client_id must be a valid UUID',
  }),
  new_tier: z.enum(['silver', 'gold', 'platinum', 'diamond']),
  reason: z
    .string()
    .trim()
    .min(10, 'Reason must be at least 10 characters')
    .max(500, 'Reason must be at most 500 characters'),
  lock_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'lock_until must be YYYY-MM-DD')
    .nullable()
    .optional(),
});

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    failed += 1;
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

const VALID_UUID = '12345678-1234-1234-1234-1234567890ab';
const VALID_REASON = 'Strategic account onboarding for Q3 2026';

console.log('ForceTierInputSchema — happy paths');

test('valid input with all fields', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'platinum',
    reason: VALID_REASON,
    lock_until: '2027-05-19',
  });
  assert.equal(r.success, true);
});

test('valid input with lock_until null', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason: VALID_REASON,
    lock_until: null,
  });
  assert.equal(r.success, true);
});

test('valid input without lock_until (optional)', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'diamond',
    reason: VALID_REASON,
  });
  assert.equal(r.success, true);
});

console.log('ForceTierInputSchema — UUID validation');

test('rejects invalid UUID', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: 'not-a-uuid',
    new_tier: 'gold',
    reason: VALID_REASON,
  });
  assert.equal(r.success, false);
});

test('rejects empty UUID', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: '',
    new_tier: 'gold',
    reason: VALID_REASON,
  });
  assert.equal(r.success, false);
});

console.log('ForceTierInputSchema — tier validation');

test('rejects invalid tier', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'bronze',
    reason: VALID_REASON,
  });
  assert.equal(r.success, false);
});

test('rejects uppercase tier', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'GOLD',
    reason: VALID_REASON,
  });
  assert.equal(r.success, false);
});

test('accepts all 4 valid tiers', () => {
  for (const t of ['silver', 'gold', 'platinum', 'diamond']) {
    const r = ForceTierInputSchema.safeParse({
      client_id: VALID_UUID,
      new_tier: t,
      reason: VALID_REASON,
    });
    assert.equal(r.success, true, `tier ${t} should be valid`);
  }
});

console.log('ForceTierInputSchema — reason length');

test('rejects reason < 10 chars', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason: 'short',
  });
  assert.equal(r.success, false);
});

test('rejects reason of exactly 9 chars', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason: '123456789',
  });
  assert.equal(r.success, false);
});

test('accepts reason of exactly 10 chars', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason: '1234567890',
  });
  assert.equal(r.success, true);
});

test('accepts reason of exactly 500 chars', () => {
  const reason = 'a'.repeat(500);
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason,
  });
  assert.equal(r.success, true);
});

test('rejects reason > 500 chars', () => {
  const reason = 'a'.repeat(501);
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason,
  });
  assert.equal(r.success, false);
});

test('trims reason before length check', () => {
  // 8 chars + 5 whitespace = 13 total but trim removes whitespace
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason: '   short    ',
  });
  assert.equal(r.success, false); // 'short' is 5 chars after trim
});

console.log('ForceTierInputSchema — lock_until format');

test('accepts valid YYYY-MM-DD', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason: VALID_REASON,
    lock_until: '2027-12-31',
  });
  assert.equal(r.success, true);
});

test('rejects MM/DD/YYYY format', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason: VALID_REASON,
    lock_until: '12/31/2027',
  });
  assert.equal(r.success, false);
});

test('rejects ISO timestamp', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason: VALID_REASON,
    lock_until: '2027-12-31T00:00:00Z',
  });
  assert.equal(r.success, false);
});

test('rejects garbage string', () => {
  const r = ForceTierInputSchema.safeParse({
    client_id: VALID_UUID,
    new_tier: 'gold',
    reason: VALID_REASON,
    lock_until: 'not-a-date',
  });
  assert.equal(r.success, false);
});

console.log('');
console.log(`Result: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
