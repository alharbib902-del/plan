-- ============================================
-- AERIS - Admin MFA Challenge Rate Limit
-- Migration: 20260528000050
-- ============================================
--
-- Round-1 P1 fix on PR #92: the MFA challenge endpoint was
-- unthrottled. A leaked password gave an attacker a 7-day
-- pending session in which they could brute-force a 6-digit
-- TOTP at the network's max RPS.
--
-- Two changes:
--   1. Extend admin_login_attempts.outcome CHECK to include
--      'password_ok_pending_mfa' so signIn can record that
--      the password step succeeded without misleadingly
--      writing 'success' before the second factor lands.
--   2. New admin_mfa_challenge_attempts ledger, keyed by
--      (actor_fingerprint, admin_user_id), so the MFA step
--      gets its own throttle + audit trail.
--
-- Both tables: RLS deny-by-default. service_role-only writes.
-- ============================================

-- --------------------------------------------
-- 1. Extend admin_login_attempts.outcome CHECK
-- --------------------------------------------

ALTER TABLE admin_login_attempts
  DROP CONSTRAINT IF EXISTS admin_login_attempts_outcome_check;

ALTER TABLE admin_login_attempts
  ADD CONSTRAINT admin_login_attempts_outcome_check CHECK (
    outcome IN (
      'success',
      'invalid_password',
      'invalid_input',
      'rate_limited',
      'password_ok_pending_mfa'
    )
  );

COMMENT ON COLUMN admin_login_attempts.outcome IS
  'success = full login complete (no MFA OR MFA-included flow). password_ok_pending_mfa = password verified, MFA still required (separate ledger admin_mfa_challenge_attempts tracks MFA outcomes). invalid_password / invalid_input / rate_limited as before.';

-- --------------------------------------------
-- 2. admin_mfa_challenge_attempts
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS admin_mfa_challenge_attempts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Same HMAC fingerprint pattern as admin_login_attempts so
  -- triage can JOIN by actor across both ledgers.
  actor_fingerprint  VARCHAR(64) NOT NULL,
  admin_user_id      UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  outcome            TEXT NOT NULL CHECK (
    outcome IN (
      'success',
      'invalid_otp',
      'invalid_recovery',
      'replay_same_step',
      'rate_limited',
      'no_active_mfa',
      'invalid_input',
      'storage_error'
    )
  ),
  attempted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_challenge_attempts_recent
  ON admin_mfa_challenge_attempts
     (actor_fingerprint, admin_user_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_challenge_attempts_per_admin
  ON admin_mfa_challenge_attempts (admin_user_id, attempted_at DESC);

ALTER TABLE admin_mfa_challenge_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE admin_mfa_challenge_attempts IS
  'Per-(actor_fingerprint, admin_user_id) MFA challenge ledger. Throttles brute-force of TOTP or recovery codes after the password layer has been crossed. Stores HMAC fingerprints, not raw IPs.';

-- --------------------------------------------
-- 3. Cleanup function (mirrors admin_login_attempts pattern)
-- --------------------------------------------

CREATE OR REPLACE FUNCTION cleanup_old_admin_mfa_challenge_attempts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM admin_mfa_challenge_attempts
    WHERE attempted_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION cleanup_old_admin_mfa_challenge_attempts() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_old_admin_mfa_challenge_attempts()
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_admin_mfa_challenge_attempts()
  TO service_role;
