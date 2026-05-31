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
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  -- Single-flight guard: only the request that wins this claim calls the
  -- gateway, so concurrent inits with the same idempotency key cannot each
  -- create an (orphan) external checkout. A stale claim is re-claimable.
  ADD COLUMN IF NOT EXISTS checkout_claimed_at TIMESTAMPTZ,
  -- Per-claim token: attach/release accept ONLY the current claim owner, so a
  -- late call from a superseded (stale-reclaimed) claim cannot taint the row.
  ADD COLUMN IF NOT EXISTS checkout_creation_token TEXT;

-- payment_method is unknown at COPYandPAY initiation (the widget collects it);
-- it is set at confirmation from the gateway-reported brand. Relax NOT NULL.
ALTER TABLE payments ALTER COLUMN payment_method DROP NOT NULL;

-- Exactly ONE successful payment per booking (defence-in-depth idempotency).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_success_per_booking
  ON payments (booking_id) WHERE status = 'success';

-- At most ONE active (initiated) attempt per booking — a fresh idempotency key
-- must NOT spawn a second live checkout for the same booking (create reuses it).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_initiated_per_booking
  ON payments (booking_id) WHERE status = 'initiated';

-- Caller-supplied idempotency key (a per-checkout-intent uuid): dedups
-- rapid duplicate initiations; a fresh retry uses a fresh key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency_key
  ON payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_checkout_id
  ON payments (checkout_id) WHERE checkout_id IS NOT NULL;

-- Constrain provider to the known set (idempotent add).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_provider_check'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_provider_check
      CHECK (provider IN ('hyperpay', 'moyasar'));
  END IF;
END $$;

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

-- ---- §3 RPC: create_payment_attempt (idempotent, attempt-first) -------------
-- Opens (or reuses) an attempt for an owned, unpaid booking BEFORE any gateway
-- call, so a failed gateway create never orphans an external checkout. Amount
-- is DERIVED from the booking (total − cashback redemption), never trusted.
-- The caller passes a per-intent idempotency key (uuid): a duplicate init with
-- the same key returns the existing 'initiated' attempt (+ its checkout_id, if
-- already attached) instead of creating a second one.
CREATE OR REPLACE FUNCTION create_payment_attempt(
  p_booking_id      UUID,
  p_client_id       UUID,
  p_provider        TEXT,
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
  v_booking_number TEXT;
  v_key        TEXT;
  v_payment_id UUID;
  v_ex_id      UUID;
  v_ex_amount  DECIMAL(12,2);
  v_ex_checkout TEXT;
BEGIN
  v_key := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'idempotency_key_required');
  END IF;

  -- Lock the booking → serialises ALL attempt creation for this booking, so at
  -- most one active (initiated) attempt / one live checkout can ever exist.
  SELECT client_id, payment_status, paid_at, total_amount, cashback_redemption_sar, booking_number
    INTO v_client, v_status, v_paid_at, v_total, v_redeem, v_booking_number
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  -- Opaque: never distinguish missing vs not-owned.
  IF v_client IS NULL OR v_client <> p_client_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found_or_not_owned');
  END IF;
  IF v_paid_at IS NOT NULL OR v_status = 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_paid');
  END IF;

  v_amount := v_total - COALESCE(v_redeem, 0);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_pay');
  END IF;

  -- Reuse the single active attempt for this booking if one exists — a fresh
  -- idempotency key must NOT open a SECOND live checkout for the same booking.
  SELECT id, amount, checkout_id
    INTO v_ex_id, v_ex_amount, v_ex_checkout
  FROM payments
  WHERE booking_id = p_booking_id AND status = 'initiated'
  FOR UPDATE;

  IF v_ex_id IS NOT NULL THEN
    -- Keep the net in sync if redemption changed and no checkout is bound yet.
    IF v_ex_checkout IS NULL AND v_ex_amount <> v_amount THEN
      UPDATE payments SET amount = v_amount WHERE id = v_ex_id;
      v_ex_amount := v_amount;
    END IF;
    RETURN jsonb_build_object('ok', true, 'payment_id', v_ex_id,
      'amount', v_ex_amount, 'booking_number', v_booking_number,
      'checkout_id', v_ex_checkout, 'reused', true);
  END IF;

  -- No active attempt → open one. A reused idempotency key from a TERMINAL
  -- attempt (no active one to reuse) is a conflict the caller resolves with a
  -- fresh key. (The booking lock + one-initiated index make this the only race.)
  BEGIN
    INSERT INTO payments (
      booking_id, amount, currency, provider, idempotency_key, status
    ) VALUES (
      p_booking_id, v_amount, 'SAR',
      COALESCE(NULLIF(trim(p_provider), ''), 'hyperpay'), v_key, 'initiated'
    )
    RETURNING id INTO v_payment_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'idempotency_key_conflict');
  END;

  RETURN jsonb_build_object('ok', true, 'payment_id', v_payment_id,
    'amount', v_amount, 'booking_number', v_booking_number,
    'checkout_id', NULL, 'reused', false);
