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

// PR 1 row + enum types
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
  // PR 2e — outbox row + event-type union
  EmptyLegEventType,
  EmptyLegEventsOutboxRow,
  EmptyLegEventsOutboxInsert,
  EmptyLegEventsOutboxUpdate,
  // Phase 8 PR 1 — operators table now exposed via
  // database.ts. Re-exported here so PR 2b's stub-conversion
  // RPC + admin pages have a single Empty-Legs-scoped surface
  // for operator types (mirrors the Phase 7 alias-layer ritual).
  OperatorRow,
  OperatorInsert,
  OperatorUpdate,
  OperatorSignupStatus,
} from '@/types/database';

// PR 2a RPC arg + result types
export type {
  PublishEmptyLegArgs,
  PublishEmptyLegError,
  PublishEmptyLegResult,
  UpdateEmptyLegPriceArgs,
  UpdateEmptyLegPriceError,
  UpdateEmptyLegPriceResult,
  ReserveEmptyLegArgs,
  ReserveEmptyLegError,
  ReserveEmptyLegResult,
  ConfirmEmptyLegReservationArgs,
  ConfirmEmptyLegReservationError,
  ConfirmEmptyLegReservationResult,
  ReleaseEmptyLegReservationArgs,
  ReleaseEmptyLegReservationError,
  ReleaseEmptyLegReservationResult,
  AdminReleaseEmptyLegReservationArgs,
  AdminReleaseEmptyLegReservationError,
  AdminReleaseEmptyLegReservationResult,
  CancelEmptyLegArgs,
  CancelEmptyLegError,
  CancelEmptyLegResult,
  ExpireEmptyLegReservationArgs,
  ExpireEmptyLegReservationResult,
  TickEmptyLegDutchAuctionArgs,
  TickEmptyLegDutchAuctionResult,
  AdminMarkEmptyLegSoldArgs,
  AdminMarkEmptyLegSoldError,
  AdminMarkEmptyLegSoldResult,
  PublishEmptyLegEventArgs,
  PublishEmptyLegEventResult,
  // PR 2e RPC — 12th SECURITY DEFINER public
  ExpireEmptyLegWindowArgs,
  ExpireEmptyLegWindowResult,
} from '@/types/database';
