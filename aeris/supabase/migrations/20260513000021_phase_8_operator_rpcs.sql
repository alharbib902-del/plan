-- ============================================================
-- Phase 8 — PR 2a: Operator RPC layer (17 publics + 1 helper)
--
-- Ships the SQL function family that PR 2b/2c/2d Server
-- Actions wrap. Mirrors the Phase 7 PR 2a discipline:
--
--   - Every public is SECURITY DEFINER + service-role-only EXECUTE
--   - Structured-error contract: { ok: false, error: '<code>' } —
--     no RAISE EXCEPTION on validation failures
--   - Helper REVOKEd from every role (callable only from inside
--     the publics, which run as the function-owner role)
--   - Lock order: lock the operators row first, then validate,
--     then mutate
--   - All publics SET search_path = public, pg_temp to defend
--     against schema-shadowing attacks
--
-- Migration sections:
--   §0   Helper: _normalize_operator_email
--   §1   operator_signup
--   §2   operator_login_lookup
--   §3   operator_login_create_session
--   §4   operator_logout
--   §5   operator_session_validate
--   §6   admin_approve_operator
--   §7   admin_reject_operator
--   §8   admin_suspend_operator
--   §9   admin_unsuspend_operator
--   §10  admin_set_operator_documents
--   §11  admin_reset_operator_password
--   §12  mint_operator_password_reset_token
--   §13  verify_operator_password_reset
--   §14  mint_operator_otp
--   §15  verify_operator_otp
--   §16  convert_phase7_stub_to_operator
--   §17  consume_operator_welcome_token
--   Tail Final REVOKE/GRANT batch (idempotent)
--
-- Production rollout: run AFTER 20260512000020 (Phase 8 PR 1
-- schema). Every function references columns / tables that PR 1
-- creates; without PR 1, this migration would fail on every
-- CREATE FUNCTION.
-- ============================================================


-- ============================================================
-- §0 — Helper: _normalize_operator_email
--
-- Returns the email lowercased + trimmed. Used by signup and
-- login lookups so 'Founder@Aeris.sa' and 'founder@aeris.sa'
-- resolve to the same row. Mirrors the LOWER(auth_email) unique
-- index from PR 1 §3.3.
--
-- REVOKEd from PUBLIC + every role. Callable only from inside
-- the SECURITY DEFINER publics (which run as the function-owner
-- role and therefore see the helper despite the REVOKE).
-- ============================================================

CREATE OR REPLACE FUNCTION _normalize_operator_email(p_email TEXT)
  RETURNS TEXT
  LANGUAGE sql
  IMMUTABLE
  SET search_path = public, pg_temp
AS $$
  SELECT LOWER(BTRIM(p_email));
$$;

REVOKE ALL ON FUNCTION _normalize_operator_email(TEXT) FROM PUBLIC;


-- ============================================================
-- §1 — operator_signup
--
-- Self-signup RPC called by PR 2c's /operator/signup Server
-- Action. The Server Action bcrypts the plaintext password
-- before calling this RPC; the RPC validates the bcrypt format
-- as defense-in-depth.
--
-- Contract:
--   IN  p_email             TEXT  (login identifier)
--       p_password_hash     TEXT  (bcrypt $2a$ / $2b$ / $2y$)
--       p_company_name      TEXT
--       p_contact_email     TEXT  (operational contact, MAY differ)
--       p_contact_phone     TEXT
--       p_notes             TEXT  (freeform; nullable)
--       p_ip                INET  (for rate-limit row)
--   OUT JSON:
--       { ok: true, operator_id, signup_status: 'pending' }  on success
--       { ok: false, error: 'email_in_use' }                 on duplicate
--       { ok: false, error: 'rate_limited' }                 on >= 3 successes / IP / 24h
--       { ok: false, error: 'password_hash_malformed' }      on bcrypt format
--       { ok: false, error: 'company_name_invalid' }         on length
--       { ok: false, error: 'contact_email_invalid' }        on format
--       { ok: false, error: 'contact_phone_invalid' }        on length
--
-- Lock order: existing-email lookup uses FOR UPDATE on
-- operators (key range), then any signup_attempts INSERTs.
-- ============================================================

