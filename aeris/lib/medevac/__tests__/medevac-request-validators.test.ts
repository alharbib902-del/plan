/**
 * Phase 12 PR 1 — Zod schema tests for medevac intake.
 *
 * Layer-1 (no DB): pure schema parses for both public + authed
 * surfaces. Runs as: npm run test:medevac-request-validators
 *
 * Cases covered (22 total):
 *   Public schema (D1 severity gate + happy path):
 *     1. happy path (stable + valid fields) → ok
 *     2. severity='moderate' → fails (severity_requires_account)
 *     3. severity='critical' → fails
 *     4. severity missing → fails
 *   Required-field guards:
 *     5. patient_name missing → fails
 *     6. contact_name missing → fails
 *     7. contact_phone missing → fails
 *     8. from_location_freeform missing → fails
 *     9. to_hospital_name missing → fails
 *    10. estimated_value_sar missing → fails
 *    11. service_level missing → fails
 *   Length bounds (mirror §3.1 caps):
 *    12. patient_name length 201 → fails
 *    13. contact_phone length 21 → fails
 *    14. from_iata length 5 → fails
 *   Whitespace handling:
 *    15. patient_name = "   " → fails as missing
 *    16. patient_name padded "  Ahmed  " → ok and trimmed in output
 *   Value guards:
 *    17. estimated_value_sar = 0 → fails
 *    18. patient_age = -1 → fails
 *    19. patient_age = 200 → fails
 *    20. contact_email = "not-an-email" → fails
 *   Authed schema:
 *    21. authed severity='critical' happy path → ok
 *    22. authed severity='moderate' happy path → ok
 */

import { strict as assert } from 'node:assert';

import {
  medevacRequestPublicSchema,
  medevacRequestAuthedSchema,
} from '@/lib/medevac/validators/medevac-request';

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
console.log('\n[medevac-request-validators] running …\n');

const happyPublic = {
  patient_name: 'Ahmed Al-Test',
  patient_age: 45,
  contact_name: 'Family Contact',
  contact_phone: '+966500000000',
  contact_email: 'family@example.com',
  condition_severity: 'stable' as const,
  service_level: 'BMT' as const,
  from_location_freeform: 'Riyadh General Hospital',
  from_iata: 'RUH',
  to_hospital_name: 'King Faisal Specialist Hospital — Jeddah',
  to_hospital_contact_phone: '+966200000000',
  to_hospital_freeform_address: 'Jeddah',
  to_iata: 'JED',
  insurance_provider: 'Bupa Arabia',
  insurance_claim_ref: 'CL-12345',
  estimated_value_sar: 75000,
};

const happyAuthed = {
  patient_name: 'Critical Patient',
  patient_age: 60,
  contact_name: 'Spouse',
  contact_phone: '+966512345678',
  contact_email: null,
  condition_severity: 'critical' as const,
  service_level: 'CCT' as const,
  from_location_freeform: 'Dammam',
  from_iata: 'DMM',
  to_hospital_name: 'King Faisal Specialist Hospital — Riyadh',
  to_hospital_contact_phone: null,
  to_hospital_freeform_address: null,
  to_iata: 'RUH',
  insurance_provider: null,
  insurance_claim_ref: null,
  estimated_value_sar: 200000,
};

// 1
test('public happy path (stable + valid fields)', () => {
  const result = medevacRequestPublicSchema.safeParse(happyPublic);
  assert.equal(result.success, true);
});

// 2
test("public severity='moderate' fails (severity_requires_account)", () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    condition_severity: 'moderate',
  });
  assert.equal(result.success, false);
});

// 3
test("public severity='critical' fails", () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    condition_severity: 'critical',
  });
  assert.equal(result.success, false);
});

// 4
test('public severity missing fails', () => {
  const { condition_severity: _drop, ...payload } = happyPublic;
  const result = medevacRequestPublicSchema.safeParse(payload);
  assert.equal(result.success, false);
});

// 5
test('public patient_name missing fails', () => {
  const { patient_name: _drop, ...payload } = happyPublic;
  const result = medevacRequestPublicSchema.safeParse(payload);
  assert.equal(result.success, false);
});

// 6
test('public contact_name missing fails', () => {
  const { contact_name: _drop, ...payload } = happyPublic;
  const result = medevacRequestPublicSchema.safeParse(payload);
  assert.equal(result.success, false);
});

// 7
test('public contact_phone missing fails', () => {
  const { contact_phone: _drop, ...payload } = happyPublic;
  const result = medevacRequestPublicSchema.safeParse(payload);
  assert.equal(result.success, false);
});

// 8
test('public from_location_freeform missing fails', () => {
  const { from_location_freeform: _drop, ...payload } = happyPublic;
  const result = medevacRequestPublicSchema.safeParse(payload);
  assert.equal(result.success, false);
});

// 9
test('public to_hospital_name missing fails', () => {
  const { to_hospital_name: _drop, ...payload } = happyPublic;
  const result = medevacRequestPublicSchema.safeParse(payload);
  assert.equal(result.success, false);
});

// 10
test('public estimated_value_sar missing fails', () => {
  const { estimated_value_sar: _drop, ...payload } = happyPublic;
  const result = medevacRequestPublicSchema.safeParse(payload);
  assert.equal(result.success, false);
});

// 11
test('public service_level missing fails', () => {
  const { service_level: _drop, ...payload } = happyPublic;
  const result = medevacRequestPublicSchema.safeParse(payload);
  assert.equal(result.success, false);
});

// 12
test('public patient_name length 201 fails', () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    patient_name: 'A'.repeat(201),
  });
  assert.equal(result.success, false);
});

// 13
test('public contact_phone length 21 fails', () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    contact_phone: '1'.repeat(21),
  });
  assert.equal(result.success, false);
});

// 14
test('public from_iata length 5 fails', () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    from_iata: 'RUHHH',
  });
  assert.equal(result.success, false);
});

// 15
test('public patient_name = "   " fails as missing', () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    patient_name: '   ',
  });
  assert.equal(result.success, false);
});

// 16
test('public patient_name padded "  Ahmed  " ok + trimmed', () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    patient_name: '  Ahmed Trimmed  ',
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.patient_name, 'Ahmed Trimmed');
  }
});

// 17
test('public estimated_value_sar = 0 fails', () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    estimated_value_sar: 0,
  });
  assert.equal(result.success, false);
});

// 18
test('public patient_age = -1 fails', () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    patient_age: -1,
  });
  assert.equal(result.success, false);
});

// 19
test('public patient_age = 200 fails', () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    patient_age: 200,
  });
  assert.equal(result.success, false);
});

// 20
test('public contact_email = "not-an-email" fails', () => {
  const result = medevacRequestPublicSchema.safeParse({
    ...happyPublic,
    contact_email: 'not-an-email',
  });
  assert.equal(result.success, false);
});

// 21
test("authed severity='critical' happy path ok", () => {
  const result = medevacRequestAuthedSchema.safeParse(happyAuthed);
  assert.equal(result.success, true);
});

// 22
test("authed severity='moderate' happy path ok", () => {
  const result = medevacRequestAuthedSchema.safeParse({
    ...happyAuthed,
    condition_severity: 'moderate',
  });
  assert.equal(result.success, true);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
