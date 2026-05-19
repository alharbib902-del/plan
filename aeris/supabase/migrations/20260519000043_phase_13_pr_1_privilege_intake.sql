-- ============================================================
-- Phase 13 PR 1 — Aeris Privilege intake migration
--
-- Source of truth: docs/PHASE-13-PRIVILEGE-SPEC.md (29 D-specs,
-- 8 user journeys, 11 RPCs). This migration ships:
--
--   §3.1  — 4 new ENUMs
--   §3.2  — 3 new tables + 4-row seed
--   §3.3  — 7 columns on clients + 3 on bookings + 11 named CHECKs
--   §3.4  — 3 triggers (paid_state_immutable + paid_award × 2)
--   §3.5  — RLS policies (3 explicit CREATE POLICY blocks)
--   §4.1-§4.5 — core RPCs (calc spend, evaluate tier, award/redeem
--               cashback, admin force)
--   §4.9-§4.10 — helpers (tier_rank, step_down_one)
--
-- The §4.6-§4.8 RPCs (expire, Diamond grant, revoke) + 2 cron
-- routes + EL early access matching changes ship in PR 3.
--
-- Replay-safe per Phase 9 conventions (DO blocks, IF NOT EXISTS,
-- CREATE OR REPLACE, ON CONFLICT DO NOTHING).
-- ============================================================

-- =============================================================
-- §3.1 ENUMs (4 new)
-- =============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'client_privilege_tier' AND n.nspname = 'public') THEN
    CREATE TYPE client_privilege_tier AS ENUM (
      'silver',    -- default; spend_12m < 100,000 SAR
      'gold',      -- spend_12m 100,000 - 499,999 SAR
      'platinum',  -- spend_12m 500,000 - 1,999,999 SAR
      'diamond'    -- spend_12m >= 2,000,000 SAR
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'loyalty_ledger_event_type' AND n.nspname = 'public') THEN
    CREATE TYPE loyalty_ledger_event_type AS ENUM (
      'earn',                                       -- cashback from confirmed booking
      'redeem',                                     -- applied to a future booking
      'adjust',                                     -- admin manual correction
      'expire',                                     -- 24-month expiry sweep
      'refund_back',                                -- D25 reserved; no producer in v1
      'diamond_shield_granted',                     -- D11 cross-product auto-grant
      'diamond_shield_skipped_already_diamond',     -- J5 skip: active paying diamond exists
      'diamond_shield_skipped_paying_paid_plan',    -- D12 skip: paying lower paid plan
      'diamond_shield_grant_failed',                -- D26 BEGIN/EXCEPTION caught; canary
      'diamond_shield_revoked_on_downgrade'         -- D11 downgrade path
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'privilege_tier_change_reason' AND n.nspname = 'public') THEN
    CREATE TYPE privilege_tier_change_reason AS ENUM (
      'signup_default',
      'auto_upgrade',
      'auto_downgrade',
      'admin_force',
      'admin_lock_expired',
      'data_correction'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'privilege_admin_action_type' AND n.nspname = 'public') THEN
    CREATE TYPE privilege_admin_action_type AS ENUM (
      'view_privilege_detail',
      'force_tier_change',
      'set_tier_lock',
      'manual_cashback_adjustment'
    );
  END IF;
END $$;


-- =============================================================
-- §3.2 New table: privilege_tier_thresholds (lookup, 4-row seed)
-- =============================================================