CREATE OR REPLACE FUNCTION operator_signup(
  p_email          TEXT,
  p_password_hash  TEXT,
  p_company_name   TEXT,
  p_contact_email  TEXT,
  p_contact_phone  TEXT,
  p_notes          TEXT,
  p_ip             INET
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_normalized       TEXT;
  v_existing_id      UUID;
  v_recent_successes INT;
  v_new_id           UUID;
BEGIN
  v_normalized := _normalize_operator_email(p_email);

  -- Step 1+2: Lock the email range. Since LOWER(auth_email) is
  -- the unique index, we lookup by the same expression.
  SELECT id INTO v_existing_id
    FROM operators
    WHERE LOWER(auth_email) = v_normalized
    FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    INSERT INTO operator_signup_attempts
      (ip_address, email_attempted, result)
      VALUES (p_ip, p_email, 'duplicate_email');
    RETURN json_build_object('ok', false, 'error', 'email_in_use');
  END IF;

  -- Step 3: Rate limit (3 successes / IP / 24 hours).
  SELECT COUNT(*) INTO v_recent_successes
    FROM operator_signup_attempts
    WHERE ip_address = p_ip
      AND attempted_at > NOW() - INTERVAL '24 hours'
      AND result = 'success';

  IF v_recent_successes >= 3 THEN
    INSERT INTO operator_signup_attempts
      (ip_address, email_attempted, result)
      VALUES (p_ip, p_email, 'rate_limited');
    RETURN json_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  -- Step 4: Defense-in-depth bcrypt format check. The Server
  -- Action runs bcryptjs.hashSync(plaintext, 12) which always
  -- starts with $2a$ / $2b$ / $2y$ and is exactly 60 chars.
  IF p_password_hash IS NULL
     OR length(p_password_hash) <> 60
     OR p_password_hash !~ '^\$2[aby]\$'
  THEN
    INSERT INTO operator_signup_attempts
      (ip_address, email_attempted, result)
      VALUES (p_ip, p_email, 'validation_failed');
    RETURN json_build_object('ok', false, 'error', 'password_hash_malformed');
  END IF;

  -- Step 5: Field-shape validation (matches PR 2c stub bootstrap).
  IF p_company_name IS NULL
     OR length(BTRIM(p_company_name)) < 2
     OR length(p_company_name) > 200
  THEN
    INSERT INTO operator_signup_attempts
      (ip_address, email_attempted, result)
      VALUES (p_ip, p_email, 'validation_failed');
    RETURN json_build_object('ok', false, 'error', 'company_name_invalid');
  END IF;

  IF p_contact_email IS NULL
     OR p_contact_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     OR length(p_contact_email) > 255
  THEN
    INSERT INTO operator_signup_attempts
      (ip_address, email_attempted, result)
      VALUES (p_ip, p_email, 'validation_failed');
    RETURN json_build_object('ok', false, 'error', 'contact_email_invalid');
  END IF;

  IF p_contact_phone IS NULL
     OR length(BTRIM(p_contact_phone)) < 6
     OR length(p_contact_phone) > 20
  THEN
    INSERT INTO operator_signup_attempts
      (ip_address, email_attempted, result)
      VALUES (p_ip, p_email, 'validation_failed');
    RETURN json_build_object('ok', false, 'error', 'contact_phone_invalid');
  END IF;

  -- Step 6: INSERT the operator. auth_email is the immutable
  -- login identifier; contact_email is the mutable operational
  -- contact (Codex round-4 P1 #1 fix on spec — they MAY differ).
  INSERT INTO operators
    (auth_email, contact_email, contact_phone, company_name,
     signup_status, password_hash, password_set_at)
  VALUES
    (p_email, p_contact_email, p_contact_phone, p_company_name,
     'pending', p_password_hash, NOW())
  RETURNING id INTO v_new_id;

  -- Notes column does not exist on `operators` (it's on
  -- phase7_operator_stubs). Notes from signup are stashed in
  -- audit_logs for admin review:
  IF p_notes IS NOT NULL AND length(BTRIM(p_notes)) > 0 THEN
    INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
      VALUES ('operator', v_new_id, 'signup_notes',
              jsonb_build_object('notes', p_notes));
  END IF;

  -- Step 7: Record the successful attempt for the rate-limit window.
  INSERT INTO operator_signup_attempts
    (ip_address, email_attempted, result)
    VALUES (p_ip, p_email, 'success');

  RETURN json_build_object(
    'ok', true,
    'operator_id', v_new_id,
    'signup_status', 'pending'
  );
END;
$$;


-- ============================================================
-- §2 — operator_login_lookup (Step 1 of 2-step login)
--
-- Returns the stored bcrypt hash + status to the Server Action,
-- which runs bcrypt.compare(plaintext, storedHash) in Node.
-- The Server Action then calls operator_login_create_session
-- only on a successful compare.
--
-- Codex round-1 P1 #2 + round-2 P1 #1 fixes: lookup by
-- auth_email (immutable login identifier), NOT contact_email
-- (mutable operational contact).
--
-- Contract:
--   IN  p_email TEXT
--   OUT JSON:
--       { ok: true, operator_id, password_hash, password_must_change }   on found+approved
--       { ok: false, error: 'invalid_credentials' }                      on missing
--       { ok: false, error: 'signup_pending' }                           on pending
--       { ok: false, error: 'signup_rejected' }                          on rejected
--       { ok: false, error: 'account_suspended' }                        on suspended
--
-- Note: returning the stored hash to the Server Action is NOT
-- a leak. The Server Action runs server-side under
-- service-role; the hash never reaches the browser. The
-- plaintext password the user submitted is also Node-only;
-- it never touches SQL.
-- ============================================================

CREATE OR REPLACE FUNCTION operator_login_lookup(p_email TEXT)
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_id                   UUID;
  v_signup_status        operator_status;
  v_password_hash        TEXT;
  v_password_must_change BOOLEAN;
BEGIN
  SELECT id, signup_status, password_hash, password_must_change
    INTO v_id, v_signup_status, v_password_hash, v_password_must_change
    FROM operators
    WHERE LOWER(auth_email) = _normalize_operator_email(p_email);

  IF v_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  IF v_signup_status = 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'signup_pending');
  ELSIF v_signup_status = 'rejected' THEN
    RETURN json_build_object('ok', false, 'error', 'signup_rejected');
  ELSIF v_signup_status = 'suspended' THEN
    RETURN json_build_object('ok', false, 'error', 'account_suspended');
  END IF;

  -- Operator is approved. Return hash for Node-side bcrypt.compare.
  -- An approved operator with NULL password_hash exists only on
  -- admin-created accounts that have not completed first login;
  -- treat as invalid_credentials (the welcome-link flow handles
  -- first login, not the password-login form).
  IF v_password_hash IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'operator_id', v_id,
    'password_hash', v_password_hash,
    'password_must_change', v_password_must_change
  );
