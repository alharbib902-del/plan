-- ============================================
-- AERIS — Client referral program (PR1)
-- Migration: 20260531000006  (forward-only)
-- ============================================
-- Each client has a shareable referral code. A NEW client may apply a
-- code at signup → a referral link is recorded. When that referee
-- completes their FIRST confirmed-paid booking, a daily cron rewards
-- BOTH parties with cashback.
--
-- Ledger discipline: rewards are recorded as client_loyalty_ledger
-- event_type='adjust' with booking_id NULL — NOT 'earn' (which is
-- UNIQUE-per-booking via uq_client_loyalty_ledger_earn_per_booking AND
-- requires booking_id). admin_reason carries 'referral:<id>:referrer'
-- / ':referee' (satisfies the 10–500 length CHECK). cashback_expiry_at
-- stays NULL (the ledger forbids expiry on non-earn events; referral
-- cashback therefore does not expire).
--
-- Security (Phase 8/9 discipline): both tables are deny-all RLS; all
-- access is via the service-role client + the SECURITY DEFINER RPCs
-- below. Identity (client_id) is derived from the session server-side,
-- never trusted from the form.

-- ---- §1 Tables --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS client_referral_codes (
  client_id   UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_referral_codes_code_format CHECK (code ~ '^[A-Z0-9]{6,16}$')
);