END;
$$;

-- ---- §3b RPC: attach_payment_checkout (after gateway checkout created) -------
CREATE OR REPLACE FUNCTION attach_payment_checkout(
  p_payment_id  UUID,
  p_checkout_id TEXT,
  p_token       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checkout TEXT;
  v_token    TEXT;
  v_rows INT;
BEGIN
  v_checkout := NULLIF(BTRIM(COALESCE(p_checkout_id, '')), '');
  IF v_checkout IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'checkout_id_required');
  END IF;
  v_token := NULLIF(BTRIM(COALESCE(p_token, '')), '');
  IF v_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'claim_token_required');
  END IF;

  -- Attach ONLY for the current claim owner (token match) to a still-initiated
  -- attempt with no checkout yet — a stale/superseded claim's late attach fails.
  UPDATE payments
    SET checkout_id = v_checkout
  WHERE id = p_payment_id AND status = 'initiated' AND checkout_id IS NULL
    AND checkout_creation_token = v_token;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'attach_not_allowed');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---- §3c RPC: claim_payment_checkout_creation (single-flight) ----------------
-- Atomically claims the right to create the gateway checkout for an attempt.
-- Exactly one concurrent caller wins (the UPDATE row-locks); losers get
-- 'checkout_claim_unavailable' and retry (a later create_payment_attempt
-- returns the now-attached checkout_id → reuse). A claim older than 15 minutes
-- (an abandoned/crashed attempt) is re-claimable so nothing wedges forever.
CREATE OR REPLACE FUNCTION claim_payment_checkout_creation(
  p_payment_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_rows INT;
BEGIN
  v_token := uuid_generate_v4()::text;
  -- A stale-reclaim issues a NEW token, invalidating the prior claimer's
  -- attach/release (token mismatch) — so a late call can't taint the row.
  UPDATE payments
    SET checkout_claimed_at = now(),
        checkout_creation_token = v_token
  WHERE id = p_payment_id
    AND status = 'initiated'
    AND checkout_id IS NULL
    AND (checkout_claimed_at IS NULL
         OR checkout_claimed_at < now() - INTERVAL '15 minutes');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'checkout_claim_unavailable');
  END IF;
  RETURN jsonb_build_object('ok', true, 'token', v_token);
END;
$$;

