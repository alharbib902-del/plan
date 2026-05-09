-- ============================================================
-- Phase 8 — PR 1: Operator account onboarding (DDL only)
--
-- This migration prepares the schema for the new auth + admin
-- surfaces shipped in PR 2a–2e. NO application code is wired in
-- this PR; the ALTERs and CREATEs here are purely structural.
--
-- Mirrors the Phase 7 PR 1 discipline:
--   - Every CREATE TABLE / CREATE INDEX is IF NOT EXISTS
--   - Every constraint add is wrapped in a pg_constraint guard
--   - Every drop-then-recreate uses DROP IF EXISTS first
--   - The migration is replayable on any DB state (fresh DB,
--     staging restore, or a Phase-7-era snapshot)
--
-- Sections (per spec §3):
--   §3.1  Relax operators.user_id to nullable
--   §3.2  Relax regulatory columns (commercial_registration,
--         gaca_license, license_expiry)
--   §3.3  Add 12 new custom-auth columns + 3-step auth_email
--         invariant (ADD nullable → backfill → SET NOT NULL).
--         Two lifecycle columns (approved_at, rejection_reason)
--         already exist in the initial schema and are REUSED,
--         not re-added (Codex round-6 implementation reality
--         fix on rounds 0-5's "14 columns" wording).
--   §3.4  Extend operator_status ENUM with 'rejected' +
--         rename column status → signup_status. Rounds 0-5
--         used a DROP/ADD CONSTRAINT pattern that fails on
--         ENUM columns — round-6 patch uses ALTER TYPE
--         ADD VALUE instead and preserves the ENUM type.
--   §3.5  CREATE TABLE operator_sessions
--   §3.6  CREATE TABLE operator_password_reset_tokens
--   §3.7  CREATE TABLE operator_otp_codes
--   §3.8  CREATE TABLE operator_documents
--   §3.9  CREATE TABLE operator_signup_attempts
--   §3.10 Singleton operator_notification_alert_status (Codex
--         round-1 P1 #3 fix)
--   §3.11 Audit trigger on operators (signup_status +
--         password_hash changes)
--
-- Production rollout: run BEFORE the PR 2a code deploy. PR 2a
-- (RPC layer) references every column / table this migration
-- creates; without the migration the RPC functions would fail
-- to install.
-- ============================================================


-- ============================================================
-- §3.1 — Relax operators.user_id to nullable
--
-- Custom + bcrypt auth means an operator account does NOT need
-- a row in `users` (that table backs customer auth). Phase 8
-- operators have their own auth columns (§3.3 below). Existing
-- production rows: zero (per Phase 7 closure §Schema reality
-- audit), so the relaxation is a no-op for live data and
-- future-safe for custom-auth operators that never get a
-- users.id.
-- ============================================================

ALTER TABLE operators ALTER COLUMN user_id DROP NOT NULL;


-- ============================================================
-- §3.2 — Relax regulatory columns
--
-- Per locked decision §3 (Document handling: admin completes
-- documents). Operators rarely have gaca_license /
-- commercial_registration / license_expiry ready at signup.
-- Admin coordinates document collection out-of-band (WhatsApp /
-- email) and uploads on the operator's behalf — see PR 2b's
-- /admin/operators/<id>/documents page + §3.8 below for the
-- companion documents table. The columns themselves stay
-- typed-correct; admin uploads populate them later.
-- ============================================================

ALTER TABLE operators ALTER COLUMN commercial_registration DROP NOT NULL;
ALTER TABLE operators ALTER COLUMN gaca_license DROP NOT NULL;
ALTER TABLE operators ALTER COLUMN license_expiry DROP NOT NULL;


-- ============================================================
-- §3.3 — Add 12 new custom-auth columns (2 lifecycle columns
--        already exist in initial schema and are REUSED)
--
-- Adds 12 new columns IF NOT EXISTS so the migration is
-- replayable. The auth_email column is special: the spec
-- promises it is `NOT NULL UNIQUE` post-migration, but we
-- cannot ADD COLUMN ... NOT NULL on a non-empty table without
-- a default. The 3-step pattern (Codex round-2 P1 #1 + round-3
-- P1 #1 fix) handles both fresh and populated databases:
--   (1) ADD COLUMN nullable
--   (2) UPDATE backfill from existing contact_email
--   (3) SET NOT NULL
--
-- After step 3 the column is NOT NULL on every row. The
-- LOWER(auth_email) unique index normalizes case at lookup
-- time so `Founder@Aeris.sa` and `founder@aeris.sa` resolve
-- to the same row.
--
-- Two columns the rounds 0-5 spec listed among "14 new
-- columns" already exist in the initial schema:
--   - approved_at TIMESTAMPTZ      (initial_schema.sql:162)
--   - rejection_reason TEXT        (initial_schema.sql:164)
-- These are REUSED — PR 2a's admin-approve / admin-reject
-- RPCs will WRITE to the existing columns rather than
-- creating duplicates. The migration does NOT touch them
-- (Codex round-6 implementation reality fix).
--
-- The 12 columns added below:
--   1.  auth_email (TEXT, NOT NULL post-backfill)
--   2.  password_hash (TEXT, nullable — admin-created
--       operators may not have a password until first login)
--   3.  password_set_at (TIMESTAMPTZ)
--   4.  password_must_change (BOOLEAN NOT NULL DEFAULT FALSE)
--   5.  last_login_at (TIMESTAMPTZ)
--   6.  approved_by_admin_at (TIMESTAMPTZ)
--          ↳ Distinct from the existing `approved_by`
--            (UUID FK to users(id)) — the admin actor is
--            tracked in audit_logs by entity_id, not by an
--            FK to a `users` row that admin may not have.
--            `approved_by_admin_at` is a redundant timestamp
--            that complements `approved_at` for the
--            two-step approval flow (Phase 8 admin clicks
--            "Approve" → both timestamps set in one RPC).
--   7.  rejected_at (TIMESTAMPTZ)
--   8.  suspended_at (TIMESTAMPTZ)
--   9.  suspension_reason (TEXT)
--   10. welcome_token_hash (VARCHAR(64))
--   11. welcome_token_expires_at (TIMESTAMPTZ)
--   12. welcome_token_used_at (TIMESTAMPTZ)
--
-- The welcome_token_* columns back the magic-link first-login
-- flow per locked decision §13 (welcome-link magic auth, no
-- separate verify step). PR 2c's /operator/welcome/[token]
-- page consumes them.
-- ============================================================

ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS auth_email TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by_admin_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS welcome_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS welcome_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_token_used_at TIMESTAMPTZ;

-- Backfill auth_email from contact_email for any pre-existing
-- row. Production has zero operators today, but a future
-- replay on a populated DB must succeed.
UPDATE operators SET auth_email = contact_email
  WHERE auth_email IS NULL;

-- Close the invariant: every Phase-8-and-later operator row
-- carries a non-null auth_email.
ALTER TABLE operators ALTER COLUMN auth_email SET NOT NULL;

-- Unique index on the normalized column. No WHERE clause
-- needed now that auth_email is NOT NULL (Codex round-3 P1 #1
-- fix: prior draft kept a partial index because auth_email
-- was nullable; with NOT NULL the partial guard is redundant
-- and a plain unique index gives PostgREST a cleaner shape
-- for FK references in PR 2a–2e RPCs).
CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_auth_email_unique
  ON operators(LOWER(auth_email));


-- ============================================================
-- §3.4 — Extend operator_status ENUM + rename column
--
-- The original `operators.status` column is typed
-- `operator_status` (PostgreSQL ENUM created at
-- 20260422000001_initial_schema.sql:19), already containing
-- 'pending' / 'approved' / 'suspended'. Phase 8 EXTENDS the
-- ENUM with 'rejected' (for admin's signup rejection flow)
-- and renames the column to `signup_status` to avoid confusion
-- with `empty_legs.status` (the status of a specific empty
-- leg listing) and `bookings.status` (the operational state
-- of a confirmed booking).
--
-- Codex round-6 implementation reality fix: rounds 0-5 of
-- the spec used a DROP/ADD CONSTRAINT pattern that would
-- have:
--   (a) silently no-op'd the DROP (no CHECK constraint exists
--       to drop — the column is constrained by the ENUM type)
--   (b) added a CHECK that PostgreSQL accepts but cannot
--       enforce against an ENUM column lacking 'rejected'
--   (c) left every INSERT/UPDATE with signup_status =
--       'rejected' failing at the SQL boundary with
--       `invalid input value for enum operator_status`
--
-- The patch: ALTER TYPE ADD VALUE is the ENUM-correct way to
-- extend. ADD VALUE IF NOT EXISTS makes it replayable on any
-- DB state (no-op if 'rejected' already in the type).
--
-- PostgreSQL pre-12 required ALTER TYPE ... ADD VALUE outside
-- a transaction. Supabase runs PG 15+, so this can ship in a
-- single atomic migration file.
-- ============================================================

ALTER TYPE operator_status ADD VALUE IF NOT EXISTS 'rejected';

-- Rename the column. PostgreSQL automatically updates any
-- dependent index (idx_operators_status → idx_operators_signup_status
-- in the catalog) without an explicit re-create. The ENUM
-- type itself stays named `operator_status` — only the column
-- is renamed.
ALTER TABLE operators
  RENAME COLUMN status TO signup_status;


-- ============================================================
-- §3.5 — operator_sessions
--
-- Cookie-based session storage for the Phase 8 operator portal
-- (locked decision §11: 7-day default TTL, 30-day with
-- "تذكّرني"). Mirrors the Phase 7 admin cookie discipline:
-- token_hash stores sha256(rawToken); the raw token never
-- touches the DB. The cookie itself carries the raw token in
-- a single string the portal middleware verifies against this
-- table on every request.
--
-- Two indexes:
--   - idx_..._token_hash partial WHERE revoked_at IS NULL
--     for the common "active session lookup" path
--   - idx_..._operator_active partial WHERE revoked_at IS NULL
--     for the "list active sessions for this operator" admin
--     view (PR 2b)
--
-- RLS enabled with no policies — service-role-only access.
-- The portal Server Actions run service-role; operators never
-- touch this table directly.
-- ============================================================

CREATE TABLE IF NOT EXISTS operator_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id     UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token_hash      VARCHAR(64) NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  remember_me     BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address      INET,
  user_agent      TEXT,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_token_hash
  ON operator_sessions(token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_operator_sessions_operator_active
  ON operator_sessions(operator_id, expires_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE operator_sessions ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.6 — operator_password_reset_tokens
--
-- Backs the email-reset-link recovery flow (locked decision §6
-- recovery flow #1). 30-min TTL, single-use. The reset RPC
-- (PR 2a) checks both expires_at > NOW() AND used_at IS NULL.
-- Once consumed, the row stays in the table for audit but
-- cannot be reused.
--
-- token_hash stores sha256(rawToken); the raw token only
-- exists in the email link sent to the operator.
-- ============================================================

CREATE TABLE IF NOT EXISTS operator_password_reset_tokens (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id   UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token_hash    VARCHAR(64) NOT NULL,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_password_reset_pending
  ON operator_password_reset_tokens(token_hash)
  WHERE used_at IS NULL;

ALTER TABLE operator_password_reset_tokens ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.7 — operator_otp_codes
--
-- Backs the WhatsApp OTP recovery flow (locked decision §6
-- recovery flow #2 + #3). 10-min TTL, single-use, max 5
-- verification attempts before the row is locked
-- (verify RPC bumps attempt_count and rejects when >= 5).
--
-- code_hash stores sha256(plaintext-6-digit) so even a DB
-- dump cannot leak codes. The plaintext only exists in the
-- WhatsApp message admin sends to the operator.
--
-- channel is currently 'whatsapp'-only; the CHECK is written
-- as an explicit IN (...) so future channels (sms / voice)
-- can be added with a single ALTER without table rebuild.
--
-- purpose distinguishes the two OTP use-cases:
--   - 'login' — operator types OTP at /operator/login/otp
--     to bypass password
--   - 'recovery' — admin issues OTP for the
--     password-recovery without-email-access scenario
-- ============================================================

CREATE TABLE IF NOT EXISTS operator_otp_codes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id   UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  code_hash     VARCHAR(64) NOT NULL,
  channel       TEXT NOT NULL CHECK (channel IN ('whatsapp')),
  purpose       TEXT NOT NULL CHECK (purpose IN ('login', 'recovery')),
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  attempt_count INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_otp_pending
  ON operator_otp_codes(operator_id, expires_at DESC)
  WHERE used_at IS NULL;

ALTER TABLE operator_otp_codes ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.8 — operator_documents
--
-- Stores Supabase Storage object metadata for the regulatory
-- documents admin uploads on the operator's behalf (locked
-- decision §3 + §8). The actual file lives under bucket
-- `operator-documents/<operator_id>/...` in Supabase Storage;
-- this table holds the row admin reads/writes via PR 2b's
-- admin form + PR 2c's read-only operator profile page.
--
-- The unique index ensures one document per type per
-- operator. Re-upload via the admin UI atomically deletes
-- the old row + inserts the new one in a single RPC (PR 2a's
-- replace_operator_document) so the unique index is never
-- temporarily violated.
--
-- uploaded_by_admin defaults TRUE because Phase 8 only ships
-- the admin upload path; the column is reserved for a future
-- phase that may let the operator upload directly.
-- ============================================================

CREATE TABLE IF NOT EXISTS operator_documents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id   UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('commercial_registration', 'gaca_license', 'license_expiry_proof')),
  storage_path  TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  file_size     BIGINT NOT NULL,
  content_type  TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by_admin BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_documents_unique
  ON operator_documents(operator_id, document_type);

ALTER TABLE operator_documents ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.9 — operator_signup_attempts (rate limiting)
--
-- Anti-spam log for self-signup. Locked decision §12: 3
-- attempts / IP / day; 24h ban after threshold. The signup
-- RPC (PR 2a's operator_signup) counts rows with
-- attempted_at > NOW() - INTERVAL '24 hours' AND
-- result = 'success' for the IP and rejects when >= 3.
-- Failed attempts (validation_failed / duplicate_email /
-- rate_limited) do NOT count against the cap — only
-- successful or duplicate-email submissions.
--
-- The IP-only rate limit is intentional: a real operator who
-- shares a VPN with a spammer can still sign up from a
-- different IP. Per-email rate limits would let an attacker
-- who knows a target's email lock the legitimate operator
-- out of signup.
--
-- email_attempted is nullable because a request can fail
-- before the email is parsed (e.g., malformed JSON body).
-- ============================================================

CREATE TABLE IF NOT EXISTS operator_signup_attempts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_address      INET NOT NULL,
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_attempted TEXT,
  result          TEXT NOT NULL CHECK (result IN ('success', 'duplicate_email', 'rate_limited', 'validation_failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_signup_attempts_ip_recent
  ON operator_signup_attempts(ip_address, attempted_at DESC);

ALTER TABLE operator_signup_attempts ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.10 — operator_notification_alert_status (singleton)
--
-- Codex round-1 P1 #3 fix: PR 2d (Resend + WhatsApp
-- notifications) needs a place to record the last send
-- attempt's health so PR 2b's /admin/operators list page can
-- render a red Arabic-RTL banner when send is failing.
--
-- Mirrors the Phase 7 §16 empty_leg_outreach_alert_status
-- pattern: singleton row enforced by id INT PRIMARY KEY
-- DEFAULT 1 CHECK (id = 1). The migration seeds the row
-- here so PR 2d's first send attempt has a row to UPDATE
-- (no race between the seed and the first send).
--
-- The status enum is constrained to three values:
--   - 'healthy'        — last send succeeded (or no sends yet)
--   - 'config_missing' — RESEND_API_KEY / required env vars
--                        unset; PR 2d's notification module
--                        sets this on the first attempt that
--                        finds them missing
--   - 'send_failed'    — last Resend call returned non-2xx
--                        or threw; PR 2b's admin banner
--                        surfaces the last_failure_reason
-- ============================================================

CREATE TABLE IF NOT EXISTS operator_notification_alert_status (
  id                   INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status               TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'config_missing', 'send_failed')),
  last_failure_at      TIMESTAMPTZ,
  last_failure_reason  TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO operator_notification_alert_status (id, status)
  VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE operator_notification_alert_status
  ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.11 — Audit trigger on operators
--
-- Status changes (signup_status) AND password changes are
-- logged to the existing audit_logs table. Two distinct
-- actions:
--   - 'signup_status_changed' — old/new value JSONB blob
--     captures the transition (e.g. 'pending' → 'approved'),
--     so the audit row is replayable
--   - 'password_changed'      — state-change event ONLY;
--     old_value AND new_value are NULL because logging a
--     hash (even a bcrypted one) into audit_logs would be a
--     low-grade leak (audit_logs has fewer access controls
--     than operators.password_hash)
--
-- The trigger fires on UPDATE only (signup_status / password
-- transitions are post-INSERT events). INSERT-time signup
-- does NOT log here — the operator_signup_attempts row in
-- §3.9 is the audit trail for signup attempts.
--
-- DROP TRIGGER IF EXISTS first so the migration is replayable
-- (CREATE TRIGGER would fail on a re-run otherwise; the
-- function itself uses CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION operators_audit_trigger()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.signup_status IS DISTINCT FROM NEW.signup_status THEN
    INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
      VALUES ('operator', NEW.id, 'signup_status_changed',
              jsonb_build_object('signup_status', OLD.signup_status),
              jsonb_build_object('signup_status', NEW.signup_status));
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
      VALUES ('operator', NEW.id, 'password_changed',
              NULL, NULL);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operators_audit_trigger ON operators;
CREATE TRIGGER operators_audit_trigger
  AFTER UPDATE ON operators
  FOR EACH ROW EXECUTE FUNCTION operators_audit_trigger();


-- ============================================================
-- Migration complete. Total surface added:
--   - 4 ALTER COLUMN DROP NOT NULL on operators (§3.1, §3.2)
--   - 12 new columns on operators (§3.3) + auth_email
--     NOT NULL invariant + unique LOWER() index. Two
--     pre-existing lifecycle columns (approved_at,
--     rejection_reason) are REUSED untouched.
--   - operator_status ENUM extended with 'rejected' (4th
--     value); operators.status renamed to signup_status
--     (§3.4) — ENUM type preserved, no CHECK constraint
--     added (Codex round-6 implementation reality fix).
--   - 6 new tables (§3.5–§3.10) with RLS enabled
--     (service-role-only access)
--   - operator_notification_alert_status singleton seeded
--   - audit trigger on operators (§3.11)
--
-- Founder probes after PR 1 (5 probes per spec §3 founder
-- probes — see CLAUDE-TASK.md for the full text):
--   1.  Schema state — \d+ operators shows 12 new columns +
--       2 reused (approved_at, rejection_reason) + renamed
--       signup_status (typed operator_status ENUM); auth_email
--       is NOT NULL; SELECT enum_range(NULL::operator_status)
--       returns {pending,approved,suspended,rejected}
--   2.  Six new tables — \dt operator_* lists all 6
--   3.  RLS posture — every new table has RLS enabled +
--       zero policies
--   4.  Audit trigger smoke — synthetic INSERT then UPDATE,
--       assert audit_logs row appears
--   4a. Alert-status singleton seed — SELECT id, status
--       returns (1, 'healthy')
--
-- After all 5 probes pass, PR 2a (RPC layer) can be merged
-- and applied. PR 2a depends on every column / table this
-- migration creates.
-- ============================================================
