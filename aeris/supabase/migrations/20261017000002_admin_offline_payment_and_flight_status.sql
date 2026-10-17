-- ============================================
-- AERIS — Admin offline-payment confirmation + flight-status control
-- Migration: 20261017000002  (forward-only, idempotent)
-- ============================================
-- WHY: money is collected OFFLINE today (bank transfer / WhatsApp —
-- manual-settlement mode, ENABLE_PAYMENTS off), but the ONLY writer of
-- bookings.payment_status = 'paid' is confirm_booking_payment
-- (20260531000010), which needs a live gateway attempt. So in manual mode
-- no booking ever becomes paid, and everything keyed on the paid state is
-- dead: cashback award + Privilege tier evaluation (bookings paid-state
-- triggers, 20260520000044), referral rewards (referral cron, qualifies on
-- payment_status='paid' AND paid_at IS NOT NULL — 20260531000006) and
-- admin revenue analytics (admin_analytics_summary, by paid_at —
-- 20260531000007). Likewise nothing moves flight_status off 'confirmed',
-- and create_review requires flight_status='completed'
-- (20260531000002), so clients can never leave a review.
--
-- This migration adds two admin-only RPCs:
--   1. admin_confirm_offline_payment — flips an unpaid booking to 'paid'
--      with the SAME single statement confirm_booking_payment uses
--      (`UPDATE bookings SET payment_status = 'paid'`), so the EXISTING
--      paid-state machinery fires identically and is NOT modified here:
--        * trg_bookings_stamp_paid_at_upd (BEFORE UPDATE OF payment_status)
--          stamps paid_at;
--        * trg_bookings_paid_award_after_upd (AFTER UPDATE OF payment_status)
--          runs award_cashback_for_booking + evaluate_client_privilege_tier;
--        * the referral cron + analytics read payment_status/paid_at;
--        * trg_bookings_paid_state_immutable_after_paid allows this first
--          transition (paid_at was NULL) and freezes the row afterwards.
--      It also records the settlement in the `payments` ledger
--      (provider='offline', status='success') so the ledger stays the
--      source of truth and uq_payments_one_success_per_booking keeps
--      guarding against a second success for the same booking.
--   2. admin_set_flight_status — forward-only operational transitions on
--      the booking_flight_status ENUM (confirmed → boarding → in_flight →
--      completed, skipping allowed; cancel only before departure), which
--      unlocks reviews once a PAID flight is completed.
--
-- Both are SECURITY DEFINER + search_path = public, pg_temp +
-- service_role-only, lock the booking FOR UPDATE, are idempotent, and
-- write an audit_logs row (actor in new_value — audit_logs.user_id is a
-- users FK; admins live in admin_users).

-- ---- §1 payments ledger: allow the 'offline' provider ----------------------
-- payments_provider_check (20260531000010) only allows gateway providers.
-- An offline settlement is a real receipt that belongs in the ledger, so the
-- CHECK is widened. provider is TEXT + CHECK (not an ENUM), so no
-- ALTER TYPE ... ADD VALUE (and its same-transaction restriction) is needed.
-- Idempotent: only rebuilt while the definition does not yet allow 'offline'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_provider_check'
      AND conrelid = 'public.payments'::regclass
      AND pg_get_constraintdef(oid) LIKE '%offline%'
  ) THEN
    ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_provider_check;
    ALTER TABLE payments
      ADD CONSTRAINT payments_provider_check
      CHECK (provider IN ('hyperpay', 'moyasar', 'offline'));
  END IF;
END $$;

