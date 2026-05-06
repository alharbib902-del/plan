/**
 * Pure IATA-format type-guard. Lives in lib/utils/ (not
 * lib/supabase/queries/airports.ts) because it must be
 * importable from BOTH server-only modules (validators,
 * Server Actions) AND client components (the operator-portal
 * trip summary uses it as the legacy-shape discriminator).
 *
 * Phase 6.0 PR 2 split this out from
 * lib/supabase/queries/airports.ts so the operator-portal
 * client surface can use it without dragging in `server-only`.
 *
 * No behavior change versus PR 1 — same regex, same return
 * shape. PR 1's airports.ts re-exports this for back-compat
 * with anything that already imports `isIataFormat` from
 * there.
 */

const IATA_PATTERN = /^[A-Z]{3}$/;

export function isIataFormat(value: unknown): value is string {
  return typeof value === 'string' && IATA_PATTERN.test(value);
}
