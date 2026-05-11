-- ============================================================
-- Phase 8 PR 2e — Cleanup cron RPCs + cron tick history
--
-- Sister to Phase 7's empty-legs cron layer. Phase 8 ships
-- 6 new tables (operator_sessions, operator_password_reset_tokens,
-- operator_otp_codes, operator_documents, operator_signup_attempts,
-- operator_notification_alert_status). Five of those six grow
-- monotonically as operators sign up + log in + reset
-- passwords + receive OTPs + try to sign up under rate limits.
-- Without periodic cleanup the row count grows unbounded
-- (TTL gates LOOKUP, not RETENTION; the rows themselves
-- linger forever).
--
-- This migration ships:
--   §1   _select_op_cron_owner   — internal SECURITY DEFINER
--                                  guard helper (mirrors
--                                  Phase 7 §0 Helper pattern)
--   §2   cleanup_expired_operator_sessions     — DELETE
--   §3   cleanup_expired_password_reset_tokens — DELETE
--   §4   cleanup_expired_otp_codes             — DELETE
--   §5   cleanup_old_signup_attempts           — DELETE
--   §6   operator_cron_tick_history            — observability
--   §7   record_operator_cron_tick             — INSERT helper
--
-- All cleanup RPCs follow the same shape: a plain
--   DELETE FROM <table> WHERE <expired-or-consumed-predicate>
-- followed by GET DIAGNOSTICS ROW_COUNT, returning
--   { ok: true, deleted_count: int }.
-- No explicit FOR UPDATE / SELECT-then-DELETE claim pattern
-- is needed: PostgreSQL's DELETE acquires a row-level lock
-- on each matching row before removing it, and the predicate
-- itself filters on monotonically-true conditions
-- (expired_at <= NOW(), consumed_at IS NOT NULL,
-- attempted_at < NOW() - INTERVAL ...). A concurrent INSERT
-- of a fresh row cannot match because its timestamps are in
-- the future relative to the cleanup window, so cron cannot
-- delete a row that signup just wrote.
--
-- Every public RPC is REVOKE ALL FROM anon, authenticated
-- (service_role only) — same posture as Phase 8 PR 2a +
-- the Phase 8 PR 2a hotfix migration.
-- ============================================================


-- ============================================================
-- §1 — Internal helper (illustrative; reserved for future use)
--
-- Stays as a placeholder so future cron-only RPCs that need
-- to assert "called via cron route only" can attach a check
-- here without further migration. Body intentionally minimal:
-- the cron routes already verify CRON_SECRET at the HTTP
-- boundary; adding a second check at the SQL boundary would
-- require threading a session-bound secret through every RPC,
-- which the Phase 7 empty-legs cron deliberately did NOT do.
-- ============================================================

CREATE OR REPLACE FUNCTION _operator_cron_marker()
  RETURNS BOOLEAN LANGUAGE sql IMMUTABLE
  SET search_path = public, pg_temp
AS $$
  SELECT TRUE;
$$;

REVOKE ALL ON FUNCTION _operator_cron_marker() FROM PUBLIC;
REVOKE ALL ON FUNCTION _operator_cron_marker() FROM anon, authenticated, service_role;


