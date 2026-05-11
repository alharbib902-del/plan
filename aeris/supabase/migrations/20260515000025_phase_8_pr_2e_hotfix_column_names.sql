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
-- broken RPCs to swap `consumed_at` for `used_at`.
--
-- ACL discipline (Codex round 1 PR #53 P2 fix): although
-- CREATE OR REPLACE FUNCTION preserves the GRANT/REVOKE
-- state from the prior definition, we restate the
-- service_role GRANT + the PUBLIC/anon/authenticated
-- REVOKE explicitly here so a future replay of this
-- hotfix on a partially-applied DB (disaster recovery,
-- fresh staging, manual ACL tampering) does not silently
-- ship a function with the wrong permissions. The PR #48
-- service_role-missing-GRANT incident is precisely the
-- failure mode this defends against — production-critical
-- cron RPCs deserve idempotent ACL re-affirmation in every
-- file that touches them.
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

-- Idempotent ACL re-affirmation (Codex round 1 PR #53 P2 fix).
REVOKE ALL ON FUNCTION cleanup_expired_otp_codes() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_otp_codes() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_otp_codes() TO service_role;


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

-- Idempotent ACL re-affirmation (Codex round 1 PR #53 P2 fix).
REVOKE ALL ON FUNCTION cleanup_expired_password_reset_tokens() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_password_reset_tokens() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_password_reset_tokens() TO service_role;