CREATE TABLE IF NOT EXISTS privilege_tier_thresholds (
  tier client_privilege_tier PRIMARY KEY,
  min_qualified_spend_sar DECIMAL(14, 2) NOT NULL CHECK (min_qualified_spend_sar >= 0),
  cashback_pct DECIMAL(5, 2) NOT NULL CHECK (cashback_pct >= 0 AND cashback_pct <= 100),
  empty_legs_boost_hours INT NOT NULL CHECK (empty_legs_boost_hours >= 0),
  free_diamond_shield BOOLEAN NOT NULL DEFAULT false,
  two_factor_required BOOLEAN NOT NULL DEFAULT false,
  cashback_expiry_months INT NOT NULL DEFAULT 24 CHECK (cashback_expiry_months > 0),
  perks_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE privilege_tier_thresholds ENABLE ROW LEVEL SECURITY;

INSERT INTO privilege_tier_thresholds (
  tier, min_qualified_spend_sar, cashback_pct, empty_legs_boost_hours,
  free_diamond_shield, two_factor_required, cashback_expiry_months, perks_jsonb
) VALUES
  ('silver',   0,         5.00,  0,  false, false, 24,
    '{"empty_legs_window":"standard","support":"24/7"}'::jsonb),
  ('gold',     100000,    8.00,  2,  false, false, 24,
    '{"empty_legs_window":"+2h","catering":"complimentary","account_manager":true}'::jsonb),
  ('platinum', 500000,   12.00,  6,  false, true,  24,
    '{"empty_legs_window":"+6h","ground_transfer":"complimentary","alternative_aircraft":"guaranteed","2fa":"required_soon"}'::jsonb),
  ('diamond',  2000000,  15.00, 12,  true,  true,  24,
    '{"empty_legs_window":"+12h","concierge":"24/7","free_flight_per_year":1,"shield":"diamond_unlimited","2fa":"required_soon"}'::jsonb)
ON CONFLICT (tier) DO NOTHING;


-- =============================================================
-- §3.2 New table: privilege_tier_change_log (audit log)
--                 Defined BEFORE client_loyalty_ledger because
--                 the latter references it via FK.
-- =============================================================

CREATE TABLE IF NOT EXISTS privilege_tier_change_log (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  from_tier             client_privilege_tier NOT NULL,
  to_tier               client_privilege_tier NOT NULL,
  reason                privilege_tier_change_reason NOT NULL,
  qualified_spend_12m_sar DECIMAL(14, 2) NOT NULL,
  grace_started_at      TIMESTAMPTZ,
  admin_actor_cookie_fingerprint TEXT,
  admin_reason          TEXT CHECK (admin_reason IS NULL OR length(admin_reason) BETWEEN 10 AND 500),
  lock_until            DATE,
  source_booking_id     UUID REFERENCES bookings(id) ON DELETE RESTRICT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT privilege_tier_change_log_admin_required CHECK (
    reason NOT IN ('admin_force', 'data_correction')
    OR (admin_actor_cookie_fingerprint IS NOT NULL AND admin_reason IS NOT NULL)
  ),
  CONSTRAINT privilege_tier_change_log_grace_only_on_downgrade CHECK (
    grace_started_at IS NULL OR reason = 'auto_downgrade'
  ),
  CONSTRAINT privilege_tier_change_log_lock_only_on_admin_force CHECK (
    lock_until IS NULL OR reason = 'admin_force'
  ),
  CONSTRAINT privilege_tier_change_log_from_to_distinct CHECK (
    from_tier IS DISTINCT FROM to_tier OR reason = 'signup_default'
  )
);

CREATE INDEX IF NOT EXISTS idx_privilege_tier_change_log_client
  ON privilege_tier_change_log (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_privilege_tier_change_log_pending_grace
  ON privilege_tier_change_log (created_at DESC)
  WHERE reason = 'auto_downgrade';

ALTER TABLE privilege_tier_change_log ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- §3.2 New table: client_loyalty_ledger (append-only event log)
-- =============================================================

CREATE TABLE IF NOT EXISTS client_loyalty_ledger (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  event_type            loyalty_ledger_event_type NOT NULL,
  amount_sar            DECIMAL(12, 2) NOT NULL,
  balance_after_sar     DECIMAL(14, 2) NOT NULL CHECK (balance_after_sar >= 0),
  booking_id            UUID REFERENCES bookings(id) ON DELETE RESTRICT,
  source_change_log_id  UUID REFERENCES privilege_tier_change_log(id) ON DELETE RESTRICT,
  source_subscription_id UUID REFERENCES medevac_subscriptions(id) ON DELETE RESTRICT,
  admin_actor_cookie_fingerprint TEXT,
  admin_reason          TEXT CHECK (admin_reason IS NULL OR length(admin_reason) BETWEEN 10 AND 500),
  cashback_expiry_at    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Round 5 PR #80 F7 fix — all diamond_shield_* events have
  -- amount_sar=0 (they record state transitions, not balance deltas).
  -- Prefix check covers all 5 current variants + any future addition.
  CONSTRAINT client_loyalty_ledger_amount_sign_check CHECK (
    (event_type IN ('earn', 'refund_back') AND amount_sar > 0)
    OR (event_type IN ('redeem', 'expire') AND amount_sar < 0)
    OR (event_type = 'adjust')
    OR (event_type::text LIKE 'diamond_shield_%' AND amount_sar = 0)
  ),
  CONSTRAINT client_loyalty_ledger_admin_reason_required_for_adjust CHECK (
    event_type != 'adjust' OR admin_reason IS NOT NULL
  ),
  CONSTRAINT client_loyalty_ledger_subscription_required_for_grant CHECK (
    event_type != 'diamond_shield_granted' OR source_subscription_id IS NOT NULL
  ),
  -- Round 5 PR #80 F7 fix — prefix check covers all diamond_shield_*
  -- variants (granted/skipped_*/grant_failed/revoked) without
  -- enumeration drift.
  CONSTRAINT client_loyalty_ledger_change_log_required_for_diamond CHECK (
    NOT (event_type::text LIKE 'diamond_shield_%')
    OR source_change_log_id IS NOT NULL
  ),
  CONSTRAINT client_loyalty_ledger_booking_required_for_booking_events_check CHECK (
    event_type NOT IN ('earn', 'redeem', 'refund_back')
    OR booking_id IS NOT NULL
  ),
  CONSTRAINT client_loyalty_ledger_expiry_only_on_earn CHECK (
    cashback_expiry_at IS NULL OR event_type = 'earn'
  )
);

CREATE INDEX IF NOT EXISTS idx_client_loyalty_ledger_client
  ON client_loyalty_ledger (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_loyalty_ledger_booking
  ON client_loyalty_ledger (booking_id) WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_loyalty_ledger_expiry_sweep
  ON client_loyalty_ledger (cashback_expiry_at)
  WHERE event_type = 'earn' AND cashback_expiry_at IS NOT NULL;

-- D21 — defense-in-depth idempotency for earn
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_loyalty_ledger_earn_per_booking
  ON client_loyalty_ledger (booking_id)
  WHERE event_type = 'earn' AND booking_id IS NOT NULL;

-- F28 — same idempotency for redeem
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_loyalty_ledger_redeem_per_booking
  ON client_loyalty_ledger (booking_id)
  WHERE event_type = 'redeem' AND booking_id IS NOT NULL;

ALTER TABLE client_loyalty_ledger ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- §3.3 Columns added to clients (7 new)
-- =============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS privilege_tier client_privilege_tier NOT NULL DEFAULT 'silver',
  ADD COLUMN IF NOT EXISTS privilege_tier_assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS privilege_tier_qualified_spend_12m_sar DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS privilege_below_threshold_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier_locked_until DATE,
  ADD COLUMN IF NOT EXISTS cashback_balance_sar DECIMAL(14, 2) NOT NULL DEFAULT 0
    CHECK (cashback_balance_sar >= 0),
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_clients_privilege_tier
  ON clients (privilege_tier);

CREATE INDEX IF NOT EXISTS idx_clients_below_threshold_grace
  ON clients (privilege_below_threshold_since)
  WHERE privilege_below_threshold_since IS NOT NULL;


-- =============================================================
-- §3.3 Columns added to bookings (3 new — D22+D23+F37)
-- =============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cashback_redemption_sar DECIMAL(12, 2) NOT NULL DEFAULT 0
    CHECK (cashback_redemption_sar >= 0),
  ADD COLUMN IF NOT EXISTS cashback_earned_sar DECIMAL(12, 2) DEFAULT NULL
    CHECK (cashback_earned_sar IS NULL OR cashback_earned_sar >= 0),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- D7 cap (named constraint #10 in Probe 41 inventory)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'bookings_cashback_redemption_cap_check') THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_cashback_redemption_cap_check CHECK (
        cashback_redemption_sar <= total_amount * 0.5
        AND (total_amount - cashback_redemption_sar) >= 1
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_paid_at_for_loyalty
  ON bookings (paid_at DESC, client_id)
  WHERE payment_status = 'paid' AND client_id IS NOT NULL;


-- =============================================================
-- §3.4 Triggers — paid_state immutability (D24 + F26)
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_paid_state_immutable_after_paid ON bookings;
CREATE TRIGGER trg_bookings_paid_state_immutable_after_paid
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION reject_paid_state_mutation_after_paid();


-- =============================================================
-- §4.9 Helper: tier_rank (IMMUTABLE + PARALLEL SAFE)
-- =============================================================

CREATE OR REPLACE FUNCTION tier_rank(t client_privilege_tier)
RETURNS INT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE t
    WHEN 'silver'   THEN 1
    WHEN 'gold'     THEN 2
    WHEN 'platinum' THEN 3
    WHEN 'diamond'  THEN 4
  END;
$$;

REVOKE ALL ON FUNCTION tier_rank(client_privilege_tier) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tier_rank(client_privilege_tier) TO service_role;


-- =============================================================
-- §4.10 Helper: step_down_one (IMMUTABLE + PARALLEL SAFE)
-- =============================================================

CREATE OR REPLACE FUNCTION step_down_one(t client_privilege_tier)
RETURNS client_privilege_tier
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE t
    WHEN 'diamond'  THEN 'platinum'::client_privilege_tier
    WHEN 'platinum' THEN 'gold'::client_privilege_tier
    WHEN 'gold'     THEN 'silver'::client_privilege_tier
    WHEN 'silver'   THEN 'silver'::client_privilege_tier  -- already lowest
  END;
$$;

REVOKE ALL ON FUNCTION step_down_one(client_privilege_tier) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION step_down_one(client_privilege_tier) TO service_role;


-- =============================================================
-- §4.1 calculate_client_qualified_spend_12m
-- =============================================================

CREATE OR REPLACE FUNCTION calculate_client_qualified_spend_12m(
  p_client_id UUID
)
RETURNS DECIMAL(14,2)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- D23 inline computation; D22 paid_at filter; D16 eligibility
  SELECT COALESCE(SUM(total_amount - cashback_redemption_sar), 0)::DECIMAL(14,2)
  FROM bookings
  WHERE client_id = p_client_id
    AND payment_status = 'paid'
    AND paid_at > NOW() - INTERVAL '12 months'
    AND source_discriminator IN ('charter', 'cargo', 'medevac')
    AND NOT (source_discriminator = 'medevac' AND COALESCE(is_covered, false));
$$;

REVOKE ALL ON FUNCTION calculate_client_qualified_spend_12m(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION calculate_client_qualified_spend_12m(UUID)
  TO service_role;


-- =============================================================
-- §4.2 evaluate_client_privilege_tier
--      (D26: Diamond grant call wrapped in BEGIN/EXCEPTION;
--       D11: grant on diamond entry; revoke schedule on diamond
--       downgrade — both ship in PR 3 RPCs; in PR 1 they're
--       null-safe no-ops via the IF guards.)
-- =============================================================

CREATE OR REPLACE FUNCTION evaluate_client_privilege_tier(
  p_client_id UUID,
  p_source_booking_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spend            DECIMAL(14,2);
  v_current_tier     client_privilege_tier;
  v_target_tier      client_privilege_tier;
  v_below_since      TIMESTAMPTZ;
  v_locked_until     DATE;
  v_change_log_id    UUID;
  v_action           TEXT;
BEGIN
  v_spend := calculate_client_qualified_spend_12m(p_client_id);

  SELECT privilege_tier, privilege_below_threshold_since, tier_locked_until
    INTO v_current_tier, v_below_since, v_locked_until
  FROM clients
  WHERE id = p_client_id
  FOR UPDATE;

  IF v_current_tier IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  -- Determine target tier from thresholds
  SELECT tier INTO v_target_tier
  FROM privilege_tier_thresholds
  WHERE v_spend >= min_qualified_spend_sar
  ORDER BY min_qualified_spend_sar DESC
  LIMIT 1;

  IF v_target_tier IS NULL THEN v_target_tier := 'silver'; END IF;

  -- Branch on action
  IF tier_rank(v_target_tier) > tier_rank(v_current_tier) THEN
    v_action := 'upgrade';
  ELSIF v_target_tier = v_current_tier THEN
    v_action := 'no_change';
    IF v_below_since IS NOT NULL THEN
      UPDATE clients SET privilege_below_threshold_since = NULL
        WHERE id = p_client_id;
    END IF;
  ELSIF v_locked_until IS NOT NULL AND v_locked_until > CURRENT_DATE THEN
    v_action := 'locked_no_action';
    IF v_below_since IS NOT NULL THEN
      UPDATE clients SET privilege_below_threshold_since = NULL
        WHERE id = p_client_id;
    END IF;
  ELSIF v_below_since IS NULL THEN
    v_action := 'start_grace';
    UPDATE clients SET privilege_below_threshold_since = NOW()
      WHERE id = p_client_id;
  ELSIF NOW() - v_below_since >= INTERVAL '90 days' THEN
    v_action := 'downgrade_one_step';
    v_target_tier := step_down_one(v_current_tier);
    -- F3 guard: skip if already at lowest tier (silver→silver)
    IF v_target_tier = v_current_tier THEN
      v_action := 'no_change';
      UPDATE clients SET privilege_below_threshold_since = NULL
        WHERE id = p_client_id;
    END IF;
  ELSE
    v_action := 'grace_in_progress';
  END IF;

  -- Apply upgrade or downgrade atomically
  IF v_action IN ('upgrade', 'downgrade_one_step') THEN
    INSERT INTO privilege_tier_change_log (
      client_id, from_tier, to_tier, reason,
      qualified_spend_12m_sar, grace_started_at, source_booking_id
    ) VALUES (
      p_client_id, v_current_tier, v_target_tier,
      CASE WHEN v_action = 'upgrade' THEN 'auto_upgrade'::privilege_tier_change_reason
           ELSE 'auto_downgrade'::privilege_tier_change_reason END,
      v_spend,
      CASE WHEN v_action = 'downgrade_one_step' THEN v_below_since ELSE NULL END,
      p_source_booking_id
    ) RETURNING id INTO v_change_log_id;

    UPDATE clients SET
      privilege_tier = v_target_tier,
      privilege_tier_assigned_at = NOW(),
      privilege_below_threshold_since = NULL,
      privilege_tier_qualified_spend_12m_sar = v_spend
    WHERE id = p_client_id;

    -- D26 + D11: Diamond × Shield cross-product hooks. The RPCs
    -- auto_grant_diamond_shield_subscription + schedule_diamond_shield_revoke
    -- ship in PR 3. In PR 1 we leave the hook structure in place but
    -- skip the call (functions don't exist yet — DO IF check would
    -- raise undefined_function). PR 3 migration will UPDATE this
    -- function body to add the calls.
    --
    -- NOTE: this is intentional staging — PR 1 ships tier mechanics;
    -- PR 3 wires the cross-product side effect.
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tier_action', v_action,
    'from_tier', v_current_tier,
    'to_tier', v_target_tier,
    'qualified_spend_12m_sar', v_spend,
    'change_log_id', v_change_log_id,
    'diamond_shield_granted_subscription_id', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION evaluate_client_privilege_tier(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION evaluate_client_privilege_tier(UUID, UUID)
  TO service_role;


-- =============================================================
-- §4.3 award_cashback_for_booking (D21 idempotency, 4 layers)
-- =============================================================

CREATE OR REPLACE FUNCTION award_cashback_for_booking(
  p_client_id UUID,
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier             client_privilege_tier;
  v_pct              DECIMAL(5,2);
  v_amount_paid      DECIMAL(14,2);
  v_cashback_amount  DECIMAL(12,2);
  v_expiry_months    INT;
  v_new_balance      DECIMAL(14,2);
  v_ledger_id        UUID;
  v_booking_client   UUID;
  v_payment_status   TEXT;
  v_paid_at          TIMESTAMPTZ;
  v_discriminator    TEXT;
  v_is_covered       BOOLEAN;
  v_total_amount     DECIMAL(14,2);
  v_redemption       DECIMAL(14,2);
BEGIN
  -- D21 layer 2: RPC EXISTS guard
  IF EXISTS (
    SELECT 1 FROM client_loyalty_ledger
    WHERE booking_id = p_booking_id
      AND event_type = 'earn'
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_awarded', true,
      'skipped_reason', 'duplicate_earn_for_booking',
      'booking_id', p_booking_id
    );
  END IF;

  -- Round 5 PR #80 F2 fix (P1): lock booking row + verify ownership
  -- + state at DB boundary. SECURITY DEFINER cannot trust the trigger
  -- caller. 5 guards: not_found, client_mismatch, not_paid,
  -- not_eligible, covered_medevac_excluded.
  SELECT client_id, payment_status::text, paid_at,
         source_discriminator::text, COALESCE(is_covered, false),
         total_amount, cashback_redemption_sar
    INTO v_booking_client, v_payment_status, v_paid_at,
         v_discriminator, v_is_covered,
         v_total_amount, v_redemption
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF v_booking_client IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found');
  END IF;
  IF v_booking_client != p_client_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_client_mismatch');
  END IF;
  IF v_payment_status != 'paid' OR v_paid_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_paid');
  END IF;
  IF v_discriminator NOT IN ('charter', 'cargo', 'medevac') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_eligible_for_cashback');
  END IF;
  IF v_discriminator = 'medevac' AND v_is_covered THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_covered_medevac_excluded');
  END IF;

  -- Load tier + cashback % (lock clients row)
  SELECT c.privilege_tier, t.cashback_pct, t.cashback_expiry_months
    INTO v_tier, v_pct, v_expiry_months
  FROM clients c
  JOIN privilege_tier_thresholds t ON t.tier = c.privilege_tier
  WHERE c.id = p_client_id
  FOR UPDATE;

  IF v_tier IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  -- D23 inline computation
  v_amount_paid := v_total_amount - COALESCE(v_redemption, 0);
  IF v_amount_paid <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_zero_amount_paid');
  END IF;

  v_cashback_amount := ROUND(v_amount_paid * v_pct / 100, 2);

  -- D21 layer 3+4: BEGIN/EXCEPTION on UNIQUE INDEX (race backstop)
  BEGIN
    INSERT INTO client_loyalty_ledger (
      client_id, event_type, amount_sar, balance_after_sar,
      booking_id, cashback_expiry_at
    ) VALUES (
      p_client_id, 'earn', v_cashback_amount,
      (SELECT cashback_balance_sar FROM clients WHERE id = p_client_id) + v_cashback_amount,
      p_booking_id,
      NOW() + (v_expiry_months || ' months')::INTERVAL
    ) RETURNING id, balance_after_sar INTO v_ledger_id, v_new_balance;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_awarded', true,
      'skipped_reason', 'duplicate_earn_for_booking_race',
      'booking_id', p_booking_id
    );
  END;

  -- Update denormalized balance + booking
  UPDATE clients SET cashback_balance_sar = v_new_balance
    WHERE id = p_client_id;
  UPDATE bookings SET cashback_earned_sar = v_cashback_amount
    WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_awarded', false,
    'ledger_id', v_ledger_id,
    'tier_at_award', v_tier,
    'cashback_pct', v_pct,
    'amount_paid_sar', v_amount_paid,
    'cashback_amount_sar', v_cashback_amount,
    'new_balance_sar', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION award_cashback_for_booking(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION award_cashback_for_booking(UUID, UUID)
  TO service_role;


-- =============================================================
-- §4.4 redeem_cashback_for_booking (F27 race + F28 idempotency)
-- =============================================================

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

  -- F28 idempotency: one redemption per booking
  IF EXISTS (
    SELECT 1 FROM client_loyalty_ledger
    WHERE booking_id = p_booking_id AND event_type = 'redeem'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed_for_booking');
  END IF;

  -- F27 race fix: FOR UPDATE serializes balance writes
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

  -- Round 5 PR #80 F3 fix (P1): lock booking row WITH client_id
  -- predicate. Same boundary as F2 — SECURITY DEFINER cannot trust
  -- the caller; without the AND client_id filter, any caller with
  -- a valid booking_id could redeem against any client's balance.
  SELECT total_amount, paid_at INTO v_total_amount, v_paid_at
  FROM bookings
  WHERE id = p_booking_id AND client_id = p_client_id
  FOR UPDATE;
  IF v_total_amount IS NULL THEN
    -- Same envelope for both branches (don't leak booking existence
    -- across clients).
    RETURN jsonb_build_object('ok', false, 'error', 'booking_not_found_or_not_owned');
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

  -- D29: redemption must happen BEFORE payment confirmation.
  -- Now read from the locked booking row (no second SELECT).
  IF v_paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'booking_already_paid');
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


-- =============================================================
-- §4.5 admin_force_privilege_tier (Phase 12 §4.10 audit pattern)
-- =============================================================

CREATE OR REPLACE FUNCTION admin_force_privilege_tier(
  p_client_id       UUID,
  p_new_tier        client_privilege_tier,
  p_session_metadata JSONB,
  p_reason          TEXT,
  p_lock_until      DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_tier     client_privilege_tier;
  v_spend            DECIMAL(14,2);
  v_change_log_id    UUID;
  v_fingerprint      TEXT;
BEGIN
  -- Fail-closed audit metadata guard (Phase 12 §4.10 pattern)
  v_fingerprint := COALESCE(p_session_metadata->>'cookie_fingerprint', '');
  IF v_fingerprint = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_session_metadata_required');
  END IF;

  IF p_reason IS NULL OR length(p_reason) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_reason_too_short');
  END IF;

  -- F9 — past-date lock validation
  IF p_lock_until IS NOT NULL AND p_lock_until < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lock_until_must_be_future');
  END IF;

  SELECT privilege_tier INTO v_current_tier
  FROM clients WHERE id = p_client_id FOR UPDATE;
  IF v_current_tier IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  v_spend := calculate_client_qualified_spend_12m(p_client_id);

  -- F3 guard: skip no-op force (same tier)
  IF v_current_tier = p_new_tier AND p_lock_until IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'no_op', true, 'reason', 'tier_unchanged_no_lock'
    );
  END IF;

  -- Audit + apply atomically. F3: skip change_log INSERT if from=to.
  IF v_current_tier IS DISTINCT FROM p_new_tier THEN
    INSERT INTO privilege_tier_change_log (
      client_id, from_tier, to_tier, reason,
      qualified_spend_12m_sar,
      admin_actor_cookie_fingerprint,
      admin_reason,
      lock_until
    ) VALUES (
      p_client_id, v_current_tier, p_new_tier, 'admin_force',
      v_spend, v_fingerprint, p_reason, p_lock_until
    ) RETURNING id INTO v_change_log_id;
  END IF;

  UPDATE clients SET
    privilege_tier = p_new_tier,
    privilege_tier_assigned_at = NOW(),
    privilege_below_threshold_since = NULL,
    tier_locked_until = p_lock_until
  WHERE id = p_client_id;

  RETURN jsonb_build_object(
    'ok', true,
    'no_op', false,
    'from_tier', v_current_tier,
    'to_tier', p_new_tier,
    'change_log_id', v_change_log_id,
    'lock_until', p_lock_until
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_force_privilege_tier(UUID, client_privilege_tier, JSONB, TEXT, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_force_privilege_tier(UUID, client_privilege_tier, JSONB, TEXT, DATE)
  TO service_role;


-- =============================================================
-- §3.5 RLS policies (F35 — explicit CREATE POLICY blocks)
-- =============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'client_loyalty_ledger'
                    AND policyname = 'client_loyalty_ledger_select_own') THEN
    CREATE POLICY client_loyalty_ledger_select_own
      ON client_loyalty_ledger FOR SELECT
      TO authenticated
      USING (client_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'privilege_tier_change_log'
                    AND policyname = 'privilege_tier_change_log_select_own') THEN
    CREATE POLICY privilege_tier_change_log_select_own
      ON privilege_tier_change_log FOR SELECT
      TO authenticated
      USING (client_id = (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'privilege_tier_thresholds'
                    AND policyname = 'privilege_tier_thresholds_select_public') THEN
    CREATE POLICY privilege_tier_thresholds_select_public
      ON privilege_tier_thresholds FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;


-- =============================================================
-- End of Phase 13 PR 1 migration
--
-- Inventory check (matches Probe 41):
--   4 ENUMs · 3 tables (+ 4-row seed for thresholds)
--   7 columns on clients · 3 on bookings
--   11 named constraints
--   1 trigger (paid_state immutability)
--   10 indexes (incl 2 UNIQUE for idempotency)
--   2 helpers (tier_rank, step_down_one)
--   5 RPCs (calc spend, evaluate tier, award/redeem cashback,
--           admin force)
--   3 RLS policies
--
-- PR 3 will add:
--   2 more RPCs (expire_old_loyalty_credits +
--                auto_grant_diamond_shield_subscription +
--                schedule_diamond_shield_revoke +
--                reconcile_client_cashback_balance)
--   1 more table (client_empty_leg_matches)
--   2 cron routes
--   EL matching modification
--   payment_paid_award_cashback triggers (×2 ins/upd) —
--     deferred to PR 3 to avoid firing on historical UPDATEs
--     during PR 1 deploy; activation runbook step 3 stamps
--     paid_at via backfill BEFORE the triggers are created
-- =============================================================