CREATE TABLE IF NOT EXISTS client_referrals (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  referee_client_id     UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE RESTRICT,
  code_used             TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'signed_up'
                          CHECK (status IN ('signed_up', 'rewarded')),
  qualifying_booking_id UUID REFERENCES bookings(id) ON DELETE RESTRICT,
  referrer_reward_sar   DECIMAL(12, 2),
  referee_reward_sar    DECIMAL(12, 2),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rewarded_at           TIMESTAMPTZ,
  -- A client can never refer themselves.
  CONSTRAINT client_referrals_no_self CHECK (referrer_client_id <> referee_client_id),
  -- A rewarded row must carry the full reward snapshot.
  CONSTRAINT client_referrals_rewarded_shape CHECK (
    status <> 'rewarded'
    OR (qualifying_booking_id IS NOT NULL
        AND referrer_reward_sar IS NOT NULL
        AND referee_reward_sar IS NOT NULL
        AND rewarded_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_client_referrals_referrer
  ON client_referrals (referrer_client_id, created_at DESC);

-- Partial index for the cron candidate scan (only un-rewarded rows).
CREATE INDEX IF NOT EXISTS idx_client_referrals_signed_up
  ON client_referrals (created_at) WHERE status = 'signed_up';

ALTER TABLE client_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_referrals ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: deny-all for anon/authenticated. Service-role only.
REVOKE ALL ON client_referral_codes FROM anon, authenticated;
REVOKE ALL ON client_referrals FROM anon, authenticated;

-- ---- §2 RPC: get_or_create_referral_code ------------------------------------
-- Returns the client's existing code, or mints a fresh unique one. Code
-- collisions (astronomically rare across 30^8 space) retry up to 10×.
CREATE OR REPLACE FUNCTION get_or_create_referral_code(p_client_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Unambiguous charset (no 0/O/1/I/L) → easy to read aloud / type.
  v_chars    TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code     TEXT;
  v_existing TEXT;
  v_attempt  INT := 0;
  i          INT;
BEGIN
  IF p_client_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT code INTO v_existing FROM client_referral_codes WHERE client_id = p_client_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RETURN NULL;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_code := '';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    END LOOP;

    BEGIN
      INSERT INTO client_referral_codes (client_id, code)
      VALUES (p_client_id, v_code)
      ON CONFLICT (client_id) DO NOTHING;

      -- Whether we inserted or a concurrent call did, the row now exists.
      SELECT code INTO v_existing FROM client_referral_codes WHERE client_id = p_client_id;
      IF v_existing IS NOT NULL THEN
        RETURN v_existing;
      END IF;
    EXCEPTION WHEN unique_violation THEN
      -- The generated code collided with ANOTHER client's code; retry.
      IF v_attempt >= 10 THEN
        RAISE EXCEPTION 'referral_code_generation_failed';
      END IF;
    END;
  END LOOP;
END;
$$;

-- ---- §3 RPC: apply_referral_code (called at signup) -------------------------
-- Links a brand-new referee to the code's owner. Rejects self-referral,
-- unknown codes, and any referee already linked (referee is UNIQUE).
CREATE OR REPLACE FUNCTION apply_referral_code(
  p_referee_client_id UUID,
  p_code              TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code        TEXT;
  v_referrer    UUID;
  v_referral_id UUID;
BEGIN
  IF p_referee_client_id IS NULL OR p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  v_code := upper(trim(p_code));

  SELECT client_id INTO v_referrer FROM client_referral_codes WHERE code = v_code;
  IF v_referrer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'code_not_found');
  END IF;

  IF v_referrer = p_referee_client_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_referral');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_referee_client_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'referee_not_found');
  END IF;

  INSERT INTO client_referrals (referrer_client_id, referee_client_id, code_used, status)
  VALUES (v_referrer, p_referee_client_id, v_code, 'signed_up')
  ON CONFLICT (referee_client_id) DO NOTHING
  RETURNING id INTO v_referral_id;

  IF v_referral_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_referred');
  END IF;

  RETURN jsonb_build_object('ok', true, 'referral_id', v_referral_id);
END;
$$;

-- ---- §4 RPC: reward_referral (atomic, idempotent) ---------------------------
-- Grants both parties' cashback for a qualified referral. Locks the referral
-- row, guards on status='rewarded' (strict dedup), re-confirms the referee's
-- first paid booking, then writes two 'adjust' ledger rows + bumps both
-- balances. Client rows are locked in ascending-id order (ABBA-safe). Reward
-- amounts are supplied by the caller (env-configured) and validated here.
CREATE OR REPLACE FUNCTION reward_referral(
  p_referral_id         UUID,
  p_referrer_reward_sar DECIMAL,
  p_referee_reward_sar  DECIMAL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status   TEXT;
  v_referrer UUID;
  v_referee  UUID;
  v_booking  UUID;
  v_ref_bal  DECIMAL(14, 2);
  v_ree_bal  DECIMAL(14, 2);
  v_ref_new  DECIMAL(14, 2);
  v_ree_new  DECIMAL(14, 2);
BEGIN
  -- Amounts come from the caller (env constants); bound them defensively.
  IF p_referrer_reward_sar IS NULL OR p_referee_reward_sar IS NULL
     OR p_referrer_reward_sar <= 0 OR p_referee_reward_sar <= 0
     OR p_referrer_reward_sar > 10000 OR p_referee_reward_sar > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reward_amount_invalid');
  END IF;

  -- Lock the referral row → serializes reward attempts; status guard dedups.
  SELECT status, referrer_client_id, referee_client_id
    INTO v_status, v_referrer, v_referee
  FROM client_referrals
  WHERE id = p_referral_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'referral_not_found');
  END IF;
  IF v_status = 'rewarded' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_rewarded');
  END IF;

  -- Qualification (re-checked under lock): referee's first confirmed-paid booking.
  SELECT id INTO v_booking
  FROM bookings
  WHERE client_id = v_referee
    AND payment_status = 'paid'
    AND paid_at IS NOT NULL
  ORDER BY paid_at ASC
  LIMIT 1;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_qualified');
  END IF;

  -- Lock both client rows in ascending-id order (deadlock-safe). referrer
  -- and referee are guaranteed distinct (no-self CHECK).
  IF v_referrer < v_referee THEN
    SELECT cashback_balance_sar INTO v_ref_bal FROM clients WHERE id = v_referrer FOR UPDATE;
    SELECT cashback_balance_sar INTO v_ree_bal FROM clients WHERE id = v_referee  FOR UPDATE;
  ELSE
    SELECT cashback_balance_sar INTO v_ree_bal FROM clients WHERE id = v_referee  FOR UPDATE;
    SELECT cashback_balance_sar INTO v_ref_bal FROM clients WHERE id = v_referrer FOR UPDATE;
  END IF;

  IF v_ref_bal IS NULL OR v_ree_bal IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  v_ref_new := v_ref_bal + p_referrer_reward_sar;
  v_ree_new := v_ree_bal + p_referee_reward_sar;

  -- Referrer reward — adjust, booking_id NULL, expiry NULL.
  INSERT INTO client_loyalty_ledger (
    client_id, event_type, amount_sar, balance_after_sar, admin_reason
  ) VALUES (
    v_referrer, 'adjust', p_referrer_reward_sar, v_ref_new,
    'referral:' || p_referral_id::text || ':referrer'
  );
  UPDATE clients SET cashback_balance_sar = v_ref_new WHERE id = v_referrer;

  -- Referee reward.
  INSERT INTO client_loyalty_ledger (
    client_id, event_type, amount_sar, balance_after_sar, admin_reason
  ) VALUES (
    v_referee, 'adjust', p_referee_reward_sar, v_ree_new,
    'referral:' || p_referral_id::text || ':referee'
  );
  UPDATE clients SET cashback_balance_sar = v_ree_new WHERE id = v_referee;

  UPDATE client_referrals SET
    status                = 'rewarded',
    qualifying_booking_id = v_booking,
    referrer_reward_sar   = p_referrer_reward_sar,
    referee_reward_sar    = p_referee_reward_sar,
    rewarded_at           = NOW()
  WHERE id = p_referral_id;

  RETURN jsonb_build_object(
    'ok', true,
    'referral_id', p_referral_id,
    'referrer_client_id', v_referrer,
    'referee_client_id', v_referee,
    'qualifying_booking_id', v_booking,
    'referrer_reward_sar', p_referrer_reward_sar,
    'referee_reward_sar', p_referee_reward_sar
  );
END;
$$;

-- ---- §5 RPC: list_rewardable_referrals (cron candidate scan) ----------------
-- signed_up referrals whose referee already has a confirmed-paid booking.
-- Every returned row is rewardable; reward_referral re-checks atomically.
-- Ordered oldest-first so no candidate is starved; limit clamped to [1,1000].
CREATE OR REPLACE FUNCTION list_rewardable_referrals(p_limit INTEGER)
RETURNS TABLE (
  referral_id       UUID,
  referee_client_id UUID
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.referee_client_id
  FROM client_referrals r
  WHERE r.status = 'signed_up'
    AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.client_id = r.referee_client_id
        AND b.payment_status = 'paid'
        AND b.paid_at IS NOT NULL
    )
  ORDER BY r.created_at ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
$$;

-- ---- §6 Grants — service_role ONLY ------------------------------------------
REVOKE ALL ON FUNCTION get_or_create_referral_code(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_referral_code(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION apply_referral_code(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_referral_code(UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION reward_referral(UUID, DECIMAL, DECIMAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reward_referral(UUID, DECIMAL, DECIMAL)
  TO service_role;

REVOKE ALL ON FUNCTION list_rewardable_referrals(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION list_rewardable_referrals(INTEGER)
  TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
