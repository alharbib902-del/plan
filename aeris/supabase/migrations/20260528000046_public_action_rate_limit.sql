-- ============================================
-- AERIS - Public Action Rate Limit
-- Migration: 20260528000046
-- ============================================
--
-- Durable ledger for anonymous public action attempts (flight
-- request, empty-leg reserve, cargo intake, medevac intake).
-- Mirrors the admin_login_attempts shape (PR #86) but scoped
-- per-action so an abusive IP on one form doesn't lock the
-- user out of the others.
--
-- The app stores an HMAC fingerprint of the caller identity
-- (IP + optional user-agent fallback), never the raw IP.
-- RLS is enabled with no anon/authenticated policies; the
-- Next.js Server Action writes via service_role only.
-- ============================================

CREATE TABLE IF NOT EXISTS public_action_attempts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action             TEXT NOT NULL CHECK (
    action IN (
      'flight_request',
      'empty_leg_reserve',
      'cargo_intake',
      'medevac_intake'
    )
  ),
  actor_fingerprint  VARCHAR(64) NOT NULL,
  outcome            TEXT NOT NULL CHECK (
    outcome IN (
      'success',
      'rate_limited',
      'validation_failed',
      'rpc_error',
      'honeypot'
    )
  ),
  attempted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_action_attempts_recent
  ON public_action_attempts (action, actor_fingerprint, attempted_at DESC);

ALTER TABLE public_action_attempts ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: anon/authenticated cannot read or write.

COMMENT ON TABLE public_action_attempts IS
  'Public-action rate-limit ledger. Stores HMAC actor fingerprints, not raw IP addresses. Cleaned to 7 days by cleanup_old_public_action_attempts().';

CREATE OR REPLACE FUNCTION cleanup_old_public_action_attempts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- 7-day retention is enough for the longest rate-limit
  -- window (1h) + audit-trail headroom for triage. Shorter
  -- than admin_login_attempts' 30 days because public-action
  -- volume is potentially much higher.
  DELETE FROM public_action_attempts
    WHERE attempted_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION cleanup_old_public_action_attempts() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_old_public_action_attempts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_public_action_attempts() TO service_role;
