-- ============================================================
-- AERIS — Admin offline settlement (mark booking paid)
-- Migration: 20260702000001  (forward-only)
-- ============================================================
-- The platform collects money OFFLINE today (bank transfer after WhatsApp
-- coordination), but nothing could flip bookings.payment_status → 'paid',
-- so the paid-state cascade (paid_at stamp + cashback award + tier eval +
-- the referral-reward cron) stayed frozen for every settled booking.
--
-- This migration adds ONE admin-facing RPC that records the offline
-- settlement in the payments ledger and flips the booking through the SAME
-- paid transition the gateway path uses. It does NOT touch the gateway RPCs
-- or the paid-state triggers.
--
-- Unlike the client gateway path (create_payment_attempt requires the
-- session client_id to own the booking), this RPC is admin-initiated:
-- the app layer enforces requireAdminSession(ADMIN_WRITE_ROLES), so guest
-- bookings (client_id NULL — Phase 4 guest mode) are markable too, and a
-- fully-cashback-redeemed booking (net = 0, which the gateway path rejects
-- as nothing_to_pay) can still be settled.

-- ---- §1 Allow 'offline' in payments.provider ---------------------------
-- Honest ledger: analytics must be able to tell gateway money from money
-- collected offline. (create_payment_attempt still defaults to 'hyperpay';
-- only the new RPC below writes 'offline'.)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_check;
ALTER TABLE payments ADD CONSTRAINT payments_provider_check
  CHECK (provider IN ('hyperpay', 'moyasar', 'offline'));

-- ---- §2 RPC: admin_mark_booking_paid_offline ---------------------------
-- Atomic + idempotent:
--   * bookings row locked FOR UPDATE → serialises with the gateway confirm
--     path (confirm_booking_payment locks the same row).
--   * already paid → ok:true, already:true (an admin double-click is a
--     no-op, mirroring confirm_booking_payment).
--   * a still-'initiated' gateway attempt is superseded → status 'failed',
--     provider_status 'superseded_by_offline': the admin confirmed the
--     money arrived offline, so the open checkout must never also confirm.
--     (Defence in depth — a late gateway confirm would hit the paid guard
--     and the one-success unique index anyway.)
--   * net (total − cashback redemption) > 0 → INSERT a provider='offline'
--     status='success' ledger row; uq_payments_one_success_per_booking is
--     the last-resort double-pay guard.
--   * net = 0 (fully redeemed) → no ledger row, the flip alone.
--   * UPDATE bookings SET payment_status='paid' → the existing triggers
--     stamp paid_at + award cashback + evaluate the tier; the referral
--     cron rewards on the referee's first paid booking.
CREATE OR REPLACE FUNCTION admin_mark_booking_paid_offline(
  p_booking_id UUID,
  p_reference  TEXT,
  p_raw        JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status  booking_payment_status;
  v_paid_at TIMESTAMPTZ;
  v_total   DECIMAL(12,2);
  v_redeem  DECIMAL(12,2);
  v_amount  DECIMAL(12,2);
  v_number  TEXT;
BEGIN
  SELECT payment_status, paid_at, total_amount,
         cashback_redemption_sar, booking_number
    INTO v_status, v_paid_at, v_total, v_redeem, v_number
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found');
  END IF;
  IF v_paid_at IS NOT NULL OR v_status = 'paid' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already', true, 'booking_number', v_number);
  END IF;
  IF v_status = 'refunded' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_refunded');
  END IF;

  v_amount := v_total - COALESCE(v_redeem, 0);

  UPDATE payments SET
    status          = 'failed',
    provider_status = 'superseded_by_offline'
  WHERE booking_id = p_booking_id AND status = 'initiated';

  IF v_amount > 0 THEN
    BEGIN
      INSERT INTO payments (
        booking_id, amount, currency, provider, status,
        gateway_transaction_id, provider_status, gateway_response
      ) VALUES (
        p_booking_id, v_amount, 'SAR', 'offline', 'success',
        NULLIF(BTRIM(COALESCE(p_reference, '')), ''),
        'manual_offline', COALESCE(p_raw, '{}'::jsonb)
      );
    EXCEPTION WHEN unique_violation THEN
      -- Another path already recorded a success for this booking.
      RETURN jsonb_build_object('ok', false, 'error', 'already_paid');
    END;
  END IF;

  UPDATE bookings SET payment_status = 'paid' WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'ok', true, 'booking_number', v_number, 'amount', v_amount);
END;
$$;

REVOKE ALL ON FUNCTION admin_mark_booking_paid_offline(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_mark_booking_paid_offline(UUID, TEXT, JSONB)
  TO service_role;

COMMENT ON FUNCTION admin_mark_booking_paid_offline(UUID, TEXT, JSONB) IS
  'Admin offline settlement: records a provider=''offline'' success ledger row (net > 0) and flips the booking to paid through the existing paid-state triggers. Idempotent; supersedes any live gateway attempt. App layer enforces admin RBAC.';
