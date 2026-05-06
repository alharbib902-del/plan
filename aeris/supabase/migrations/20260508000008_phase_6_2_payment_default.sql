-- ============================================================
-- Phase 6.2 — Priced Add-ons + Booking-shaped Checkout-prep
-- PR 1, File B: SET DEFAULT only
-- ============================================================
--
-- One statement: set bookings.payment_status default to
-- 'pending_offline'. Runs in a fresh Supabase migration
-- session AFTER File A's commit, so the ENUM value the
-- literal references is already visible to the parser
-- (PostgreSQL ALTER TYPE ... ADD VALUE has a read-after-add
-- restriction inside the same transaction; splitting into
-- two files eliminates it). Codex iteration-2 P1 fix.
--
-- File A (20260508000007_phase_6_2_addons.sql) MUST have
-- applied first. Founder probe #3 verifies both have run by
-- checking that the ENUM contains 'pending_offline' AND the
-- default is 'pending_offline'.
--
-- Idempotent: SET DEFAULT is naturally idempotent (re-runs
-- write the same default).
--
-- Existing rows keep their current default ('pending')
-- because no production rows exist (bookings has never been
-- written to — see Schema reality in the Phase 6.2 spec).
-- ============================================================

ALTER TABLE bookings
  ALTER COLUMN payment_status SET DEFAULT 'pending_offline';
