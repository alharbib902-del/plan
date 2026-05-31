-- ============================================
-- AERIS — Payment core (Phase: payments, PR1)
-- Migration: 20260531000010  (forward-only)
-- ============================================
-- Drives a booking from payment_status='pending_offline' → 'paid' through a
-- real gateway payment, then lets the EXISTING paid-state machinery cascade:
-- the bookings BEFORE/AFTER triggers stamp paid_at, award cashback
-- (award_cashback_for_booking), evaluate the privilege tier, and the referral
-- cron rewards on the referee's first paid booking. **This migration does NOT
-- touch those triggers or the immutability guard.**
--
-- The payment gateway (HyperPay COPYandPAY) is wired in the app layer; here we
-- build the gateway-agnostic ledger: extend `payments` (the source of truth),
-- add `payment_events` (webhook idempotency/audit), and the RPCs that create a
-- payment attempt + confirm it (server-side-verified) + record raw events.
--
-- Security: all RPCs SECURITY DEFINER + search_path=public + service_role-only.
-- `payments`/`payment_events` are RLS deny-all (payments already had RLS on;
-- payment_events gets it here). Identity (client_id) is session-derived; the
-- create RPC enforces booking ownership.

-- ---- §1 Extend `payments` into a real gateway ledger -------------------------
-- payments is currently UNUSED (no rows); these adds are safe.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'hyperpay',
  ADD COLUMN IF NOT EXISTS checkout_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT;

-- payment_method is unknown at COPYandPAY initiation (the widget collects it);
-- it is set at confirmation from the gateway-reported brand. Relax NOT NULL.
ALTER TABLE payments ALTER COLUMN payment_method DROP NOT NULL;