END;
$$;


-- ============================================================
-- §3 — operator_login_create_session (Step 2 of 2-step login)
--
-- Called by the Server Action after a successful Node-side
-- bcrypt.compare. The Server Action mints the raw session token
-- (randomBytes(32).toString('base64url')), sha256s it, and
-- passes the hash here.
--
-- Contract:
--   IN  p_operator_id        UUID
--       p_session_token_hash TEXT (sha256 hex / base64)
--       p_remember_me        BOOLEAN
--       p_ip                 INET (nullable)
--       p_user_agent         TEXT (nullable)
--   OUT JSON:
--       { ok: true, session_id, expires_at, password_must_change }   on success
--       { ok: false, error: 'operator_not_found' }                   on missing
--       { ok: false, error: 'account_not_approved' }                 on race-suspended
--
-- Re-validates signup_status='approved' (defense in depth: the
-- operator may have been suspended in the few milliseconds
-- between operator_login_lookup and here).
-- ============================================================

CREATE OR REPLACE FUNCTION operator_login_create_session(
  p_operator_id        UUID,
  p_session_token_hash TEXT,
  p_remember_me        BOOLEAN,
  p_ip                 INET,
  p_user_agent         TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signup_status        operator_status;
  v_password_must_change BOOLEAN;
  v_expires_at           TIMESTAMPTZ;
  v_session_id           UUID;
BEGIN
  -- Lock the operator row + re-read status / must-change flag.
  SELECT signup_status, password_must_change
    INTO v_signup_status, v_password_must_change
    FROM operators
    WHERE id = p_operator_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;

  IF v_signup_status <> 'approved' THEN
    RETURN json_build_object('ok', false, 'error', 'account_not_approved');
  END IF;

  v_expires_at := NOW() + CASE WHEN p_remember_me THEN INTERVAL '30 days' ELSE INTERVAL '7 days' END;

  INSERT INTO operator_sessions
    (operator_id, token_hash, expires_at, remember_me, ip_address, user_agent)
  VALUES
    (p_operator_id, p_session_token_hash, v_expires_at, p_remember_me, p_ip, p_user_agent)
  RETURNING id INTO v_session_id;

  UPDATE operators SET last_login_at = NOW() WHERE id = p_operator_id;

  RETURN json_build_object(
    'ok', true,
    'session_id', v_session_id,
    'expires_at', v_expires_at,
    'password_must_change', v_password_must_change
  );
END;
$$;


-- ============================================================
-- §4 — operator_logout
--
-- Revokes the session row matching the supplied token hash.
-- Idempotent: an already-revoked or missing session returns
-- { ok: true, no_op: true } so the Server Action can safely
-- call this on every logout without distinguishing cases.
--
-- Contract:
--   IN  p_session_token_hash TEXT
--   OUT JSON:
--       { ok: true, session_id }       on revoked-now
--       { ok: true, no_op: true }      on missing / already-revoked
-- ============================================================

CREATE OR REPLACE FUNCTION operator_logout(p_session_token_hash TEXT)
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  UPDATE operator_sessions
    SET revoked_at = NOW()
    WHERE token_hash = p_session_token_hash
      AND revoked_at IS NULL
    RETURNING id INTO v_session_id;

  IF v_session_id IS NULL THEN
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  RETURN json_build_object('ok', true, 'session_id', v_session_id);
END;
$$;


-- ============================================================
-- §5 — operator_session_validate
--
-- Called on every protected request. Server Action passes the
-- sha256 of the cookie's raw token; this function checks the
-- session is live (not revoked + not expired) and the operator
-- is still in 'approved' status.
--
-- Contract:
--   IN  p_token_hash TEXT
--   OUT JSON:
--       { ok: true, operator_id, expires_at, password_must_change }  on valid
--       { ok: false, error: 'invalid_session' }                      on missing/expired/revoked
--       { ok: false, error: 'account_not_approved' }                 on operator suspended/etc
-- ============================================================

CREATE OR REPLACE FUNCTION operator_session_validate(p_token_hash TEXT)
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_operator_id          UUID;
  v_expires_at           TIMESTAMPTZ;
  v_signup_status        operator_status;
  v_password_must_change BOOLEAN;
BEGIN
  SELECT s.operator_id, s.expires_at
    INTO v_operator_id, v_expires_at
    FROM operator_sessions s
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW();

  IF v_operator_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_session');
  END IF;

  SELECT signup_status, password_must_change
    INTO v_signup_status, v_password_must_change
    FROM operators
    WHERE id = v_operator_id;

  IF v_signup_status <> 'approved' THEN
    RETURN json_build_object('ok', false, 'error', 'account_not_approved');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'operator_id', v_operator_id,
    'expires_at', v_expires_at,
    'password_must_change', v_password_must_change
  );
END;
$$;


-- ============================================================
-- §6 — admin_approve_operator
--
-- Admin clicks "Approve" in /admin/operators/<id>. The Server
-- Action mints a welcome-magic-link HMAC token (separate
-- secret from session tokens) and passes the sha256 hash here.
--
-- Contract:
--   IN  p_operator_id              UUID
--       p_welcome_token_hash       VARCHAR(64)
--       p_welcome_token_expires_at TIMESTAMPTZ
--   OUT JSON:
--       { ok: true, operator_id }                    on success
--       { ok: false, error: 'operator_not_found' }   on missing
--       { ok: false, error: 'not_pending' }          on wrong status
-- ============================================================

