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
  // Phase 8 PR 2a — 17 operator-account RPC Args/Result
  // pairs. Re-exported here so PR 2b (admin) + PR 2c
  // (operator portal) + PR 2d (notifications) can import a
  // single Phase-8-scoped surface mirroring the Phase 7
  // PR 2a alias-layer ritual. The 2 internal helpers
  // (`_normalize_operator_email`, `_is_sha256_hex` — the
  // latter added in Codex round-3 P2 #1 fix) are REVOKEd
  // from every role and intentionally NOT exposed here.
  OperatorSignupArgs,
  OperatorSignupError,
  OperatorSignupResult,
  OperatorLoginLookupArgs,
  OperatorLoginLookupError,
  OperatorLoginLookupResult,
  OperatorLoginCreateSessionArgs,
  OperatorLoginCreateSessionError,
  OperatorLoginCreateSessionResult,
  OperatorLogoutArgs,
  OperatorLogoutResult,
  OperatorSessionValidateArgs,
  OperatorSessionValidateError,
  OperatorSessionValidateResult,
  AdminApproveOperatorArgs,
  AdminApproveOperatorError,
  AdminApproveOperatorResult,
  AdminRejectOperatorArgs,
  AdminRejectOperatorError,
  AdminRejectOperatorResult,
  AdminSuspendOperatorArgs,
  AdminSuspendOperatorError,
  AdminSuspendOperatorResult,
  AdminUnsuspendOperatorArgs,
  AdminUnsuspendOperatorError,
  AdminUnsuspendOperatorResult,
  AdminSetOperatorDocumentsArgs,
  AdminSetOperatorDocumentsError,
  AdminSetOperatorDocumentsResult,
  AdminResetOperatorPasswordArgs,
  AdminResetOperatorPasswordError,
  AdminResetOperatorPasswordResult,
  MintOperatorPasswordResetTokenArgs,
  MintOperatorPasswordResetTokenResult,
  VerifyOperatorPasswordResetArgs,
  VerifyOperatorPasswordResetError,
  VerifyOperatorPasswordResetResult,
  MintOperatorOtpArgs,
  MintOperatorOtpError,
  MintOperatorOtpResult,
  VerifyOperatorOtpArgs,
  VerifyOperatorOtpError,
  VerifyOperatorOtpResult,
  ConvertPhase7StubToOperatorArgs,
  ConvertPhase7StubToOperatorError,
  ConvertPhase7StubToOperatorResult,
  ConsumeOperatorWelcomeTokenArgs,
  ConsumeOperatorWelcomeTokenError,
  ConsumeOperatorWelcomeTokenResult,
} from '@/types/database';
