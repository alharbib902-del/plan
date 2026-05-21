-- ============================================
-- AERIS - Admin Sessions MFA Pending (Option B Phase 1d)
-- Migration: 20260528000049
-- ============================================
--
-- Adds a `mfa_pending` flag to admin_user_sessions so the
-- post-password login flow can issue a SCOPED session that
-- grants nothing except access to the MFA challenge page +
-- the challenge Server Action.
--
-- Default: false. Existing sessions get `false` automatically
-- (NOT NULL DEFAULT false) so PR-3b's deploy doesn't lock out
-- already-logged-in admins. New sessions for admins with
-- active MFA enrollment will be created with mfa_pending=true
-- by the signIn Server Action; the challenge verify clears it.
-- ============================================

ALTER TABLE admin_user_sessions
  ADD COLUMN IF NOT EXISTS mfa_pending BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_admin_user_sessions_mfa_pending
  ON admin_user_sessions (admin_user_id)
  WHERE mfa_pending = true;

COMMENT ON COLUMN admin_user_sessions.mfa_pending IS
  'When true, the session holder has authenticated with email+password but has not yet completed the MFA TOTP / recovery-code challenge. requireAdminSession() denies all access except the challenge page + action while this is true.';
