/**
 * Phase 11 PR 1 — Zod schema tests for cargo intake.
 *
 * Layer-1 (no DB): pure schema parses for both public + authed
 * surfaces. Runs as: npm run test:cargo-request-validators
 *
 * Cases covered (19 total):
 *   Public schema discriminatedUnion (per-category required):
 *     1. horse with horse_count → ok
 *     2. horse without horse_count → fails
 *     3. luxury_car with make+model → ok
 *     4. luxury_car missing model → fails
 *     5. valuables with declared_value → ok
 *     6. valuables missing declared_value → fails
 *     7. other with description → ok
 *     8. other missing description → fails
 *   Cross-field guards:
 *     9. missing both origin_iata + origin_freeform → fails
 *    10. delivery_date_target before pickup_date → fails
 *    11. estimated_value_sar = 0 → fails
 *   Length bounds (round 8 P1 #1):
 *    12. customer_name length 121 → fails
 *    13. origin_iata length 5 → fails
 *   Whitespace handling (round 1 PR #65 P2 #3):
 *    14. customer_name = "   " → fails as missing
 *    15. car_make = "   " (luxury_car) → fails as missing
 *    16. other_description = "   " → fails as missing
 *    17. customer_name padded "  Test  " → ok and trimmed in output
 *   Authed schema:
 *    18. authed horse happy path (no customer fields)
 *    19. authed valuables happy path
 */

import { strict as assert } from 'node:assert';

import {
  cargoRequestPublicSchema,
  cargoRequestAuthedSchema,
} from '@/lib/cargo/validators/cargo-request';

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
console.log('\n[cargo-request-validators] running …\n');

// Shared helpers
const baseHorse = {
  cargo_type: 'horse' as const,
  customer_name: 'Test Customer',
  customer_phone: '+966500000000',
  origin_iata: 'RUH',
  destination_iata: 'JED',
  pickup_date: '2026-06-01',
  estimated_value_sar: 250000,
  horse_count: 2,
};

const baseLuxuryCar = {
  cargo_type: 'luxury_car' as const,
  customer_name: 'Test',
  customer_phone: '+966500000001',
  origin_freeform: 'Riyadh hangar',
  destination_freeform: 'Jeddah hangar',
  pickup_date: '2026-06-01',
  estimated_value_sar: 800000,
  car_make: 'Ferrari',
  car_model: 'F40',
};

const baseValuables = {
  cargo_type: 'valuables' as const,
  customer_name: 'Test',
  customer_phone: '+966500000002',
  origin_iata: 'RUH',
  destination_iata: 'PAR',
  pickup_date: '2026-06-01',
  estimated_value_sar: 500000,
  valuables_declared_value_sar: 500000,
};

const baseOther = {
  cargo_type: 'other' as const,
  customer_name: 'Test',
  customer_phone: '+966500000003',
  origin_iata: 'RUH',
  destination_iata: 'JED',
  pickup_date: '2026-06-01',
  estimated_value_sar: 100000,
  other_description: 'Sensitive lab equipment',
};

// ============================================================
// Public schema — per-category discriminatedUnion
// ============================================================

test('horse with horse_count → ok', () => {
  const r = cargoRequestPublicSchema.safeParse(baseHorse);
  assert.equal(r.success, true);
});

test('horse without horse_count → fails', () => {
  const { horse_count, ...rest } = baseHorse;
  const r = cargoRequestPublicSchema.safeParse(rest);
  assert.equal(r.success, false);
});

test('luxury_car with make+model → ok', () => {
  const r = cargoRequestPublicSchema.safeParse(baseLuxuryCar);
  assert.equal(r.success, true);
});

test('luxury_car missing model → fails', () => {
  const { car_model, ...rest } = baseLuxuryCar;
  const r = cargoRequestPublicSchema.safeParse(rest);
  assert.equal(r.success, false);
});

test('valuables with declared_value → ok', () => {
  const r = cargoRequestPublicSchema.safeParse(baseValuables);
  assert.equal(r.success, true);
});

test('valuables missing declared_value → fails', () => {
  const { valuables_declared_value_sar, ...rest } = baseValuables;
  const r = cargoRequestPublicSchema.safeParse(rest);
  assert.equal(r.success, false);
});

