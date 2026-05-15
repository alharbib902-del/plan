/**
 * Phase 11 PR 1 — shared cargo type module.
 *
 * Re-exports the canonical cargo_* row types from
 * types/database.ts so PR 1-3 can import a single
 * Phase-11-scoped surface instead of reaching into the
 * 2,800+-line database.ts file.
 *
 * Hand-maintained until npm run db:types is wired to a
 * real Supabase project. Mirrors the SQL migration
 * 20260518000030_phase_11_pr_1_cargo_intake.sql.
 */

export type {
  CargoType,
  CargoRequestStatus,
  CargoOfferStatus,
  CargoEmailAlertStatusValue,
  CargoRequestRow,
  CargoRequestInsert,
  CargoRequestUpdate,
  CargoOfferRow,
  CargoOfferInsert,
  CargoOfferUpdate,
  CargoAircraftCapabilityRow,
  CargoAircraftCapabilityInsert,
  CargoAircraftCapabilityUpdate,
  CargoEmailAlertStatusRow,
  CargoEmailAlertStatusUpdate,
} from '@/types/database';
