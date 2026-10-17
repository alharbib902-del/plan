/**
 * Operator contact_phone normalisation — pure Zod test.
 *
 * Runs as `npm run test:operators-contact-phone-normalise`.
 *
 * Charter bookings are linked to an operator account by an EXACT
 * E.164 match of operators.contact_phone against the offer's
 * operator_phone (migration 20260719000001). Signup + profile update
 * must therefore store the canonical +9665… form, whatever the
 * operator typed.
 */

import { strict as assert } from 'node:assert';

import {
  operatorSignupSchema,
  operatorUpdateProfileSchema,
} from '@/lib/validators/operators';

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
console.log('\n[operators-contact-phone-normalise] running …\n');

const PROFILE = {
  company_name: 'Skybridge Aviation',
  contact_email: 'ops@skybridge.test',
};

const SIGNUP = {
  ...PROFILE,
  email: 'login@skybridge.test',
  password: 'Sky-bridge-2026',
  notes: null,
};

function profilePhone(contact_phone: string): string | null {
  const parsed = operatorUpdateProfileSchema.safeParse({
    ...PROFILE,
    contact_phone,
  });
  return parsed.success ? parsed.data.contact_phone : null;
}

test('Saudi local / international spellings all store as one E.164 value', () => {
  for (const typed of [
    '0501234567',
    '050 123 4567',
    '+966 50 123 4567',
    '00966501234567',
    '966501234567',
    '+966-50-123-4567',
  ]) {
    assert.equal(profilePhone(typed), '+966501234567', typed);
  }
});

test('non-Saudi E.164 numbers pass through unchanged', () => {
  assert.equal(profilePhone('+971501234567'), '+971501234567');
});

test('garbage / too-short / non-E.164 input is rejected', () => {
  for (const typed of ['abcdefg', '123', '+0501234567', '------']) {
    assert.equal(profilePhone(typed), null, typed);
  }
});

test('signup stores the normalised phone too', () => {
  const parsed = operatorSignupSchema.safeParse({
    ...SIGNUP,
    contact_phone: '0501234567',
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  if (parsed.success) {
    assert.equal(parsed.data.contact_phone, '+966501234567');
  }
});

test('an invalid phone surfaces as a contact_phone field error', () => {
  const parsed = operatorSignupSchema.safeParse({
    ...SIGNUP,
    contact_phone: 'not-a-phone',
  });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.ok(
      parsed.error.issues.some((i) => i.path.join('.') === 'contact_phone')
    );
  }
});

// eslint-disable-next-line no-console
console.log(
  `\n[operators-contact-phone-normalise] ${passed} passed, ${failed} failed\n`
);
if (failed > 0) process.exit(1);
