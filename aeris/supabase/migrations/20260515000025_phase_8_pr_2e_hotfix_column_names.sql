-- ============================================================
-- Phase 8 PR 2e hotfix #3 — Column-name correction in 2 cleanup
-- RPCs.
--
-- The original PR 2e migration
-- (20260515000024_phase_8_pr_2e_cleanup_rpcs.sql) wrote two
-- cleanup RPCs against a `consumed_at` column that does not
-- exist. The actual single-use marker column on both
-- `operator_otp_codes` and `operator_password_reset_tokens`
-- is `used_at` (per the Phase 8 PR 1 schema migration
-- 20260512000020_phase_8_operator_accounts.sql §3.7 + §3.6).
--
-- Production smoke test (manual curl of
-- /api/cron/operator/otp-codes after PR #51 deployed)
-- surfaced PostgreSQL error code 42703 ("undefined_column"),
-- recorded in operator_cron_tick_history with
--   error_label = 'rpc_error: 42703'.
--
-- The other two cleanup RPCs
-- (cleanup_expired_operator_sessions,
--  cleanup_old_signup_attempts) reference real columns
-- (revoked_at + attempted_at respectively) and are unchanged.
--
-- This migration uses CREATE OR REPLACE FUNCTION on the two
-- broken RPCs to swap `consumed_at` for `used_at`. GRANTs
-- + REVOKEs are preserved by CREATE OR REPLACE (they apply
-- to the function name, not the body).
-- ============================================================


-- ============================================================
-- §1 — cleanup_expired_otp_codes (was: consumed_at → used_at)
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_otp_codes()
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM operator_otp_codes
   WHERE expires_at <= NOW()
      OR used_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN json_build_object('ok', true, 'deleted_count', v_deleted);
END;
$$;


-- ============================================================
-- §2 — cleanup_expired_password_reset_tokens (was: consumed_at
--       → used_at)
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_password_reset_tokens()
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM operator_password_reset_tokens
   WHERE expires_at <= NOW()
      OR used_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN json_build_object('ok', true, 'deleted_count', v_deleted);
END;
$$;
