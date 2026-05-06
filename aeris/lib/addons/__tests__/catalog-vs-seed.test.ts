/**
 * Phase 6.2 PR 1 — catalog parity test (Layer 1, no DB).
 *
 * Asserts that:
 *   1. The 20-row TS `ADDONS_CATALOG` constant in
 *      `lib/addons/catalog.ts` deep-equals the 20 rows
 *      seeded by File C
 *      (`supabase/migrations/20260508000009_phase_6_2_addon_catalog.sql`)
 *      field-for-field, after sorting both sides by
 *      subtype.
 *   2. The `booking_addons_subtype_check` IN clause inside
 *      File A
 *      (`supabase/migrations/20260508000007_phase_6_2_addons.sql`)
 *      enumerates exactly the same 20 subtype names.
 *
 * Codex iteration-8 P1 #3 fix: NO DB connection. The seed
 * file is parsed as plain text via the small SQL parser at
 * `parse-seed-sql.ts`. Runs in CI on every PR including
 * PR 1 itself; founder Probe 2b runs the post-deploy DB-side
 * parity check (Layer 2).
 *
 * Codex iteration-9 P1 #2 + iteration-10 P1 fix: this file
 * is wired into CI as a blocking step. PR 1 also adds:
 *   - `"test:addons": "tsx lib/addons/__tests__/catalog-vs-seed.test.ts"`
 *     in `aeris/package.json`.
 *   - A "Catalog parity" step in `.github/workflows/ci.yml`
 *     calling `npm run test:addons`.
 *
 * Run locally: `npm run test:addons` from the `aeris/`
 * directory. Exit code 0 on pass, 1 on parity drift.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADDONS_CATALOG,
  KNOWN_ADDON_SUBTYPES,
  type AddonCatalogEntry,
} from '@/lib/addons/catalog';

import { parseSeedSql, parseSubtypeCheck, type SeedRow } from './parse-seed-sql';

// ============================================================================
// Resolve migration file paths relative to this test file.
// ============================================================================

const here = dirname(fileURLToPath(import.meta.url));
// here = aeris/lib/addons/__tests__
// repo migrations = aeris/supabase/migrations
const MIGRATIONS_DIR = join(here, '..', '..', '..', 'supabase', 'migrations');

const FILE_A = join(MIGRATIONS_DIR, '20260508000007_phase_6_2_addons.sql');
const FILE_C = join(MIGRATIONS_DIR, '20260508000009_phase_6_2_addon_catalog.sql');

// ============================================================================
// Helpers
// ============================================================================

function sortBySubtype<T extends { subtype: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.subtype.localeCompare(b.subtype));
}

/**
 * The seeded SQL row uses `addon_type` as the column name;
 * the TS catalog uses `type`. Convert seed row → TS-shaped
 * object so deep-equal can compare them byte-for-byte.
 *
 * The TS catalog also has `suggested_for: string[]` which
 * doesn't have a SQL counterpart (suggestions are a UI-only
 * concern). The seed file omits it; the test ignores
 * `suggested_for` when comparing.
 */
function normalizeSeedRow(row: SeedRow): Omit<AddonCatalogEntry, 'suggested_for'> {
  return {
    type: row.addon_type as AddonCatalogEntry['type'],
    subtype: row.subtype as string,
    label_ar: row.label_ar as string,
    label_en: row.label_en as string,
    description_ar: row.description_ar as string,
    description_en: row.description_en as string,
    unit_price_sar: row.unit_price_sar as number,
    unit_price_min_sar: row.unit_price_min_sar as number,
    unit_price_max_sar: row.unit_price_max_sar as number,
    per_passenger: row.per_passenger as boolean,
    commission_rate_pct: row.commission_rate_pct as number,
    allow_quantity: row.allow_quantity as boolean,
    free: row.free as boolean,
    advisor_ref: (row.advisor_ref as string | null) ?? undefined,
  };
}

function normalizeTsEntry(
  entry: AddonCatalogEntry
): Omit<AddonCatalogEntry, 'suggested_for'> {
  // Strip suggested_for to match the seed row shape (the
  // suggestion list is a UI-only concern with no SQL
  // counterpart).
  return {
    type: entry.type,
    subtype: entry.subtype,
    label_ar: entry.label_ar,
    label_en: entry.label_en,
    description_ar: entry.description_ar,
    description_en: entry.description_en,
    unit_price_sar: entry.unit_price_sar,
    unit_price_min_sar: entry.unit_price_min_sar,
    unit_price_max_sar: entry.unit_price_max_sar,
    per_passenger: entry.per_passenger,
    commission_rate_pct: entry.commission_rate_pct,
    allow_quantity: entry.allow_quantity,
    free: entry.free,
    advisor_ref: entry.advisor_ref,
  };
}

// ============================================================================
// Assertions
// ============================================================================

function assertCatalogMatchesSeed(): void {
  const seedText = readFileSync(FILE_C, 'utf8');
  const seedRows = parseSeedSql(seedText);

  // Length parity.
  assert.equal(
    seedRows.length,
    ADDONS_CATALOG.length,
    `Catalog length mismatch: TS=${ADDONS_CATALOG.length}, seed=${seedRows.length}`
  );

  const sortedTs = sortBySubtype(ADDONS_CATALOG.map(normalizeTsEntry));
  const sortedSeed = sortBySubtype(seedRows.map(normalizeSeedRow));

  for (let i = 0; i < sortedTs.length; i++) {
    assert.deepStrictEqual(
      sortedSeed[i],
      sortedTs[i],
      `Catalog drift at subtype "${sortedTs[i].subtype}":\n` +
        `  TS:   ${JSON.stringify(sortedTs[i])}\n` +
        `  seed: ${JSON.stringify(sortedSeed[i])}`
    );
  }
}

function assertCheckConstraintMatchesCatalog(): void {
  const fileAText = readFileSync(FILE_A, 'utf8');
  const checkSubtypes = parseSubtypeCheck(fileAText);

  const sortedCheck = [...checkSubtypes].sort();
  const sortedCatalog = [...KNOWN_ADDON_SUBTYPES].sort();

  assert.deepStrictEqual(
    sortedCheck,
    sortedCatalog,
    'booking_addons_subtype_check IN clause does not match KNOWN_ADDON_SUBTYPES.\n' +
      `  CHECK:   ${JSON.stringify(sortedCheck)}\n` +
      `  catalog: ${JSON.stringify(sortedCatalog)}`
  );
}

// ============================================================================
// Run
// ============================================================================

try {
  assertCatalogMatchesSeed();
  assertCheckConstraintMatchesCatalog();
  // eslint-disable-next-line no-console
  console.log(
    `[catalog-vs-seed] OK — ${ADDONS_CATALOG.length} catalog rows match seed + CHECK constraint.`
  );
  process.exit(0);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[catalog-vs-seed] FAIL`);
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