-- ---- §2 RPC: admin_confirm_offline_payment ----------------------------------
-- p_received_amount is the amount the admin confirms receiving. It must
-- equal the booking's authoritative net (total − cashback redemption), the
-- same reconciliation confirm_booking_payment applies to the gateway amount:
-- a partial transfer, or a net that changed (cashback redeemed) after the
-- admin opened the page, must NOT flip the booking. TEXT → NUMERIC is parsed
-- inside the DB (no JS float edge), mirroring p_provider_amount.
CREATE OR REPLACE FUNCTION admin_confirm_offline_payment(
  p_booking_id      UUID,
  p_admin_user_id   UUID,
  p_received_amount TEXT,
  p_reference       TEXT,
  p_note            TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reference      TEXT;
  v_note           TEXT;
  v_received       NUMERIC;
  v_status         booking_payment_status;
  v_flight         booking_flight_status;
  v_paid_at        TIMESTAMPTZ;
  v_total          DECIMAL(14,2);
  v_redeem         DECIMAL(14,2);
  v_net            DECIMAL(14,2);
  v_booking_number TEXT;
  v_payment_id     UUID;
  v_new_paid_at    TIMESTAMPTZ;
BEGIN
  v_reference := NULLIF(BTRIM(COALESCE(p_reference, '')), '');
  IF v_reference IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reference_required');
  END IF;
  IF length(v_reference) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reference_too_long');
  END IF;

  v_note := NULLIF(BTRIM(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'note_too_long');
  END IF;

  -- Defence in depth behind the app-layer requireAdminSession gate: the
  -- actor recorded in the ledger + audit must be a real, active admin.
  IF p_admin_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM admin_users
    WHERE id = p_admin_user_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_not_authorized');
  END IF;

  BEGIN
    v_received := NULLIF(BTRIM(COALESCE(p_received_amount, '')), '')::NUMERIC;
  EXCEPTION WHEN others THEN
    v_received := NULL;
  END;
  IF v_received IS NULL OR v_received <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_invalid');
  END IF;

  -- Booking lock FIRST (same order as create_payment_attempt and
  -- redeem_cashback_for_booking) → serialises against a concurrent
  -- redemption / attempt creation / second confirm for this booking.
  SELECT payment_status, flight_status, paid_at, total_amount,
         cashback_redemption_sar, booking_number
    INTO v_status, v_flight, v_paid_at, v_total, v_redeem, v_booking_number
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found');
  END IF;

  -- Idempotent re-call: already paid → no ledger row, no audit row, no
  -- UPDATE (so the paid-state triggers cannot fire twice).
  IF v_paid_at IS NOT NULL OR v_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true,
      'booking_id', p_booking_id);
  END IF;

  -- Only the unpaid states are confirmable ('pending' is the legacy
  -- pre-Phase-6.2 default; 'refunded' is never re-opened here). The column
  -- is nullable: a NULL status fails closed, because the paid-state
  -- triggers' WHEN (OLD.payment_status != 'paid') is NULL for it and would
  -- silently skip the cashback/tier cascade.
  IF v_status IS NULL OR v_status NOT IN ('pending_offline', 'pending') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_confirmable');
  END IF;
  IF v_flight = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_cancelled');
  END IF;

  -- An in-flight ONLINE checkout means the client may be paying by card
  -- right now; confirming offline too risks a double collection. Resolve
  -- the gateway attempt first. (Read-only check — payment rows are not
  -- locked here, so there is no lock-order inversion with
  -- confirm_booking_payment, which locks payment → booking.)
  IF EXISTS (
    SELECT 1 FROM payments
    WHERE booking_id = p_booking_id AND status = 'initiated'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_has_active_payment');
  END IF;

  v_net := v_total - COALESCE(v_redeem, 0);
  IF v_net <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_pay');
  END IF;
  IF v_received <> v_net THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_mismatch',
      'expected_amount', v_net);
  END IF;

  BEGIN
    INSERT INTO payments (
      booking_id, amount, currency, provider, gateway, idempotency_key,
      status, gateway_transaction_id, provider_status, gateway_response
    ) VALUES (
      p_booking_id, v_net, 'SAR', 'offline', 'offline',
      'offline:' || p_booking_id::text,
      'success', v_reference, 'offline_confirmed',
      jsonb_build_object(
        'source', 'admin_offline',
        'reference', v_reference,
        'note', v_note,
        'admin_user_id', p_admin_user_id
      )
    )
    RETURNING id INTO v_payment_id;
  EXCEPTION WHEN unique_violation THEN
    -- uq_payments_one_success_per_booking / the offline idempotency key:
    -- a success already exists for this booking — never double-record.
    RETURN jsonb_build_object('ok', false, 'error', 'already_paid');
  END;

  -- The exact flip confirm_booking_payment performs → the existing
  -- BEFORE/AFTER paid-state triggers stamp paid_at, award cashback and
  -- evaluate the tier inside THIS transaction (a trigger failure aborts
  -- the whole confirmation, ledger row included).
  UPDATE bookings SET payment_status = 'paid'
  WHERE id = p_booking_id
  RETURNING paid_at INTO v_new_paid_at;

  INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
  VALUES (
    'bookings',
    p_booking_id,
    'booking_offline_payment_confirmed',
    jsonb_build_object('payment_status', v_status),
    jsonb_build_object(
      'actor_type', 'admin',
      'actor_admin_user_id', p_admin_user_id,
      'booking_number', v_booking_number,
      'payment_status', 'paid',
      'paid_at', v_new_paid_at,
      'amount_sar', v_net,
      'total_amount_sar', v_total,
      'cashback_redemption_sar', COALESCE(v_redeem, 0),
      'reference', v_reference,
      'note', v_note,
      'payment_id', v_payment_id
    )
  );

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id,
    'payment_id', v_payment_id, 'amount_sar', v_net, 'paid_at', v_new_paid_at);