-- Exactly ONE successful payment per booking (defence-in-depth idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_success_per_booking
  ON payments (booking_id) WHERE status = 'success';

CREATE INDEX IF NOT EXISTS idx_payments_checkout_id
  ON payments (checkout_id) WHERE checkout_id IS NOT NULL;

REVOKE ALL ON payments FROM anon, authenticated;

-- ---- §2 payment_events (webhook idempotency + raw audit) ---------------------
CREATE TABLE IF NOT EXISTS payment_events (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider           TEXT NOT NULL,
  -- Idempotency key: the provider's stable event id when present, else a
  -- deterministic hash derived by the app (provider:payment|checkout:status:
  -- amount:sha256(rawBody)). UNIQUE so replays/duplicates collapse.
  provider_event_key TEXT NOT NULL UNIQUE,
  provider_event_id  TEXT,
  payment_id         UUID REFERENCES payments(id) ON DELETE SET NULL,
  booking_id         UUID REFERENCES bookings(id) ON DELETE SET NULL,
  event_type         TEXT,
  raw_payload        JSONB,
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  processed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment
  ON payment_events (payment_id) WHERE payment_id IS NOT NULL;

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: deny-all for anon/authenticated. Service-role only.
REVOKE ALL ON payment_events FROM anon, authenticated;

-- ---- §3 RPC: create_payment_attempt -----------------------------------------
-- Opens an attempt for an owned, unpaid booking. Amount is DERIVED from the
-- booking (total − cashback redemption) — never trusted from the client — so
-- it always reconciles. Returns the amount for the gateway checkout call.
CREATE OR REPLACE FUNCTION create_payment_attempt(
  p_booking_id      UUID,
  p_client_id       UUID,
  p_provider        TEXT,
  p_checkout_id     TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client     UUID;
  v_status     booking_payment_status;
  v_paid_at    TIMESTAMPTZ;
  v_total      DECIMAL(12,2);
  v_redeem     DECIMAL(12,2);
  v_amount     DECIMAL(12,2);
  v_payment_id UUID;
BEGIN
  SELECT client_id, payment_status, paid_at, total_amount, cashback_redemption_sar
    INTO v_client, v_status, v_paid_at, v_total, v_redeem
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_client IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found');
  END IF;
  IF v_client <> p_client_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_owner');
  END IF;
  IF v_paid_at IS NOT NULL OR v_status = 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_paid');
  END IF;

  v_amount := v_total - COALESCE(v_redeem, 0);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_pay');
  END IF;

  INSERT INTO payments (
    booking_id, amount, currency, provider, checkout_id, idempotency_key, status
  ) VALUES (
    p_booking_id, v_amount, 'SAR',
    COALESCE(NULLIF(trim(p_provider), ''), 'hyperpay'),
    NULLIF(trim(COALESCE(p_checkout_id, '')), ''),
    NULLIF(trim(COALESCE(p_idempotency_key, '')), ''),
    'initiated'
  ) RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object('ok', true, 'payment_id', v_payment_id, 'amount', v_amount);
END;
$$;

-- ---- §4 RPC: confirm_booking_payment (server-verified) ----------------------
-- Called ONLY after the app verifies success via a server-side status lookup
-- against the gateway. Atomic + idempotent: locks the attempt, then the
-- booking; re-validates the net amount; marks the payment success and flips
-- the booking to 'paid' (paid_at NULL → the immutability guard allows this
-- first transition; the paid-state triggers then cascade cashback/tier).
CREATE OR REPLACE FUNCTION confirm_booking_payment(
  p_payment_id     UUID,
  p_provider_txn   TEXT,
  p_provider_status TEXT,
  p_method         TEXT,
  p_raw            JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking   UUID;
  v_pay_status payment_status;
  v_pay_amount DECIMAL(12,2);
  v_b_status  booking_payment_status;
  v_b_paid_at TIMESTAMPTZ;
  v_total     DECIMAL(12,2);
  v_redeem    DECIMAL(12,2);
  v_method    payment_method;
BEGIN
  SELECT booking_id, status, amount
    INTO v_booking, v_pay_status, v_pay_amount
  FROM payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found');
  END IF;
  IF v_pay_status = 'success' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'booking_id', v_booking);
  END IF;
  IF v_pay_status <> 'initiated' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_confirmable');
  END IF;

  SELECT payment_status, paid_at, total_amount, cashback_redemption_sar
    INTO v_b_status, v_b_paid_at, v_total, v_redeem
  FROM bookings
  WHERE id = v_booking
  FOR UPDATE;

  IF v_b_paid_at IS NOT NULL OR v_b_status = 'paid' THEN
    -- Booking already paid (possibly via another attempt) — don't double-pay.
    RETURN jsonb_build_object('ok', true, 'already', true, 'booking_id', v_booking);
  END IF;

  -- Net-payable invariant must still hold (redemption could have changed).
  IF v_pay_amount <> (v_total - COALESCE(v_redeem, 0)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  END IF;

  v_method := CASE
    WHEN p_method IN ('apple_pay', 'mada', 'visa', 'mastercard', 'stc_pay')
      THEN p_method::payment_method ELSE NULL END;

  BEGIN
    UPDATE payments SET
      status                 = 'success',
      gateway_transaction_id = NULLIF(trim(COALESCE(p_provider_txn, '')), ''),
      provider_status        = p_provider_status,
      payment_method         = COALESCE(v_method, payment_method),
      gateway_response       = COALESCE(p_raw, gateway_response)
    WHERE id = p_payment_id;

    -- Flip the booking → triggers stamp paid_at + award cashback + tier eval.
    UPDATE bookings SET payment_status = 'paid' WHERE id = v_booking;
  EXCEPTION WHEN unique_violation THEN
    -- another attempt already succeeded for this booking
    RETURN jsonb_build_object('ok', false, 'error', 'already_paid');
  END;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking);
END;
$$;

-- ---- §5 RPC: fail_payment_attempt -------------------------------------------
CREATE OR REPLACE FUNCTION fail_payment_attempt(
  p_payment_id      UUID,
  p_provider_status TEXT,
  p_raw             JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status payment_status;
BEGIN
  SELECT status INTO v_status FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found');
  END IF;
  IF v_status = 'success' THEN
    -- never override a confirmed success
    RETURN jsonb_build_object('ok', false, 'error', 'already_succeeded');
  END IF;
  UPDATE payments SET
    status = 'failed', provider_status = p_provider_status,
    gateway_response = COALESCE(p_raw, gateway_response)
  WHERE id = p_payment_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---- §6 RPC: record_payment_event (webhook claim, idempotent) ---------------
-- Stores a raw gateway event. Returns the new row id, or NULL when the
-- provider_event_key was already recorded (duplicate/replay → no-op).
CREATE OR REPLACE FUNCTION record_payment_event(
  p_provider           TEXT,
  p_provider_event_key TEXT,
  p_provider_event_id  TEXT,
  p_payment_id         UUID,
  p_booking_id         UUID,
  p_event_type         TEXT,
  p_raw                JSONB,
  p_signature_verified BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO payment_events (
    provider, provider_event_key, provider_event_id, payment_id, booking_id,
    event_type, raw_payload, signature_verified
  ) VALUES (
    p_provider, p_provider_event_key, NULLIF(trim(COALESCE(p_provider_event_id, '')), ''),
    p_payment_id, p_booking_id, p_event_type, p_raw, COALESCE(p_signature_verified, false)
  )
  ON CONFLICT (provider_event_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---- §7 Grants — service_role ONLY ------------------------------------------
REVOKE ALL ON FUNCTION create_payment_attempt(UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_payment_attempt(UUID, UUID, TEXT, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION confirm_booking_payment(UUID, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_booking_payment(UUID, TEXT, TEXT, TEXT, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION fail_payment_attempt(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fail_payment_attempt(UUID, TEXT, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION record_payment_event(TEXT, TEXT, TEXT, UUID, UUID, TEXT, JSONB, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_payment_event(TEXT, TEXT, TEXT, UUID, UUID, TEXT, JSONB, BOOLEAN)
  TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
