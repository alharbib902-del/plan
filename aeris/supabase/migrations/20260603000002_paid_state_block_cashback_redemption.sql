-- DB-02 — extend paid-state immutability to cashback_redemption_sar.
--
-- reject_paid_state_mutation_after_paid() (§3.4, originally in
-- 20260519000043) froze total_amount, paid_at, and payment_status once
-- paid_at IS NOT NULL, but left cashback_redemption_sar mutable. That
-- column is subtracted inside calculate_client_qualified_spend_12m
-- (qualified spend = total_amount - cashback_redemption_sar), so an
-- admin UPDATE of a paid booking's redemption silently rewrites the
-- client's tier-qualifying spend window after the fact — the same class
-- of post-paid drift the other three fields are frozen against. v1 has
-- no refund/adjust RPC for paid bookings, so absolute immutability is
-- the only safe policy.
--
-- The guard fires ONLY when the value actually changes to a different
-- non-null value, so it never blocks a legitimate in-trigger award /
-- redemption write that sets the column (those run while paid_at is
-- still NULL, and never reset it to NULL).
--
-- CREATE OR REPLACE preserves the existing
-- trg_bookings_paid_state_immutable_after_paid trigger binding (no DROP
-- needed — the function body is replaced in place).
--
-- APPLIED TO PROD 2026-06-08 (via the migration-runner over the session
-- pooler; reports/live-schema-compact.json snapshot refreshed).
-- =============================================================

CREATE OR REPLACE FUNCTION reject_paid_state_mutation_after_paid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.paid_at IS NOT NULL THEN
    IF NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
      RAISE EXCEPTION 'bookings_total_amount_immutable_after_paid: cannot mutate total_amount once paid_at is set (booking_id=%)', OLD.id
        USING ERRCODE = '22023';
    END IF;
    IF NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
      RAISE EXCEPTION 'bookings_paid_at_immutable_after_set: cannot mutate paid_at once set (booking_id=%, old=%, new=%)', OLD.id, OLD.paid_at, NEW.paid_at
        USING ERRCODE = '22023';
    END IF;
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      RAISE EXCEPTION 'bookings_payment_status_immutable_after_paid: cannot mutate payment_status once paid_at is set (booking_id=%, old=%, new=%)', OLD.id, OLD.payment_status, NEW.payment_status
        USING ERRCODE = '22023';
    END IF;
    -- Only block a genuine post-paid CHANGE to a non-null value; the
    -- in-trigger award/redemption path that first sets this column runs
    -- before paid_at exists, so it is never affected.
    IF NEW.cashback_redemption_sar IS DISTINCT FROM OLD.cashback_redemption_sar
       AND NEW.cashback_redemption_sar IS NOT NULL THEN
      RAISE EXCEPTION 'bookings_cashback_redemption_immutable_after_paid: cannot mutate cashback_redemption_sar once paid_at is set (booking_id=%, old=%, new=%)', OLD.id, OLD.cashback_redemption_sar, NEW.cashback_redemption_sar
        USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