CREATE OR REPLACE FUNCTION admin_approve_operator(
  p_operator_id              UUID,
  p_welcome_token_hash       VARCHAR(64),
  p_welcome_token_expires_at TIMESTAMPTZ
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signup_status operator_status;
BEGIN
  SELECT signup_status INTO v_signup_status
    FROM operators
    WHERE id = p_operator_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;

  IF v_signup_status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE operators
    SET signup_status = 'approved',
        approved_at = NOW(),
        approved_by_admin_at = NOW(),
        welcome_token_hash = p_welcome_token_hash,
        welcome_token_expires_at = p_welcome_token_expires_at
    WHERE id = p_operator_id;

  RETURN json_build_object('ok', true, 'operator_id', p_operator_id);
END;
$$;


-- ============================================================
-- §7 — admin_reject_operator
--
-- Admin clicks "Reject" with a free-text reason. The Server
-- Action sends a rejection email containing p_reason via Resend.
--
-- Contract:
--   IN  p_operator_id UUID
--       p_reason      TEXT
--   OUT JSON:
--       { ok: true, operator_id }                    on success
--       { ok: false, error: 'operator_not_found' }   on missing
--       { ok: false, error: 'not_pending' }          on wrong status
--       { ok: false, error: 'reason_required' }      on empty reason
-- ============================================================

CREATE OR REPLACE FUNCTION admin_reject_operator(
  p_operator_id UUID,
  p_reason      TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signup_status operator_status;
BEGIN
  IF p_reason IS NULL OR length(BTRIM(p_reason)) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'reason_required');
  END IF;

  SELECT signup_status INTO v_signup_status
    FROM operators
    WHERE id = p_operator_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;

  IF v_signup_status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'not_pending');
  END IF;

  UPDATE operators
    SET signup_status = 'rejected',
        rejected_at = NOW(),
        rejection_reason = p_reason
    WHERE id = p_operator_id;

  RETURN json_build_object('ok', true, 'operator_id', p_operator_id);
END;
$$;


-- ============================================================
-- §8 — admin_suspend_operator
--
-- Admin suspends an approved operator with a reason. Every
-- active session is revoked atomically — the operator is
-- forced out of the portal mid-request.
--
-- Contract:
--   IN  p_operator_id UUID
--       p_reason      TEXT
--   OUT JSON:
--       { ok: true, operator_id, sessions_revoked }  on success
--       { ok: false, error: 'operator_not_found' }   on missing
--       { ok: false, error: 'not_approved' }         on wrong status
--       { ok: false, error: 'reason_required' }      on empty reason
-- ============================================================

CREATE OR REPLACE FUNCTION admin_suspend_operator(
  p_operator_id UUID,
  p_reason      TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signup_status    operator_status;
  v_sessions_revoked INT;
BEGIN
  IF p_reason IS NULL OR length(BTRIM(p_reason)) = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'reason_required');
  END IF;

  SELECT signup_status INTO v_signup_status
    FROM operators
    WHERE id = p_operator_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;

  IF v_signup_status <> 'approved' THEN
    RETURN json_build_object('ok', false, 'error', 'not_approved');
  END IF;

  UPDATE operators
    SET signup_status = 'suspended',
        suspended_at = NOW(),
        suspension_reason = p_reason
    WHERE id = p_operator_id;

  WITH revoked AS (
    UPDATE operator_sessions
      SET revoked_at = NOW()
      WHERE operator_id = p_operator_id
        AND revoked_at IS NULL
      RETURNING 1
  )
  SELECT COUNT(*) INTO v_sessions_revoked FROM revoked;

  RETURN json_build_object(
    'ok', true,
    'operator_id', p_operator_id,
    'sessions_revoked', v_sessions_revoked
  );
END;
$$;


-- ============================================================
-- §9 — admin_unsuspend_operator
--
-- Admin lifts a suspension. Active sessions stay revoked
-- (operator must re-login fresh) — unsuspend does NOT
-- restore prior session rows.
--
-- Contract:
--   IN  p_operator_id UUID
--   OUT JSON:
--       { ok: true, operator_id }                    on success
--       { ok: false, error: 'operator_not_found' }   on missing
--       { ok: false, error: 'not_suspended' }        on wrong status
-- ============================================================

CREATE OR REPLACE FUNCTION admin_unsuspend_operator(p_operator_id UUID)
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_signup_status operator_status;
BEGIN
  SELECT signup_status INTO v_signup_status
    FROM operators
    WHERE id = p_operator_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;

  IF v_signup_status <> 'suspended' THEN
    RETURN json_build_object('ok', false, 'error', 'not_suspended');
  END IF;

  UPDATE operators
    SET signup_status = 'approved',
        suspended_at = NULL,
        suspension_reason = NULL
    WHERE id = p_operator_id;

  RETURN json_build_object('ok', true, 'operator_id', p_operator_id);
END;
$$;