-- ---- §3d RPC: release_payment_checkout_claim (on gateway failure) ------------
-- Frees a claim so a retry can re-create the checkout (idempotent no-op once a
-- checkout is attached or the attempt is no longer 'initiated').
CREATE OR REPLACE FUNCTION release_payment_checkout_claim(
  p_payment_id UUID,
  p_token      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Release ONLY one's own claim (token match); a no-op once a checkout is
  -- attached, the attempt is terminal, or another claimer took over.
  UPDATE payments
    SET checkout_claimed_at = NULL,
        checkout_creation_token = NULL
  WHERE id = p_payment_id AND status = 'initiated' AND checkout_id IS NULL
    AND checkout_creation_token = NULLIF(BTRIM(COALESCE(p_token, '')), '');
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---- §4 RPC: confirm_booking_payment (server-verified) ----------------------
-- Called ONLY after the app verifies success via a server-side status lookup
-- against the gateway. Atomic + idempotent: locks the attempt, then the
-- booking; re-validates the net amount; marks the payment success and flips
-- the booking to 'paid' (paid_at NULL → the immutability guard allows this
-- first transition; the paid-state triggers then cascade cashback/tier).
CREATE OR REPLACE FUNCTION confirm_booking_payment(
  p_payment_id        UUID,
  p_provider_txn      TEXT,
  p_provider_status   TEXT,
  p_method            TEXT,
  p_provider_amount   TEXT,
  p_provider_currency TEXT,
  p_raw               JSONB
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
  v_provider_amount NUMERIC;
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

  -- The gateway-reported amount/currency MUST reconcile with our authoritative
  -- net — a success for a different amount/currency must NOT flip the booking.
  IF upper(COALESCE(p_provider_currency, '')) <> 'SAR' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'currency_mismatch');
  END IF;

  -- Parse the gateway amount from raw text → NUMERIC inside the DB (avoids any
  -- JS float edge); a non-numeric/absent value fails closed as a mismatch.
  BEGIN
    v_provider_amount := NULLIF(BTRIM(COALESCE(p_provider_amount, '')), '')::NUMERIC;
  EXCEPTION WHEN others THEN
    v_provider_amount := NULL;
  END;
  IF v_provider_amount IS NULL OR v_provider_amount <> v_pay_amount THEN
    RETURN jsonb_build_object('ok', false, 'error', 'provider_amount_mismatch');
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

-- ---- §6b Freeze cashback redemption while a payment is in flight ------------
-- Re-creates redeem_cashback_for_booking (orig: 20260519000043 §4.4) VERBATIM
-- plus ONE guard: refuse when an 'initiated' payment attempt exists for the
-- booking. Without it, a redemption that lands AFTER a checkout was created for
-- the old net would change the booking net under an in-flight checkout, so
-- confirmation fails provider_amount_mismatch AFTER the client already paid.
-- (Not a paid-state trigger; the paid-state machinery is untouched.)
CREATE OR REPLACE FUNCTION redeem_cashback_for_booking(
  p_client_id          UUID,
  p_booking_id         UUID,
  p_redemption_amount  DECIMAL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance  DECIMAL(14,2);
  v_total_amount     DECIMAL(14,2);
  v_paid_at          TIMESTAMPTZ;
  v_new_balance      DECIMAL(14,2);
  v_ledger_id        UUID;
BEGIN
  IF p_redemption_amount IS NULL OR p_redemption_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'redemption_amount_invalid');
  END IF;

  -- F28 idempotency: one redemption per booking (no lock, just
  -- an early-exit check).
  IF EXISTS (
    SELECT 1 FROM client_loyalty_ledger
    WHERE booking_id = p_booking_id AND event_type = 'redeem'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed_for_booking');
  END IF;

  -- Round 7 PR #80 F15 fix (P1) + Round 5 F3 fix:
  -- Lock order: BOOKING FIRST, THEN CLIENT.
  SELECT total_amount, paid_at INTO v_total_amount, v_paid_at
  FROM bookings
  WHERE id = p_booking_id AND client_id = p_client_id
  FOR UPDATE;
  IF v_total_amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found_or_not_owned');
  END IF;

  -- D29: redemption must happen BEFORE payment confirmation.
  IF v_paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_already_paid');
  END IF;

  -- Phase payments PR1: redemption must NOT change the net once a checkout is
  -- in flight — an active attempt freezes the amount.
  IF EXISTS (
    SELECT 1 FROM payments
    WHERE booking_id = p_booking_id AND status = 'initiated'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_has_active_payment');
  END IF;

  -- F27 race fix: NOW lock the clients row (second in the order).
  SELECT cashback_balance_sar INTO v_current_balance
  FROM clients WHERE id = p_client_id FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  IF v_current_balance < p_redemption_amount THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'insufficient_balance',
      'current_balance', v_current_balance, 'requested', p_redemption_amount
    );
  END IF;

  -- D7 cap 1: redemption <= 50% of total_amount
  IF p_redemption_amount > v_total_amount * 0.5 THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'redemption_exceeds_cap',
      'max_allowed', v_total_amount * 0.5
    );
  END IF;
  -- D7 cap 2: at least 1 SAR cash remains
  IF (v_total_amount - p_redemption_amount) < 1 THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'redemption_leaves_no_cash_payment'
    );
  END IF;

  v_new_balance := v_current_balance - p_redemption_amount;

  -- F28 layer 3+4: BEGIN/EXCEPTION on UNIQUE INDEX
  BEGIN
    INSERT INTO client_loyalty_ledger (
      client_id, event_type, amount_sar, balance_after_sar, booking_id
    ) VALUES (
      p_client_id, 'redeem', -p_redemption_amount, v_new_balance, p_booking_id
    ) RETURNING id INTO v_ledger_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed_for_booking_race');
  END;

  UPDATE clients SET cashback_balance_sar = v_new_balance
    WHERE id = p_client_id;
  UPDATE bookings SET cashback_redemption_sar = p_redemption_amount
    WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'ok', true,
    'ledger_id', v_ledger_id,
    'redeemed_sar', p_redemption_amount,
    'new_balance_sar', v_new_balance,
    'booking_id', p_booking_id
  );
END;
$$;

REVOKE ALL ON FUNCTION redeem_cashback_for_booking(UUID, UUID, DECIMAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_cashback_for_booking(UUID, UUID, DECIMAL)
  TO service_role;

-- ---- §7 Grants — service_role ONLY ------------------------------------------
REVOKE ALL ON FUNCTION create_payment_attempt(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_payment_attempt(UUID, UUID, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION attach_payment_checkout(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION attach_payment_checkout(UUID, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION claim_payment_checkout_creation(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_payment_checkout_creation(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION release_payment_checkout_claim(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_payment_checkout_claim(UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION confirm_booking_payment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_booking_payment(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
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
