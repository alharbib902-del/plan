-- ============================================
-- AERIS - Admin Accounts Schema (Option B Phase 1a)
-- Migration: 20260528000047
-- ============================================
--
-- Lays the foundation for replacing the shared admin password
-- with per-admin accounts. ADDITIVE ONLY — the existing
-- `aeris_admin` cookie-based login (shared ADMIN_INBOX_PASSWORD)
-- still works after this migration ships. The next PR cuts the
-- login UI over to use these tables and removes the shared path.
--
-- Tables:
--   admin_users          — individual admin accounts (email +
--                          bcrypt password hash + role + status).
--   admin_user_sessions  — per-user durable session ledger so a
--                          founder can revoke an individual admin
--                          without rotating the global secret.
--
-- RLS deny-by-default — anon/authenticated cannot read or write.
-- Server Actions go through service_role only.
-- ============================================

-- --------------------------------------------
-- 1. admin_users
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS admin_users (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                       TEXT NOT NULL,
  password_hash               TEXT NOT NULL,
  full_name                   TEXT NOT NULL,
  role                        TEXT NOT NULL DEFAULT 'admin' CHECK (
    role IN ('owner', 'admin', 'support')
  ),
  status                      TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'disabled')
  ),
  must_change_password        BOOLEAN NOT NULL DEFAULT false,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_admin_user_id    UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  last_login_at               TIMESTAMPTZ,
  disabled_at                 TIMESTAMPTZ,
  disabled_by_admin_user_id   UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  CONSTRAINT admin_users_email_lowercase
    CHECK (email = LOWER(email)),
  CONSTRAINT admin_users_email_format
    CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT admin_users_disabled_consistent
    CHECK (
      (status = 'disabled' AND disabled_at IS NOT NULL) OR
      (status = 'active' AND disabled_at IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_email
  ON admin_users (email);
CREATE INDEX IF NOT EXISTS idx_admin_users_status
  ON admin_users (status, created_at DESC);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies — service_role bypasses RLS.

COMMENT ON TABLE admin_users IS
  'Per-admin accounts (Option B). Replaces the shared ADMIN_INBOX_PASSWORD in a follow-up PR. Email is stored lowercase + format-checked. Disabled accounts cannot create sessions.';

-- --------------------------------------------
-- 2. admin_user_sessions
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS admin_user_sessions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_user_id            UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  -- SHA256 of the raw cookie secret (never store raw tokens).
  token_hash               VARCHAR(64) NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at               TIMESTAMPTZ NOT NULL,
  revoked_at               TIMESTAMPTZ,
  revoked_by_admin_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  last_seen_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent_snapshot      TEXT,
  -- Same HMAC fingerprint pattern as admin_login_attempts so the
  -- two ledgers can be joined for triage; raw IP never persisted.
  ip_fingerprint           VARCHAR(64),
  CONSTRAINT admin_user_sessions_expiry_after_creation
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_user_sessions_token_hash
  ON admin_user_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_user_sessions_active
  ON admin_user_sessions (admin_user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE admin_user_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE admin_user_sessions IS
  'Durable per-admin session ledger. Stores SHA256 token hashes only. Cleanup function below removes expired/revoked rows after 30 days.';

-- --------------------------------------------
-- 3. cleanup function (mirrors admin_login_attempts pattern)
-- --------------------------------------------

CREATE OR REPLACE FUNCTION cleanup_old_admin_user_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM admin_user_sessions
    WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days')
       OR (expires_at < NOW() - INTERVAL '30 days');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION cleanup_old_admin_user_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_old_admin_user_sessions() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_admin_user_sessions() TO service_role;

-- --------------------------------------------
-- 4. updated_at trigger pattern for admin_users
-- --------------------------------------------
--
-- Lightweight inline trigger (no shared utility helper exists
-- in this repo yet). Keeps last_login_at / disabled_at updates
-- explicit at the call site; this trigger only stamps a generic
-- "row touched" timestamp on column changes that need it.
-- Currently no column needs auto-stamping beyond what the app
-- writes explicitly, so no trigger is created here — left as a
-- comment for the next PR that adds password rotation tracking.

-- --------------------------------------------
-- 5. seed founder placeholder — INTENTIONALLY NOT DONE HERE
-- --------------------------------------------
--
-- The next PR (cutover) will run a one-shot seed via Server
-- Action or admin-only Edge Function that:
--   a. Reads ADMIN_FOUNDER_EMAIL + ADMIN_FOUNDER_NAME from env
--   b. Hashes the current ADMIN_INBOX_PASSWORD via bcrypt
--   c. INSERTs the founder row with role='owner', status='active',
--      must_change_password=true
--   d. Marks the cookie session schema for the migrated user
--
-- Doing the seed in the migration itself would require:
--   - Reading env from Postgres (DO blocks can't access process env)
--   - Hashing with bcrypt inside SQL (pgcrypto's bcrypt is fine
--     but couples the migration to a specific password)
--
-- Both undesirable. Deferring the seed to a TypeScript Server
-- Action keeps the migration deterministic + replay-safe.