test('other with description → ok', () => {
  const r = cargoRequestPublicSchema.safeParse(baseOther);
  assert.equal(r.success, true);
});

test('other missing description → fails', () => {
  const { other_description, ...rest } = baseOther;
  const r = cargoRequestPublicSchema.safeParse(rest);
  assert.equal(r.success, false);
});

// ============================================================
// Cross-field guards
// ============================================================

test('missing origin entirely → fails', () => {
  const r = cargoRequestPublicSchema.safeParse({
    ...baseHorse,
    origin_iata: undefined,
    origin_freeform: undefined,
  });
  assert.equal(r.success, false);
});

test('delivery_date_target before pickup → fails', () => {
  const r = cargoRequestPublicSchema.safeParse({
    ...baseHorse,
    delivery_date_target: '2026-05-01',
  });
  assert.equal(r.success, false);
});

test('estimated_value_sar = 0 → fails', () => {
  const r = cargoRequestPublicSchema.safeParse({
    ...baseHorse,
    estimated_value_sar: 0,
  });
  assert.equal(r.success, false);
});

// ============================================================
// Length bounds (round 8 P1 #1)
// ============================================================

test('customer_name length 121 → fails', () => {
  const r = cargoRequestPublicSchema.safeParse({
    ...baseHorse,
    customer_name: 'a'.repeat(121),
  });
  assert.equal(r.success, false);
});

test('origin_iata length 5 → fails', () => {
  const r = cargoRequestPublicSchema.safeParse({
    ...baseHorse,
    origin_iata: 'RUHXX',
  });
  assert.equal(r.success, false);
});

// ============================================================
// Whitespace handling (round 1 PR #65 P2 #3)
// ============================================================
// Without `.trim()` before `.min(1)`, a payload like "   " would
// pass length>0 and reach the DB as a blank-looking row. The
// round 1 fix wraps every required string with `.string().trim()`
// so whitespace-only fails as missing; the migration mirrors with
// BTRIM in NULLIF inside INSERT VALUES + guards.

test('customer_name = "   " → fails as missing', () => {
  const r = cargoRequestPublicSchema.safeParse({
    ...baseHorse,
    customer_name: '   ',
  });
  assert.equal(r.success, false);
});

test('car_make = "   " (luxury_car) → fails as missing', () => {
  const r = cargoRequestPublicSchema.safeParse({
    ...baseLuxuryCar,
    car_make: '   ',
  });
  assert.equal(r.success, false);
});

test('other_description = "   " → fails as missing', () => {
  const r = cargoRequestPublicSchema.safeParse({
    ...baseOther,
    other_description: '   ',
  });
  assert.equal(r.success, false);
});

test('customer_name padded "  Test  " → ok and trimmed', () => {
  const r = cargoRequestPublicSchema.safeParse({
    ...baseHorse,
    customer_name: '  Founder  ',
  });
  assert.equal(r.success, true);
  if (r.success) {
    // Confirm the surviving payload is trimmed (value is normalized
    // for the DB write — no leading/trailing whitespace lands).
    assert.equal(r.data.customer_name, 'Founder');
  }
});

// ============================================================
// Authed schema (no customer fields)
// ============================================================

test('authed horse happy path (no customer fields) → ok', () => {
  const r = cargoRequestAuthedSchema.safeParse({
    cargo_type: 'horse',
    origin_iata: 'RUH',
    destination_iata: 'JED',
    pickup_date: '2026-06-01',
    estimated_value_sar: 250000,
    horse_count: 2,
  });
  assert.equal(r.success, true);
});

test('authed valuables happy path → ok', () => {
  const r = cargoRequestAuthedSchema.safeParse({
    cargo_type: 'valuables',
    origin_iata: 'RUH',
    destination_iata: 'PAR',
    pickup_date: '2026-06-01',
    estimated_value_sar: 500000,
    valuables_declared_value_sar: 500000,
    valuables_security_level: 'high',
    valuables_climate_controlled: true,
  });
  assert.equal(r.success, true);
});

// eslint-disable-next-line no-console
console.log(`\n[cargo-request-validators] ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
