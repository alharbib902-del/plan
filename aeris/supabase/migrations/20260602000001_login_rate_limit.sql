-- SEC-02 — client + operator login rate-limit.
--
-- Reuses the existing public-action rate-limit ledger
-- (public_action_attempts) added in 20260528000046: same table, index,
-- 7-day cleanup, and deny-all RLS. The only change is widening the two
-- CHECK constraints so the generic limiter can record login attempts,
-- so brute-force / credential-stuffing on the public client + operator
-- login forms is throttled the same way the intake forms already are.
--
-- No new table. Constraint names are Postgres's default for an inline
-- single-column CHECK ({table}_{column}_check); DROP ... IF EXISTS keeps
-- this idempotent and safe to re-run.

ALTER TABLE public_action_attempts
  DROP CONSTRAINT IF EXISTS public_action_attempts_action_check;
ALTER TABLE public_action_attempts
  ADD CONSTRAINT public_action_attempts_action_check CHECK (
    action IN (
      'flight_request',
      'empty_leg_reserve',
      'cargo_intake',
      'medevac_intake',
      'client_login',
      'operator_login'
    )
  );

ALTER TABLE public_action_attempts
  DROP CONSTRAINT IF EXISTS public_action_attempts_outcome_check;
ALTER TABLE public_action_attempts
  ADD CONSTRAINT public_action_attempts_outcome_check CHECK (
    outcome IN (
      'success',
      'rate_limited',
      'validation_failed',
      'rpc_error',
      'honeypot',
      'auth_failed'
    )
  );

COMMENT ON TABLE public_action_attempts IS
  'Public-action + login rate-limit ledger. Stores HMAC actor fingerprints, not raw IP addresses. Cleaned to 7 days by cleanup_old_public_action_attempts().';