-- ============================================================
-- §10 — admin_set_operator_documents
--
-- Admin uploads / updates regulatory text fields. NULL params
-- leave the existing value (so admin can set one document at
-- a time without re-typing the others).
--
-- This RPC sets the regulatory text columns ONLY. The
-- companion file-storage row in operator_documents (PR 1 §3.8)
-- is managed by a separate Server Action that handles Supabase
-- Storage uploads (PR 2b's adminUploadOperatorDocument).
--
-- Contract:
--   IN  p_operator_id              UUID
--       p_commercial_registration  TEXT (nullable)
--       p_gaca_license             TEXT (nullable)
--       p_license_expiry           DATE (nullable)
--   OUT JSON:
--       { ok: true, operator_id }                    on success
--       { ok: false, error: 'operator_not_found' }   on missing
--       { ok: false, error: 'not_writable' }         on wrong status
-- ============================================================

CREATE OR REPLACE FUNCTION admin_set_operator_documents(
  p_operator_id              UUID,
  p_commercial_registration  TEXT,
  p_gaca_license             TEXT,
  p_license_expiry           DATE
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signup_status operator_status;
BEGIN
  SELECT signup_status INTO v_signup_status
    FROM operators
    WHERE id = p_operator_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;

  IF v_signup_status NOT IN ('pending', 'approved') THEN
    RETURN json_build_object('ok', false, 'error', 'not_writable');
  END IF;

  UPDATE operators
    SET commercial_registration =
          COALESCE(p_commercial_registration, commercial_registration),
        gaca_license =
          COALESCE(p_gaca_license, gaca_license),
        license_expiry =
          COALESCE(p_license_expiry, license_expiry)
    WHERE id = p_operator_id;

  RETURN json_build_object('ok', true, 'operator_id', p_operator_id);
END;
$$;


-- ============================================================
-- §11 — admin_reset_operator_password
--
-- Admin sets a fresh bcrypted password. password_must_change
-- is set TRUE so the operator is forced to change on next
-- login. Every active session is revoked.
--
-- Contract:
--   IN  p_operator_id      UUID
--       p_new_password_hash TEXT (bcrypt $2*$ 60-char)
--   OUT JSON:
--       { ok: true, operator_id, sessions_revoked }   on success
--       { ok: false, error: 'operator_not_found' }    on missing
--       { ok: false, error: 'not_resettable' }        on wrong status
--       { ok: false, error: 'password_hash_malformed' } on bcrypt format
-- ============================================================

CREATE OR REPLACE FUNCTION admin_reset_operator_password(
  p_operator_id       UUID,
  p_new_password_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signup_status    operator_status;
  v_sessions_revoked INT;
BEGIN
  IF p_new_password_hash IS NULL
     OR length(p_new_password_hash) <> 60
     OR p_new_password_hash !~ '^\$2[aby]\$'
  THEN
    RETURN json_build_object('ok', false, 'error', 'password_hash_malformed');
  END IF;

  SELECT signup_status INTO v_signup_status
    FROM operators
    WHERE id = p_operator_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;

  IF v_signup_status NOT IN ('approved', 'suspended') THEN
    RETURN json_build_object('ok', false, 'error', 'not_resettable');
  END IF;

  UPDATE operators
    SET password_hash = p_new_password_hash,
        password_set_at = NOW(),
        password_must_change = TRUE
    WHERE id = p_operator_id;

  WITH revoked AS (
    UPDATE operator_sessions
      SET revoked_at = NOW()
      WHERE operator_id = p_operator_id
        AND revoked_at IS NULL
      RETURNING 1
  )
  SELECT COUNT(*) INTO v_sessions_revoked FROM revoked;

  RETURN json_build_object(
    'ok', true,
    'operator_id', p_operator_id,
    'sessions_revoked', v_sessions_revoked
  );
END;
$$;


-- ============================================================
-- §12 — mint_operator_password_reset_token
--
-- Operator submits email at /operator/forgot-password. The
-- Server Action mints a raw token (32 bytes), sha256s it,
-- passes the hash here. The email body contains the raw token
-- in the URL; the DB never sees the raw token.
--
-- Idempotent on missing email: returns { ok: true, no_op: true }
-- to prevent email enumeration. Same posture as
-- operator_login_lookup's 'invalid_credentials' opacity.
--
-- Contract:
--   IN  p_email      TEXT
--       p_token_hash VARCHAR(64) (sha256 of raw token)
--       p_expires_at TIMESTAMPTZ (Server Action sets NOW + 30min)
--       p_ip         INET (nullable)
--   OUT JSON:
--       { ok: true, token_id }              on operator found + token minted
--       { ok: true, no_op: true }           on email not registered
-- ============================================================

CREATE OR REPLACE FUNCTION mint_operator_password_reset_token(
  p_email      TEXT,
  p_token_hash VARCHAR(64),
  p_expires_at TIMESTAMPTZ,
  p_ip         INET
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operator_id UUID;
  v_token_id    UUID;
BEGIN
  SELECT id INTO v_operator_id
    FROM operators
    WHERE LOWER(auth_email) = _normalize_operator_email(p_email);

  IF v_operator_id IS NULL THEN
    -- Do not leak that the email isn't registered.
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  INSERT INTO operator_password_reset_tokens
    (operator_id, token_hash, expires_at, ip_address)
  VALUES
    (v_operator_id, p_token_hash, p_expires_at, p_ip)
  RETURNING id INTO v_token_id;

  RETURN json_build_object('ok', true, 'token_id', v_token_id);
END;
$$;


-- ============================================================
-- §13 — verify_operator_password_reset
--
-- Operator clicks the email link, sets a new password at
-- /operator/reset-password/[token]. The Server Action bcrypts
-- the new plaintext, sha256s the URL token, calls this RPC.
--
-- On success: password updated + token marked used + every
-- active session revoked (operator re-logs-in with the new
-- password).
--
-- Contract:
--   IN  p_token_hash         VARCHAR(64) (sha256 of URL token)
--       p_new_password_hash  TEXT        (bcrypt $2*$ 60-char)
--   OUT JSON:
--       { ok: true, operator_id, sessions_revoked }   on success
--       { ok: false, error: 'token_not_found' }       on missing
--       { ok: false, error: 'token_already_used' }    on used_at set
--       { ok: false, error: 'token_expired' }         on expired
--       { ok: false, error: 'password_hash_malformed' } on bcrypt format
-- ============================================================

CREATE OR REPLACE FUNCTION verify_operator_password_reset(
  p_token_hash        VARCHAR(64),
  p_new_password_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operator_id      UUID;
  v_used_at          TIMESTAMPTZ;
  v_expires_at       TIMESTAMPTZ;
  v_token_id         UUID;
  v_sessions_revoked INT;
BEGIN
  IF p_new_password_hash IS NULL
     OR length(p_new_password_hash) <> 60
     OR p_new_password_hash !~ '^\$2[aby]\$'
  THEN
    RETURN json_build_object('ok', false, 'error', 'password_hash_malformed');
  END IF;

  SELECT id, operator_id, used_at, expires_at
    INTO v_token_id, v_operator_id, v_used_at, v_expires_at
    FROM operator_password_reset_tokens
    WHERE token_hash = p_token_hash
    FOR UPDATE;

  IF v_token_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'token_not_found');
  END IF;

  IF v_used_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'token_already_used');
  END IF;

  IF v_expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'token_expired');
  END IF;

  UPDATE operators
    SET password_hash = p_new_password_hash,
        password_set_at = NOW(),
        password_must_change = FALSE
    WHERE id = v_operator_id;

  UPDATE operator_password_reset_tokens
    SET used_at = NOW()
    WHERE id = v_token_id;

  WITH revoked AS (
    UPDATE operator_sessions
      SET revoked_at = NOW()
      WHERE operator_id = v_operator_id
        AND revoked_at IS NULL
      RETURNING 1
  )
  SELECT COUNT(*) INTO v_sessions_revoked FROM revoked;

  RETURN json_build_object(
    'ok', true,
    'operator_id', v_operator_id,
    'sessions_revoked', v_sessions_revoked
  );
END;
$$;


-- ============================================================
-- §14 — mint_operator_otp
--
-- Admin mints a 6-digit OTP for an operator (recovery flow
-- when email access is lost). The Server Action generates the
-- 6-digit code, sha256s it, sends the plaintext to the
-- operator via WhatsApp (admin pastes the code into wa.me).
--
-- Contract:
--   IN  p_operator_id UUID
--       p_code_hash   VARCHAR(64) (sha256 of 6-digit code)
--       p_purpose     TEXT (login | recovery)
--       p_expires_at  TIMESTAMPTZ (Server Action sets NOW + 10min)
--   OUT JSON:
--       { ok: true, otp_id }                       on success
--       { ok: false, error: 'operator_not_found' } on missing
--       { ok: false, error: 'invalid_purpose' }    on wrong enum value
--       { ok: false, error: 'not_otp_eligible' }   on operator status
-- ============================================================

CREATE OR REPLACE FUNCTION mint_operator_otp(
  p_operator_id UUID,
  p_code_hash   VARCHAR(64),
  p_purpose     TEXT,
  p_expires_at  TIMESTAMPTZ
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_signup_status operator_status;
  v_otp_id        UUID;
BEGIN
  IF p_purpose NOT IN ('login', 'recovery') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_purpose');
  END IF;

  SELECT signup_status INTO v_signup_status
    FROM operators
    WHERE id = p_operator_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;

  IF v_signup_status NOT IN ('approved', 'suspended') THEN
    RETURN json_build_object('ok', false, 'error', 'not_otp_eligible');
  END IF;

  INSERT INTO operator_otp_codes
    (operator_id, code_hash, channel, purpose, expires_at)
  VALUES
    (p_operator_id, p_code_hash, 'whatsapp', p_purpose, p_expires_at)
  RETURNING id INTO v_otp_id;

  RETURN json_build_object('ok', true, 'otp_id', v_otp_id);
END;
$$;


-- ============================================================
-- §15 — verify_operator_otp
--
-- Operator types the 6-digit code at /operator/login/otp. The
-- Server Action sha256s it, calls this RPC.
--
-- On success: the OTP row is marked used; the operator is
-- considered authenticated. The Server Action then mints a
-- session token + creates an operator_sessions row directly
-- (does NOT call operator_login_create_session because no
-- bcrypt step occurred).
--
-- attempt_count is bumped on every call. After 5 failed
-- compares the row is locked (returns 'locked') even if a
-- subsequent compare would have matched — rate-limits brute
-- force.
--
-- Contract:
--   IN  p_operator_id UUID
--       p_code_hash   VARCHAR(64)
--   OUT JSON:
--       { ok: true, otp_id, purpose }                on success
--       { ok: false, error: 'operator_not_found' }   on missing operator
--       { ok: false, error: 'no_active_otp' }        on no live row
--       { ok: false, error: 'code_mismatch' }        on hash compare fail
--       { ok: false, error: 'expired' }              on expires_at <= NOW
--       { ok: false, error: 'locked' }               on attempt_count >= 5
-- ============================================================

CREATE OR REPLACE FUNCTION verify_operator_otp(
  p_operator_id UUID,
  p_code_hash   VARCHAR(64)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_otp_id           UUID;
  v_stored_hash      VARCHAR(64);
  v_purpose          TEXT;
  v_expires_at       TIMESTAMPTZ;
  v_used_at          TIMESTAMPTZ;
  v_attempt_count    INT;
BEGIN
  -- Confirm operator exists (defense-in-depth; the Server
  -- Action should have validated, but RLS on operator_otp_codes
  -- means we cannot rely on FK enforcement here).
  IF NOT EXISTS (SELECT 1 FROM operators WHERE id = p_operator_id) THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;

  -- Latest unused OTP for this operator. There can be only one
  -- "live" OTP at a time in practice (admin issues one, operator
  -- consumes it); we sort by issued_at DESC for safety.
  SELECT id, code_hash, purpose, expires_at, used_at, attempt_count
    INTO v_otp_id, v_stored_hash, v_purpose, v_expires_at, v_used_at, v_attempt_count
    FROM operator_otp_codes
    WHERE operator_id = p_operator_id
      AND used_at IS NULL
    ORDER BY issued_at DESC
    LIMIT 1
    FOR UPDATE;

  IF v_otp_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no_active_otp');
  END IF;

  IF v_attempt_count >= 5 THEN
    RETURN json_build_object('ok', false, 'error', 'locked');
  END IF;

  IF v_expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'expired');
  END IF;

  IF v_stored_hash <> p_code_hash THEN
    UPDATE operator_otp_codes
      SET attempt_count = attempt_count + 1
      WHERE id = v_otp_id;
    RETURN json_build_object('ok', false, 'error', 'code_mismatch');
  END IF;

  -- Match. Mark used.
  UPDATE operator_otp_codes
    SET used_at = NOW(), attempt_count = attempt_count + 1
    WHERE id = v_otp_id;

  RETURN json_build_object(
    'ok', true,
    'otp_id', v_otp_id,
    'purpose', v_purpose
  );
END;
$$;


-- ============================================================
-- §16 — convert_phase7_stub_to_operator
--
-- Admin clicks "Convert to operator" in the Phase 7 stub list
-- (PR 2b's /admin/empty-legs/operators/<stub_id>/convert page).
-- This RPC atomically:
--   - reassigns every empty_legs.operator_stub_id = stub_id
--     to .operator_id = p_operator_id, .operator_stub_id = NULL
--   - flips the stub.status to 'archived'
--
-- Stubs that admin elects not to convert stay in coexistence
-- mode (the FK + the stubs table are NOT removed in Phase 8 —
-- per locked decision §4 manual conversion strategy).
--
-- Contract:
--   IN  p_stub_id     UUID
--       p_operator_id UUID
--   OUT JSON:
--       { ok: true, stub_id, operator_id, legs_reassigned } on success
--       { ok: false, error: 'stub_not_found' }              on missing stub
--       { ok: false, error: 'operator_not_found' }          on missing operator
--       { ok: false, error: 'stub_already_archived' }       on stub already done
--       { ok: false, error: 'operator_not_writable' }       on operator status
-- ============================================================

CREATE OR REPLACE FUNCTION convert_phase7_stub_to_operator(
  p_stub_id     UUID,
  p_operator_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stub_status     TEXT;
  v_operator_status operator_status;
  v_legs_reassigned INT;
BEGIN
  -- Lock the stub.
  SELECT status INTO v_stub_status
    FROM phase7_operator_stubs
    WHERE id = p_stub_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'stub_not_found');
  END IF;

  IF v_stub_status = 'archived' THEN
    RETURN json_build_object('ok', false, 'error', 'stub_already_archived');
  END IF;

  -- Lock the target operator.
  SELECT signup_status INTO v_operator_status
    FROM operators
    WHERE id = p_operator_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;

  IF v_operator_status NOT IN ('approved', 'suspended') THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_writable');
  END IF;

  -- Reassign legs.
  WITH reassigned AS (
    UPDATE empty_legs
      SET operator_id = p_operator_id,
          operator_stub_id = NULL
      WHERE operator_stub_id = p_stub_id
      RETURNING 1
  )
  SELECT COUNT(*) INTO v_legs_reassigned FROM reassigned;

  -- Archive the stub.
  UPDATE phase7_operator_stubs
    SET status = 'archived'
    WHERE id = p_stub_id;

  RETURN json_build_object(
    'ok', true,
    'stub_id', p_stub_id,
    'operator_id', p_operator_id,
    'legs_reassigned', v_legs_reassigned
  );
END;
$$;


-- ============================================================
-- §17 — consume_operator_welcome_token
--
-- Operator clicks the welcome magic link from the approval
-- email. The link's token is sha256'd by the Server Action
-- and passed here. On success: a fresh session is minted +
-- the welcome token is marked used (one-shot).
--
-- password_must_change is set TRUE only if the operator
-- has no password_hash (rare path: admin-created accounts
-- that skipped the signup form).
--
-- Contract:
--   IN  p_token_hash         VARCHAR(64)
--       p_session_token_hash VARCHAR(64)
--       p_remember_me        BOOLEAN
--       p_ip                 INET (nullable)
--       p_user_agent         TEXT (nullable)
--   OUT JSON:
--       { ok: true, operator_id, session_id, expires_at, password_must_change } on success
--       { ok: false, error: 'token_not_found' }      on missing
--       { ok: false, error: 'already_used' }         on welcome_token_used_at set
--       { ok: false, error: 'expired' }              on welcome_token_expires_at past
--       { ok: false, error: 'account_not_approved' } on signup_status not approved
-- ============================================================

CREATE OR REPLACE FUNCTION consume_operator_welcome_token(
  p_token_hash         VARCHAR(64),
  p_session_token_hash VARCHAR(64),
  p_remember_me        BOOLEAN,
  p_ip                 INET,
  p_user_agent         TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operator_id          UUID;
  v_signup_status        operator_status;
  v_used_at              TIMESTAMPTZ;
  v_expires_at           TIMESTAMPTZ;
  v_password_hash        TEXT;
  v_session_expires_at   TIMESTAMPTZ;
  v_session_id           UUID;
  v_password_must_change BOOLEAN;
BEGIN
  SELECT id, signup_status, welcome_token_used_at,
         welcome_token_expires_at, password_hash
    INTO v_operator_id, v_signup_status, v_used_at,
         v_expires_at, v_password_hash
    FROM operators
    WHERE welcome_token_hash = p_token_hash
    FOR UPDATE;

  IF v_operator_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'token_not_found');
  END IF;

  IF v_used_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'already_used');
  END IF;

  IF v_expires_at IS NULL OR v_expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'expired');
  END IF;

  IF v_signup_status <> 'approved' THEN
    RETURN json_build_object('ok', false, 'error', 'account_not_approved');
  END IF;

  v_session_expires_at := NOW() + CASE WHEN p_remember_me THEN INTERVAL '30 days' ELSE INTERVAL '7 days' END;
  v_password_must_change := (v_password_hash IS NULL);

  INSERT INTO operator_sessions
    (operator_id, token_hash, expires_at, remember_me, ip_address, user_agent)
  VALUES
    (v_operator_id, p_session_token_hash, v_session_expires_at,
     p_remember_me, p_ip, p_user_agent)
  RETURNING id INTO v_session_id;

  UPDATE operators
    SET welcome_token_used_at = NOW(),
        last_login_at = NOW(),
        password_must_change = v_password_must_change
    WHERE id = v_operator_id;

  RETURN json_build_object(
    'ok', true,
    'operator_id', v_operator_id,
    'session_id', v_session_id,
    'expires_at', v_session_expires_at,
    'password_must_change', v_password_must_change
  );
END;
$$;


-- ============================================================
-- Tail — Final REVOKE/GRANT batch (idempotent)
--
-- Every public function: REVOKE ALL FROM PUBLIC + GRANT
-- EXECUTE TO service_role. Mirrors Phase 7 PR 2a discipline:
-- the application calls these via supabase.rpc(...) under
-- the service_role key; no anon / authenticated path touches
-- this layer.
--
-- The helper _normalize_operator_email is REVOKEd above (no
-- GRANT). It's callable only from inside the publics, which
-- run as the function-owner role and therefore see the
-- helper despite the REVOKE.
-- ============================================================

REVOKE ALL ON FUNCTION operator_signup(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INET) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_signup(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INET) TO service_role;

REVOKE ALL ON FUNCTION operator_login_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_login_lookup(TEXT) TO service_role;

REVOKE ALL ON FUNCTION operator_login_create_session(UUID, TEXT, BOOLEAN, INET, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_login_create_session(UUID, TEXT, BOOLEAN, INET, TEXT) TO service_role;

REVOKE ALL ON FUNCTION operator_logout(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_logout(TEXT) TO service_role;

REVOKE ALL ON FUNCTION operator_session_validate(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_session_validate(TEXT) TO service_role;

REVOKE ALL ON FUNCTION admin_approve_operator(UUID, VARCHAR, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_approve_operator(UUID, VARCHAR, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION admin_reject_operator(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_reject_operator(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION admin_suspend_operator(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_suspend_operator(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION admin_unsuspend_operator(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_unsuspend_operator(UUID) TO service_role;

REVOKE ALL ON FUNCTION admin_set_operator_documents(UUID, TEXT, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_operator_documents(UUID, TEXT, TEXT, DATE) TO service_role;

REVOKE ALL ON FUNCTION admin_reset_operator_password(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_reset_operator_password(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION mint_operator_password_reset_token(TEXT, VARCHAR, TIMESTAMPTZ, INET) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mint_operator_password_reset_token(TEXT, VARCHAR, TIMESTAMPTZ, INET) TO service_role;

REVOKE ALL ON FUNCTION verify_operator_password_reset(VARCHAR, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_operator_password_reset(VARCHAR, TEXT) TO service_role;

REVOKE ALL ON FUNCTION mint_operator_otp(UUID, VARCHAR, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mint_operator_otp(UUID, VARCHAR, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION verify_operator_otp(UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_operator_otp(UUID, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION convert_phase7_stub_to_operator(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convert_phase7_stub_to_operator(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION consume_operator_welcome_token(VARCHAR, VARCHAR, BOOLEAN, INET, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_operator_welcome_token(VARCHAR, VARCHAR, BOOLEAN, INET, TEXT) TO service_role;


-- ============================================================
-- Migration complete. Total surface added:
--   - 1 internal helper (_normalize_operator_email) REVOKEd
--     from every role
--   - 17 SECURITY DEFINER public RPCs, EXECUTE granted to
--     service_role only
--   - All publics use structured-error JSON contract
--     (no RAISE EXCEPTION on validation failures)
--   - All publics SET search_path = public, pg_temp
--
-- Founder probes (per spec §4 founder probes 5-8):
--   5. RPC grants — \df+ public.*operator* shows 17 publics +
--      1 helper; each public has EXECUTE granted to service_role;
--      helper has zero grantees
--   6. Approve smoke — INSERT pending operator + call
--      admin_approve_operator + assert signup_status='approved'
--   7. Login smoke — 5-step 2-step login flow with bcrypt
--      compare in Node + session validate
--   8. Stub conversion smoke — INSERT stub + 2 legs + operator,
--      call convert_phase7_stub_to_operator, assert legs
--      reassigned + stub archived
-- ============================================================