-- ============================================================
-- §2 — cleanup_expired_operator_sessions
--
-- operator_sessions.expires_at is set at session-mint time
-- (7 day default, 30 day with "تذكّرني"). After expiry the
-- row is unusable for auth (operator_session_validate
-- rejects expired hashes), but it stays in the table.
-- This RPC removes every row with expires_at <= NOW().
-- Also removes any row explicitly revoked
-- (revoked_at IS NOT NULL) since admin-suspend flows
-- already mark them — no LOOKUP path exists for revoked
-- rows so they have zero retention value.
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_operator_sessions()
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM operator_sessions
   WHERE expires_at <= NOW()
      OR revoked_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN json_build_object('ok', true, 'deleted_count', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION cleanup_expired_operator_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_operator_sessions() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_operator_sessions() TO service_role;


-- ============================================================
-- §3 — cleanup_expired_password_reset_tokens
--
-- operator_password_reset_tokens.expires_at is 30 minutes
-- past mint. consumed_at marks single-use redemption. Either
-- condition makes the row useless for further auth: the
-- verify RPC rejects expired/consumed hashes. Both buckets
-- can be deleted.
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
      OR consumed_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN json_build_object('ok', true, 'deleted_count', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION cleanup_expired_password_reset_tokens() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_password_reset_tokens() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_password_reset_tokens() TO service_role;


-- ============================================================
-- §4 — cleanup_expired_otp_codes
--
-- operator_otp_codes.expires_at is 10 minutes past mint
-- (the shortest TTL of any Phase 8 token surface). consumed_at
-- marks single-use redemption. The OTP cron runs more
-- frequently than the others (every 30 min vs 6 hours)
-- because OTP rows can accumulate quickly under admin
-- recovery flows.
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
      OR consumed_at IS NOT NULL;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN json_build_object('ok', true, 'deleted_count', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION cleanup_expired_otp_codes() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_otp_codes() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_otp_codes() TO service_role;


-- ============================================================
-- §5 — cleanup_old_signup_attempts
--
-- operator_signup_attempts is the rate-limit ledger:
-- operatorSignup writes a row per attempt (success +
-- duplicate_email + rate_limited + validation_failed).
-- The rate-limit window is 1 hour, so anything older than
-- 24 hours has zero operational value (kept the wider
-- window so admin canary can show 24h velocity, see PR 2e
-- §canary-readout).
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_old_signup_attempts()
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM operator_signup_attempts
   WHERE attempted_at < NOW() - INTERVAL '24 hours';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN json_build_object('ok', true, 'deleted_count', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION cleanup_old_signup_attempts() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_old_signup_attempts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_signup_attempts() TO service_role;


-- ============================================================
-- §6 — operator_cron_tick_history
--
-- Observability: every cron route writes a row after each
-- run. The admin canary readout queries the latest row per
-- job_name to show "last successful tick" + "deleted count
-- on last run". Without this table the founder has no UI
-- signal that the cron is alive — they would have to dig
-- into Vercel function logs.
--
-- Schema is intentionally narrow:
--   id           BIGSERIAL PRIMARY KEY
--   job_name     TEXT NOT NULL — matches the cron route slug
--                exactly so the query is a simple equality
--   ran_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   deleted_count INT NOT NULL DEFAULT 0
--   success      BOOLEAN NOT NULL DEFAULT TRUE — set FALSE
--                if the cron route caught an error before
--                the cleanup RPC ran
--   error_label  TEXT — short error tag when success=FALSE
--
-- The job_name CHECK constrains the value to the four known
-- jobs so a typo'd insert stands out. Adding a 5th job
-- requires a migration to extend the CHECK — intentional
-- friction.
--
-- Index: (job_name, ran_at DESC) so the canary "latest per
-- job" query is index-only.
-- ============================================================

CREATE TABLE IF NOT EXISTS operator_cron_tick_history (
  id              BIGSERIAL PRIMARY KEY,
  job_name        TEXT        NOT NULL
                              CHECK (job_name IN (
                                'cleanup_expired_operator_sessions',
                                'cleanup_expired_password_reset_tokens',
                                'cleanup_expired_otp_codes',
                                'cleanup_old_signup_attempts'
                              )),
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_count   INT         NOT NULL DEFAULT 0,
  success         BOOLEAN     NOT NULL DEFAULT TRUE,
  error_label     TEXT
);

CREATE INDEX IF NOT EXISTS idx_operator_cron_tick_history_job_ran
  ON operator_cron_tick_history (job_name, ran_at DESC);

ALTER TABLE operator_cron_tick_history ENABLE ROW LEVEL SECURITY;

-- No RLS policies: service_role bypasses RLS, and that is
-- the only role that ever writes/reads this table. anon +
-- authenticated have zero access by default once RLS is on
-- with no policies.


-- ============================================================
-- §7 — record_operator_cron_tick
--
-- Helper invoked by the cron route handler after the
-- cleanup RPC returns. Wrapping the INSERT in an RPC keeps
-- the route handler thin (one .rpc() call instead of
-- hand-rolling the INSERT contract) and gives a single
-- audit point if the schema changes.
--
-- Shape mirrors the cleanup RPCs: { ok, history_id }.
-- ============================================================

CREATE OR REPLACE FUNCTION record_operator_cron_tick(
  p_job_name        TEXT,
  p_deleted_count   INT,
  p_success         BOOLEAN,
  p_error_label     TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO operator_cron_tick_history (
    job_name,
    deleted_count,
    success,
    error_label
  ) VALUES (
    p_job_name,
    COALESCE(p_deleted_count, 0),
    COALESCE(p_success, TRUE),
    NULLIF(TRIM(p_error_label), '')
  ) RETURNING id INTO v_id;

  RETURN json_build_object('ok', true, 'history_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION record_operator_cron_tick(TEXT, INT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_operator_cron_tick(TEXT, INT, BOOLEAN, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION record_operator_cron_tick(TEXT, INT, BOOLEAN, TEXT) TO service_role;
