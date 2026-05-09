-- ============================================================
-- Phase 8 PR 2a — HOTFIX: revoke EXECUTE from anon + authenticated
--
-- Production-discovered defect on 2026-05-09 during founder Probe 5
-- (RPC grants ACL probe). Every SECURITY DEFINER function in Phase
-- 7 PR 2e and Phase 8 PR 2a was discovered to be exposed to `anon`
-- AND `authenticated` AS WELL AS the intended `service_role`. Any
-- unauthenticated visitor could therefore call admin RPCs (approve /
-- reject / suspend / reset_password) over the REST surface.
--
-- Root cause: the migration's `REVOKE ALL ... FROM PUBLIC` only
-- revokes the PUBLIC pseudo-role, NOT the explicit grants Supabase's
-- initial setup (`ALTER DEFAULT PRIVILEGES`) gives `anon` and
-- `authenticated` on every newly-created public function. A correct
-- pattern would have been:
--
--   REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION ... TO service_role;
--
-- The Phase 7 PR 2a (round-1 functions) used a stricter REVOKE list
-- and is unaffected. The Phase 7 PR 2e migration (publish_empty_leg_event +
-- expire_empty_leg_window) and the Phase 8 PR 2a migration (17 publics +
-- 2 helpers) used the partial pattern and are exposed.
--
-- Production was patched manually via Dashboard SQL Editor on
-- 2026-05-09 immediately after Probe 5 surfaced the defect; this
-- migration ships the same statements through the migration history
-- so a fresh staging restore / disaster-recovery replay applies the
-- fix automatically. Codex hotfix exemption requested: surgical
-- no-behavior-delta ACL change with explicit founder verification
-- via Probe 5 re-run.
--
-- Idempotent: REVOKE EXECUTE on a role that already lacks the grant
-- is silently accepted by PostgreSQL, so re-applying this migration
-- (or applying it on top of the manual production patch) is a no-op.
-- ============================================================


-- ============================================================
-- Phase 8 PR 2a — 17 publics
--
-- Each public stays callable by service_role only. The `service_role`
-- grant from the original 20260513000021 migration is preserved
-- (not touched here) — this hotfix only REVOKEs the unintended
-- anon + authenticated grants.
-- ============================================================

REVOKE EXECUTE ON FUNCTION operator_signup(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INET) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION operator_login_lookup(TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION operator_login_create_session(UUID, TEXT, BOOLEAN, INET, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION operator_logout(TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION operator_session_validate(TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_approve_operator(UUID, VARCHAR, TIMESTAMPTZ) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_reject_operator(UUID, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_suspend_operator(UUID, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_unsuspend_operator(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_set_operator_documents(UUID, TEXT, TEXT, DATE) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_reset_operator_password(UUID, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION mint_operator_password_reset_token(TEXT, VARCHAR, TIMESTAMPTZ, INET) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION verify_operator_password_reset(VARCHAR, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION mint_operator_otp(UUID, VARCHAR, TEXT, TIMESTAMPTZ) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION verify_operator_otp(UUID, VARCHAR) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION convert_phase7_stub_to_operator(UUID, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION consume_operator_welcome_token(VARCHAR, VARCHAR, BOOLEAN, INET, TEXT) FROM anon, authenticated;


-- ============================================================
-- Phase 8 PR 2a — 2 helpers
--
-- Helpers are internal-only — callable from inside SECURITY DEFINER
-- publics via the function-owner role, never directly. REVOKE from
-- service_role too so the catalog matches the spec contract
-- (`non_owner_grants IS NULL` per Probe 5 expectation).
-- ============================================================

REVOKE EXECUTE ON FUNCTION _normalize_operator_email(TEXT) FROM anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION _is_sha256_hex(TEXT) FROM anon, authenticated, service_role;


-- ============================================================
-- Phase 7 PR 2e — 2 functions inheriting the same defect
--
-- These were added by 20260511000012_phase_7_empty_legs_match_event.sql
-- after Phase 7 PR 2a's stricter REVOKE pattern was forgotten:
--
--   REVOKE ALL ON FUNCTION publish_empty_leg_event(UUID, TEXT) FROM PUBLIC;
--   GRANT EXECUTE ON FUNCTION publish_empty_leg_event(UUID, TEXT) TO service_role;
--
-- Same partial PUBLIC-only revoke as Phase 8. Both are intended for
-- service-role callers exclusively (matching engine + cron route).
-- ============================================================

REVOKE EXECUTE ON FUNCTION publish_empty_leg_event(UUID, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION expire_empty_leg_window(UUID) FROM anon, authenticated;


-- ============================================================
-- Founder verification (after this migration applies)
--
-- Re-run Phase 8 spec §4 founder Probe 5 (the catalog allowlist +
-- ACL semantic query). Expect EXACTLY:
--
--   - 17 PR 2a publics:
--       non_owner_grants = 'service_role:EXECUTE' (no PUBLIC, no anon,
--                                                  no authenticated)
--   - 2 PR 2a helpers:
--       non_owner_grants IS NULL
--
-- Then re-run the global SECURITY DEFINER exposure scan; expect only
-- the baseline of `is_admin` (RLS utility) + `st_estimatedextent`
-- (PostGIS extension) — no Phase 7 / Phase 8 functions should appear.
-- ============================================================
