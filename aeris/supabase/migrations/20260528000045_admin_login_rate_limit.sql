-- ============================================
-- AERIS - Admin Login Rate Limit
-- Migration: 20260528000045
-- ============================================
--
-- Durable, server-only ledger for /admin/login attempts. The app stores an
-- HMAC fingerprint of the caller identity, never the raw IP address.
-- RLS is enabled with no anon/authenticated policies; service_role writes
-- attempts from the Next.js Server Action.
-- ============================================

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_fingerprint  VARCHAR(64) NOT NULL,
  outcome            TEXT NOT NULL CHECK (
    outcome IN ('success', 'invalid_password', 'invalid_input', 'rate_limited')
  ),
  attempted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_actor_recent
  ON admin_login_attempts (actor_fingerprint, attempted_at DESC);

ALTER TABLE admin_login_attempts ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: anon/authenticated cannot read or write.

COMMENT ON TABLE admin_login_attempts IS
  'Admin login rate-limit ledger. Stores HMAC actor fingerprints, not raw IP addresses.';

CREATE OR REPLACE FUNCTION cleanup_old_admin_login_attempts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM admin_login_attempts
    WHERE attempted_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION cleanup_old_admin_login_attempts() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_old_admin_login_attempts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_admin_login_attempts() TO service_role;
