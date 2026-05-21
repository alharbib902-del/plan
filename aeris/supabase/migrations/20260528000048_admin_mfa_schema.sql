-- ============================================
-- AERIS - Admin MFA Schema (Option B Phase 1c)
-- Migration: 20260528000048
-- ============================================
--
-- Adds per-admin TOTP MFA (RFC 6238) on top of the
-- admin_users foundation from PR #88. ADDITIVE ONLY — no
-- existing flow consumes these tables yet. PR-3b wires the
-- enrollment UI + login challenge step.
--
-- Tables:
--   admin_mfa_secrets         — at most one row per admin.
--                              Holds the BASE32-encoded TOTP
--                              seed in plaintext (stored at
--                              service-role-only with RLS
--                              deny-by-default; rotating to
--                              encrypted-at-rest is tracked
--                              as future work once a KMS
--                              integration ships).
--   admin_mfa_recovery_codes  — 10 codes per enrollment.
--                              code_hash stores sha256(raw_code);
--                              the raw code is shown ONCE at
--                              enrollment and never persisted.
--
-- RLS deny-by-default — anon/authenticated cannot read or write.
-- Server Actions go through service_role only.
-- ============================================

-- --------------------------------------------
-- 1. admin_mfa_secrets
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS admin_mfa_secrets (
  admin_user_id           UUID PRIMARY KEY
                            REFERENCES admin_users(id) ON DELETE CASCADE,
  -- RFC 4648 base32 (no padding). 32 chars = 160 bits, the
  -- canonical TOTP seed length per RFC 6238 §5.1 recommendation.
  secret_base32           VARCHAR(64) NOT NULL,
  -- NULL until the admin successfully completes the first OTP
  -- verification during enrollment. A row with enrolled_at=NULL
  -- is a "pending" enrollment that the login challenge MUST
  -- ignore (otherwise an in-progress setup would lock the
  -- admin out).
  enrolled_at             TIMESTAMPTZ,
  last_used_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_mfa_secrets_base32_format
    CHECK (secret_base32 ~ '^[A-Z2-7]+$' AND length(secret_base32) >= 26)
);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_secrets_enrolled
  ON admin_mfa_secrets (enrolled_at)
  WHERE enrolled_at IS NOT NULL;

ALTER TABLE admin_mfa_secrets ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies — service_role bypasses RLS.

COMMENT ON TABLE admin_mfa_secrets IS
  'Per-admin TOTP seed (RFC 6238). One row max per admin_users.id. enrolled_at NULL = pending; the login challenge ignores pending rows so an in-progress setup cannot lock the admin out.';

-- --------------------------------------------
-- 2. admin_mfa_recovery_codes
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS admin_mfa_recovery_codes (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_user_id           UUID NOT NULL
                            REFERENCES admin_users(id) ON DELETE CASCADE,
  -- sha256(raw_code) — the raw code is shown ONCE at
  -- enrollment and never persisted. Lookups compare hashes.
  code_hash               VARCHAR(64) NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at             TIMESTAMPTZ,
  consumed_session_id     UUID REFERENCES admin_user_sessions(id) ON DELETE SET NULL,
  CONSTRAINT admin_mfa_recovery_codes_hex_format
    CHECK (code_hash ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_mfa_recovery_codes_hash
  ON admin_mfa_recovery_codes (code_hash);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_recovery_codes_active
  ON admin_mfa_recovery_codes (admin_user_id)
  WHERE consumed_at IS NULL;

ALTER TABLE admin_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE admin_mfa_recovery_codes IS
  'One-time recovery codes for admin MFA. Hashes only; raw codes shown to the admin ONCE at enrollment. consumed_at flips to NOW() on first successful use; a consumed code can never be reused (UNIQUE on hash means the same code cannot be regenerated either).';

-- --------------------------------------------
-- 3. updated_at trigger for admin_mfa_secrets
-- --------------------------------------------

CREATE OR REPLACE FUNCTION touch_admin_mfa_secrets_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_mfa_secrets_touch_updated_at
  ON admin_mfa_secrets;
CREATE TRIGGER trg_admin_mfa_secrets_touch_updated_at
  BEFORE UPDATE ON admin_mfa_secrets
  FOR EACH ROW
  EXECUTE FUNCTION touch_admin_mfa_secrets_updated_at();
