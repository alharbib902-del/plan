-- ============================================================
-- Phase 9 PR 1 — Client Auth (mirror of Phase 8 PR 2c
-- operator auth, adapted for the demand side)
--
-- Inventory (per docs/CLAUDE-TASK.md §3 + §4):
--   §3.1.a CREATE TYPE client_status (DO/IF NOT EXISTS)
--   §3.1.b CREATE TABLE clients
--   §3.2   CREATE TABLE client_sessions
--   §3.3   CREATE TABLE client_password_reset_tokens
--   §3.4   CREATE TABLE client_signup_attempts
--   §3.5   trip_requests.client_id index for /me/requests
--   §3.6   clients_audit_trigger
--   §3.7   client_notification_alert_status singleton
--   §3.9   operator_cron_tick_history CHECK extension
--          (PR 1 adds 3 client cleanup jobs)
--   §4.1   7 auth RPCs + 1 helper (_normalize_client_email)
--   §4.4   3 client cleanup RPCs
--          (the 4th, redispatch_stale_trip_requests, is PR 4)
--
-- Discipline (Phase 8 PR 2e #48 lessons):
--   - All RPCs use REVOKE ALL FROM PUBLIC + REVOKE FROM
--     anon, authenticated + GRANT EXECUTE TO service_role
--     (the helper goes further: REVOKE from service_role too).
--   - Token-hash inputs validated via Phase 8 _is_sha256_hex
--     (already on production; this migration only DEPENDS on
--     it, never re-defines it; ACL untouched).
--   - Idempotent: every CREATE uses IF NOT EXISTS or DO blocks;
--     CHECK extension uses DROP CONSTRAINT IF EXISTS + ADD.
-- ============================================================


-- ============================================================
-- §3.1.a — client_status enum (must run BEFORE CREATE TABLE
-- clients; see Phase 9 spec round 6 P1 #1 fix). Replay-safe
-- via DO block + schema-scoped pg_type check.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'client_status'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.client_status AS ENUM (
      'active',
      'suspended',
      'deleted'
    );
  END IF;
END $$;


-- ============================================================
-- §3.1.b — clients table
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_email               VARCHAR(120) NOT NULL,
  full_name                VARCHAR(120) NOT NULL,
  contact_phone            VARCHAR(20)  NOT NULL,
  password_hash            TEXT NOT NULL,
  password_must_change     BOOLEAN NOT NULL DEFAULT FALSE,
  signup_status            client_status NOT NULL DEFAULT 'active',
  last_login_at            TIMESTAMPTZ,
  marketing_opt_in         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_auth_email_lower
  ON clients (LOWER(auth_email));

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.2 — client_sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS client_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash      VARCHAR(64) NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  remember_me     BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address      INET,
  user_agent      TEXT,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_sessions_token_hash
  ON client_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_client_sessions_client_id
  ON client_sessions (client_id);

ALTER TABLE client_sessions ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.3 — client_password_reset_tokens
-- ============================================================

CREATE TABLE IF NOT EXISTS client_password_reset_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash      VARCHAR(64) NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_reset_tokens_hash
  ON client_password_reset_tokens (token_hash);

ALTER TABLE client_password_reset_tokens ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.4 — client_signup_attempts (anti-spam ledger)
-- ============================================================

CREATE TABLE IF NOT EXISTS client_signup_attempts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_address      INET NOT NULL,
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_attempted TEXT,
  result          TEXT NOT NULL CHECK (result IN ('success','duplicate_email','rate_limited','validation_failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_signup_attempts_ip_recent
  ON client_signup_attempts (ip_address, attempted_at DESC);

ALTER TABLE client_signup_attempts ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.5 — trip_requests.client_id supporting index for
-- /me/requests listing (Phase 9 spec §3.5)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_trip_requests_client_status
  ON trip_requests (client_id, status, created_at DESC)
  WHERE client_id IS NOT NULL;


-- ============================================================
-- §3.6 — clients audit trigger (signup_status + password_hash
-- transitions write to audit_logs)
-- ============================================================

CREATE OR REPLACE FUNCTION clients_audit_trigger()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.signup_status IS DISTINCT FROM NEW.signup_status THEN
    INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
      VALUES ('client', NEW.id, 'signup_status_changed',
              jsonb_build_object('signup_status', OLD.signup_status),
              jsonb_build_object('signup_status', NEW.signup_status));
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
      VALUES ('client', NEW.id, 'password_changed', NULL, NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_audit ON clients;
CREATE TRIGGER clients_audit AFTER UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION clients_audit_trigger();


-- ============================================================
-- §3.7 — client_notification_alert_status singleton
-- ============================================================

CREATE TABLE IF NOT EXISTS client_notification_alert_status (
  id                   INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status               TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'config_missing', 'send_failed')),
  last_failure_at      TIMESTAMPTZ,
  last_failure_reason  TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO client_notification_alert_status (id, status)
  VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE client_notification_alert_status ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.9 — operator_cron_tick_history CHECK extension
--
-- PR 1 adds 3 client cleanup job names to the CHECK list. The
-- 4th Phase 9 job (redispatch_stale_trip_requests) ships in
-- PR 4 with its own ALTER. Each PR restates the FULL
-- constraint for replay/DR self-containment (Codex round 2
-- P2 #2 split discipline).
-- ============================================================

ALTER TABLE operator_cron_tick_history
  DROP CONSTRAINT IF EXISTS operator_cron_tick_history_job_name_check;

ALTER TABLE operator_cron_tick_history
  ADD CONSTRAINT operator_cron_tick_history_job_name_check
  CHECK (job_name IN (
    -- Phase 8 PR 2e jobs (existing on production)
    'cleanup_expired_operator_sessions',
    'cleanup_expired_password_reset_tokens',
    'cleanup_expired_otp_codes',
    'cleanup_old_signup_attempts',
    -- Phase 9 PR 1 jobs (NEW)
    'cleanup_expired_client_sessions',
    'cleanup_expired_client_password_reset_tokens',
    'cleanup_old_client_signup_attempts'
  ));


-- ============================================================
-- §4.1 — 1 internal helper + 7 auth RPCs
-- ============================================================

-- _normalize_client_email — case-insensitive email
-- normalisation. REVOKE from anon/authenticated/service_role
-- (helper is callable only from inside SECURITY DEFINER bodies
-- via the function-owner role).

CREATE OR REPLACE FUNCTION _normalize_client_email(p_email TEXT)
  RETURNS TEXT
  LANGUAGE sql IMMUTABLE
  SET search_path = public, pg_temp
AS $$
  SELECT LOWER(TRIM(p_email));
$$;

REVOKE ALL ON FUNCTION _normalize_client_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION _normalize_client_email(TEXT) FROM anon, authenticated, service_role;


-- 1. client_signup
--
-- Atomic INSERT into clients + writes signup_attempts row.
-- Rate-limit: rejects when the IP has 3+ success attempts in
-- the last 24h. Other result values (duplicate_email,
-- validation_failed) do NOT count against the cap.

CREATE OR REPLACE FUNCTION client_signup(
  p_email                TEXT,
  p_password_hash        TEXT,
  p_full_name            TEXT,
  p_phone                TEXT,
  p_marketing_opt_in     BOOLEAN,
  p_ip                   INET
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_normalized   TEXT;
  v_client_id    UUID;
  v_recent_count INT;
BEGIN
  -- Validation: required fields present, basic shape
  IF NULLIF(TRIM(p_email), '') IS NULL
     OR NULLIF(TRIM(p_password_hash), '') IS NULL
     OR NULLIF(TRIM(p_full_name), '') IS NULL
     OR NULLIF(TRIM(p_phone), '') IS NULL
     OR p_ip IS NULL THEN
    INSERT INTO client_signup_attempts (ip_address, attempted_at, email_attempted, result)
      VALUES (COALESCE(p_ip, '0.0.0.0'::INET), NOW(), p_email, 'validation_failed');
    RETURN json_build_object('ok', false, 'error', 'validation_failed');
  END IF;

  v_normalized := _normalize_client_email(p_email);

  -- Rate limit: 3 success / IP / 24h
  SELECT COUNT(*) INTO v_recent_count
    FROM client_signup_attempts
   WHERE ip_address = p_ip
     AND result = 'success'
     AND attempted_at > NOW() - INTERVAL '24 hours';

  IF v_recent_count >= 3 THEN
    INSERT INTO client_signup_attempts (ip_address, attempted_at, email_attempted, result)
      VALUES (p_ip, NOW(), v_normalized, 'rate_limited');
    RETURN json_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  -- Duplicate email check (case-insensitive via LOWER index)
  IF EXISTS (
    SELECT 1 FROM clients WHERE LOWER(auth_email) = v_normalized
  ) THEN
    INSERT INTO client_signup_attempts (ip_address, attempted_at, email_attempted, result)
      VALUES (p_ip, NOW(), v_normalized, 'duplicate_email');
    RETURN json_build_object('ok', false, 'error', 'duplicate_email');
  END IF;

  INSERT INTO clients (
    auth_email, full_name, contact_phone, password_hash,
    marketing_opt_in, signup_status
  ) VALUES (
    TRIM(p_email), TRIM(p_full_name), TRIM(p_phone), p_password_hash,
    COALESCE(p_marketing_opt_in, FALSE), 'active'
  ) RETURNING id INTO v_client_id;

  INSERT INTO client_signup_attempts (ip_address, attempted_at, email_attempted, result)
    VALUES (p_ip, NOW(), v_normalized, 'success');

  RETURN json_build_object('ok', true, 'client_id', v_client_id);
END;
$$;

REVOKE ALL ON FUNCTION client_signup(TEXT, TEXT, TEXT, TEXT, BOOLEAN, INET) FROM PUBLIC;
REVOKE ALL ON FUNCTION client_signup(TEXT, TEXT, TEXT, TEXT, BOOLEAN, INET) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION client_signup(TEXT, TEXT, TEXT, TEXT, BOOLEAN, INET) TO service_role;


-- 2. client_login_lookup — case-insensitive email→client lookup
-- for the bcrypt compare step in the calling Server Action.
-- Returns the client_id + password_hash + signup_status. NULL
-- on miss (Server Action returns opaque invalid_credentials).

CREATE OR REPLACE FUNCTION client_login_lookup(p_email TEXT)
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_normalized TEXT;
  v_row        RECORD;
BEGIN
  IF NULLIF(TRIM(p_email), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_email');
  END IF;
  v_normalized := _normalize_client_email(p_email);

  SELECT id, password_hash, signup_status, password_must_change
    INTO v_row
    FROM clients
   WHERE LOWER(auth_email) = v_normalized
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'client_id', v_row.id,
    'password_hash', v_row.password_hash,
    'signup_status', v_row.signup_status,
    'password_must_change', v_row.password_must_change
  );
END;
$$;

REVOKE ALL ON FUNCTION client_login_lookup(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION client_login_lookup(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION client_login_lookup(TEXT) TO service_role;


-- 3. client_login_create_session — INSERT a session row for
-- a verified client. Rejects malformed token hashes via the
-- shared Phase 8 _is_sha256_hex helper (Codex round 2 P2 #1
-- shape-validator contract).

CREATE OR REPLACE FUNCTION client_login_create_session(
  p_client_id            UUID,
  p_session_token_hash   TEXT,
  p_remember_me          BOOLEAN,
  p_ip                   INET,
  p_user_agent           TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_ttl_days   INT;
BEGIN
  IF NOT _is_sha256_hex(p_session_token_hash) THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_hash');
  END IF;
  IF p_client_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_client');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  v_ttl_days := CASE WHEN COALESCE(p_remember_me, FALSE) THEN 30 ELSE 7 END;
  v_expires_at := NOW() + (v_ttl_days || ' days')::INTERVAL;

  INSERT INTO client_sessions (
    client_id, token_hash, expires_at, remember_me, ip_address, user_agent
  ) VALUES (
    p_client_id, p_session_token_hash, v_expires_at,
    COALESCE(p_remember_me, FALSE), p_ip, p_user_agent
  ) RETURNING id INTO v_session_id;

  UPDATE clients SET last_login_at = NOW(), updated_at = NOW()
   WHERE id = p_client_id;

  RETURN json_build_object(
    'ok', true,
    'session_id', v_session_id,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION client_login_create_session(UUID, TEXT, BOOLEAN, INET, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION client_login_create_session(UUID, TEXT, BOOLEAN, INET, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION client_login_create_session(UUID, TEXT, BOOLEAN, INET, TEXT) TO service_role;


-- 4. client_logout — UPDATE revoked_at on the matching
-- session row. Idempotent: zero rows updated → ok:true with
-- no_op flag (logging out an already-revoked session is not
-- an error from the client's perspective).

CREATE OR REPLACE FUNCTION client_logout(p_session_token_hash TEXT)
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_revoked INT;
BEGIN
  IF NOT _is_sha256_hex(p_session_token_hash) THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_hash');
  END IF;

  UPDATE client_sessions
     SET revoked_at = NOW()
   WHERE token_hash = p_session_token_hash
     AND revoked_at IS NULL;

  GET DIAGNOSTICS v_revoked = ROW_COUNT;
  RETURN json_build_object('ok', true, 'revoked_count', v_revoked);
END;
$$;

REVOKE ALL ON FUNCTION client_logout(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION client_logout(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION client_logout(TEXT) TO service_role;


-- 5. client_session_validate — every authed page request
-- joins this. Rejects revoked / expired / suspended /
-- deleted accounts.

CREATE OR REPLACE FUNCTION client_session_validate(p_session_token_hash TEXT)
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF NOT _is_sha256_hex(p_session_token_hash) THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_hash');
  END IF;

  SELECT s.client_id, s.expires_at, s.revoked_at,
         c.full_name, c.contact_phone,
         c.password_must_change, c.signup_status
    INTO v_row
    FROM client_sessions s
    JOIN clients c ON c.id = s.client_id
   WHERE s.token_hash = p_session_token_hash
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_session');
  END IF;

  IF v_row.revoked_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_session');
  END IF;

  IF v_row.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'expired');
  END IF;

  IF v_row.signup_status <> 'active' THEN
    RETURN json_build_object('ok', false, 'error', 'account_not_active');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'client_id', v_row.client_id,
    'full_name', v_row.full_name,
    'contact_phone', v_row.contact_phone,
    'password_must_change', v_row.password_must_change,
    'expires_at', v_row.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION client_session_validate(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION client_session_validate(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION client_session_validate(TEXT) TO service_role;


-- 6. client_mint_password_reset_token — enumeration-safe.
-- Returns ok:true with no_op:true when the email is not
-- registered (so the calling Server Action can return the
-- same opaque success to the browser regardless).

CREATE OR REPLACE FUNCTION client_mint_password_reset_token(
  p_email          TEXT,
  p_token_hash     TEXT,
  p_expires_at     TIMESTAMPTZ,
  p_ip             INET
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_normalized TEXT;
  v_client_id  UUID;
  v_token_id   UUID;
BEGIN
  IF NOT _is_sha256_hex(p_token_hash) THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_hash');
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_expiry');
  END IF;
  IF NULLIF(TRIM(p_email), '') IS NULL THEN
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  v_normalized := _normalize_client_email(p_email);

  SELECT id INTO v_client_id
    FROM clients
   WHERE LOWER(auth_email) = v_normalized
     AND signup_status = 'active'
   LIMIT 1;

  IF v_client_id IS NULL THEN
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  INSERT INTO client_password_reset_tokens (
    client_id, token_hash, expires_at, ip_address
  ) VALUES (
    v_client_id, p_token_hash, p_expires_at, p_ip
  ) RETURNING id INTO v_token_id;

  RETURN json_build_object('ok', true, 'token_id', v_token_id);
END;
$$;

REVOKE ALL ON FUNCTION client_mint_password_reset_token(TEXT, TEXT, TIMESTAMPTZ, INET) FROM PUBLIC;
REVOKE ALL ON FUNCTION client_mint_password_reset_token(TEXT, TEXT, TIMESTAMPTZ, INET) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION client_mint_password_reset_token(TEXT, TEXT, TIMESTAMPTZ, INET) TO service_role;


-- 7. client_verify_password_reset — atomic verify + update
-- + mark-used + revoke all sessions. FOR UPDATE row lock on
-- the token row to prevent double-use.

CREATE OR REPLACE FUNCTION client_verify_password_reset(
  p_token_hash         TEXT,
  p_new_password_hash  TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF NOT _is_sha256_hex(p_token_hash) THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_hash');
  END IF;
  IF NULLIF(TRIM(p_new_password_hash), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_password_hash');
  END IF;

  SELECT id, client_id, expires_at, used_at
    INTO v_row
    FROM client_password_reset_tokens
   WHERE token_hash = p_token_hash
   FOR UPDATE
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'token_not_found');
  END IF;
  IF v_row.used_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'token_used');
  END IF;
  IF v_row.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'token_expired');
  END IF;

  UPDATE clients
     SET password_hash = p_new_password_hash,
         password_must_change = FALSE,
         updated_at = NOW()
   WHERE id = v_row.client_id;

  UPDATE client_password_reset_tokens
     SET used_at = NOW()
   WHERE id = v_row.id;

  -- Revoke all live sessions for this client (mid-session
  -- credential rotation invalidates everything).
  UPDATE client_sessions
     SET revoked_at = NOW()
   WHERE client_id = v_row.client_id
     AND revoked_at IS NULL;

  RETURN json_build_object('ok', true, 'client_id', v_row.client_id);
END;
$$;

REVOKE ALL ON FUNCTION client_verify_password_reset(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION client_verify_password_reset(TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION client_verify_password_reset(TEXT, TEXT) TO service_role;


-- ============================================================
-- §4.4 — Cleanup cron RPCs (PR 1 ships 3; PR 4 will add the
-- 4th redispatch_stale_trip_requests separately)
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_client_sessions()
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM client_sessions
   WHERE expires_at <= NOW()
      OR revoked_at IS NOT NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN json_build_object('ok', true, 'deleted_count', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION cleanup_expired_client_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_client_sessions() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_client_sessions() TO service_role;


CREATE OR REPLACE FUNCTION cleanup_expired_client_password_reset_tokens()
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM client_password_reset_tokens
   WHERE expires_at <= NOW()
      OR used_at IS NOT NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN json_build_object('ok', true, 'deleted_count', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION cleanup_expired_client_password_reset_tokens() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_client_password_reset_tokens() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_client_password_reset_tokens() TO service_role;


CREATE OR REPLACE FUNCTION cleanup_old_client_signup_attempts()
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM client_signup_attempts
   WHERE attempted_at < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN json_build_object('ok', true, 'deleted_count', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION cleanup_old_client_signup_attempts() FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_old_client_signup_attempts() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_old_client_signup_attempts() TO service_role;
