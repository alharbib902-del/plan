/**
 * Phase 7 — shared Empty Leg type module.
 *
 * Re-exports the canonical row types from `types/database.ts`
 * so PR 2a-e can import a single Phase-7-scoped surface
 * instead of reaching into the 1000+-line database.ts file.
 *
 * Hand-maintained until `npm run db:types` is wired to a real
 * Supabase project. Mirrors the SQL migration
 * `supabase/migrations/20260509000010_phase_7_empty_legs_reshape.sql`.
 *
 * PR 1 ships this module + the migration + the auction-curve
 * formula + the parity test scaffold. PR 2a's RPCs import the
 * row types from here.
 */

export type {
  EmptyLegStatus,
  EmptyLegAuctionCurve,
  EmptyLegRow,
  EmptyLegInsert,
  EmptyLegUpdate,
  EmptyLegNotificationEventType,
  EmptyLegNotificationChannel,
  EmptyLegNotificationRow,
  EmptyLegNotificationInsert,
  EmptyLegNotificationUpdate,
  Phase7OperatorStubStatus,
  Phase7OperatorStubRow,
  Phase7OperatorStubInsert,
  Phase7OperatorStubUpdate,
  OperatorEmptyLegSessionRow,
  OperatorEmptyLegSessionInsert,
  OperatorEmptyLegSessionUpdate,
  EmptyLegOutreachAlertStatusValue,
  EmptyLegOutreachAlertStatusRow,
  EmptyLegOutreachAlertStatusUpdate,
} from '@/types/database';