END;
$$;

-- ---- §3 RPC: admin_set_flight_status -----------------------------------------
-- Forward-only over booking_flight_status (confirmed|boarding|in_flight|
-- completed|cancelled). Skipping intermediate steps is allowed because in
-- manual mode the team usually records the outcome after the fact:
--   confirmed → boarding | in_flight | completed | cancelled
--   boarding  → in_flight | completed | cancelled
--   in_flight → completed
--   completed, cancelled → terminal
-- Guards:
--   * completed requires payment_status='paid': completion unlocks client
--     reviews and closes the trip, so an unpaid booking must not be closed
--     out with the receivable still open (the paid flip is also what awards
--     cashback / evaluates the tier — completion must never precede it).
--   * completed requires the scheduled departure to have passed.
--   * cancelled only before departure (from confirmed/boarding) and only
--     while UNPAID with no cashback redemption: cancelling a paid or
--     redeemed booking needs a refund / refund_back flow, which is deferred
--     — the paid state is immutable and must not drift from the ledger.
--     A reason (note) is required and the checkout-prep token is revoked.
CREATE OR REPLACE FUNCTION admin_set_flight_status(
  p_booking_id    UUID,
  p_admin_user_id UUID,
  p_status        booking_flight_status,
  p_note          TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_note           TEXT;
  v_current        booking_flight_status;
  v_pay_status     booking_payment_status;
  v_paid_at        TIMESTAMPTZ;
  v_redeem         DECIMAL(14,2);
  v_departure      TIMESTAMPTZ;
  v_booking_number TEXT;
  v_allowed        BOOLEAN;
BEGIN
  IF p_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'status_required');
  END IF;

  v_note := NULLIF(BTRIM(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'note_too_long');
  END IF;

  IF p_admin_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM admin_users
    WHERE id = p_admin_user_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_not_authorized');
  END IF;

  SELECT flight_status, payment_status, paid_at, cashback_redemption_sar,
         departure_scheduled, booking_number
    INTO v_current, v_pay_status, v_paid_at, v_redeem,
         v_departure, v_booking_number
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found');
  END IF;

  -- Idempotent: same status → no write, no audit row.
  IF v_current = p_status THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true,
      'booking_id', p_booking_id, 'flight_status', v_current);
  END IF;

  v_allowed := CASE v_current
    WHEN 'confirmed' THEN p_status IN ('boarding', 'in_flight', 'completed', 'cancelled')
    WHEN 'boarding'  THEN p_status IN ('in_flight', 'completed', 'cancelled')
    WHEN 'in_flight' THEN p_status = 'completed'
    ELSE false
  END;
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transition_not_allowed',
      'current_status', v_current);
  END IF;

  IF p_status = 'completed' THEN
    IF v_pay_status <> 'paid' OR v_paid_at IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_required_before_completion');
    END IF;
    IF v_departure > now() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'departure_in_future');
    END IF;
  END IF;

  IF p_status = 'cancelled' THEN
    IF v_pay_status = 'paid' OR v_paid_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'cancel_paid_requires_refund');
    END IF;
    IF COALESCE(v_redeem, 0) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'cancel_has_cashback_redemption');
    END IF;
    IF EXISTS (
      SELECT 1 FROM payments
      WHERE booking_id = p_booking_id AND status = 'initiated'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'booking_has_active_payment');
    END IF;
    IF v_note IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'cancel_reason_required');
    END IF;

    UPDATE bookings
      SET flight_status             = 'cancelled',
          cancelled_at              = now(),
          cancellation_reason       = v_note,
          checkout_token_hash       = NULL,
          checkout_token_expires_at = NULL
    WHERE id = p_booking_id;
  ELSE
    UPDATE bookings SET flight_status = p_status WHERE id = p_booking_id;
  END IF;

  INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
  VALUES (
    'bookings',
    p_booking_id,
    'booking_flight_status_changed',
    jsonb_build_object('flight_status', v_current),
    jsonb_build_object(
      'actor_type', 'admin',
      'actor_admin_user_id', p_admin_user_id,
      'booking_number', v_booking_number,
      'flight_status', p_status,
      'note', v_note
    )
  );

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id,
    'flight_status', p_status, 'previous_status', v_current);
END;
$$;

-- ---- §4 Grants — service_role ONLY ------------------------------------------
REVOKE ALL ON FUNCTION admin_confirm_offline_payment(UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_confirm_offline_payment(UUID, UUID, TEXT, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION admin_set_flight_status(UUID, UUID, booking_flight_status, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_set_flight_status(UUID, UUID, booking_flight_status, TEXT)
  TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
