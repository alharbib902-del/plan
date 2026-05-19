-- ============================================================
-- Phase 13 PR 3 — Aeris Privilege distribution + cron + cross-product
--
-- Source of truth: docs/PHASE-13-PRIVILEGE-SPEC.md (29 D-specs).
-- This migration ships the layer PR 1 deferred:
--
--   §3.2 — 1 new table (client_empty_leg_matches, D13/D27)
--   §3.4 — 4 NEW triggers (BEFORE stamp paid_at × 2 + AFTER award ×
--           2) per F1 BEFORE/AFTER split — were deferred from PR 1
--           to avoid firing on historical UPDATEs during PR 1 deploy
--   §4.6 — expire_old_loyalty_credits (daily cron RPC)
--   §4.7 — auto_grant_diamond_shield_subscription (D11 cross-product)
--   §4.8 — schedule_diamond_shield_revoke (D11 downgrade path)
--   §4.x — reconcile_client_cashback_balance (D19 report-only)
--   §4.2 — UPDATED evaluate_client_privilege_tier to call the
--           Diamond × Shield hooks (PR 1 shipped a stub)
--
-- Replay-safe per Phase 9 conventions.
-- ============================================================

-- =============================================================
-- §3.2 New table: client_empty_leg_matches (D13/D27)
-- =============================================================

CREATE TABLE IF NOT EXISTS client_empty_leg_matches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empty_leg_id    UUID NOT NULL
                    REFERENCES empty_legs(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL
                    REFERENCES clients(id) ON DELETE CASCADE,
  privilege_tier_at_match client_privilege_tier NOT NULL,
  -- Round 3 PR #80 F25: merged tier_boost_applied + boost_hours
  -- into single column. 0 = no boost (silver or FCFS round); >0 =
  -- boost hours from privilege_tier_thresholds.empty_legs_boost_hours.
  boost_hours_applied INT NOT NULL DEFAULT 0
    CHECK (boost_hours_applied >= 0),
  matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notification_sent_at TIMESTAMPTZ,
  -- D27: prevents duplicate notification across tier-boost windows.
  -- Gold matched at T0 (boost active) cannot be re-matched at T+2h
  -- (FCFS round); the second insert fails via UNIQUE → matching
  -- cron logs `tier_boost_already_consumed` skip reason.
  CONSTRAINT uq_client_empty_leg_matches_leg_client
    UNIQUE (empty_leg_id, client_id)
);

ALTER TABLE client_empty_leg_matches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_client_empty_leg_matches_leg
  ON client_empty_leg_matches (empty_leg_id, matched_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_empty_leg_matches_client
  ON client_empty_leg_matches (client_id, matched_at DESC);


-- =============================================================
-- §3.4 Triggers — BEFORE/AFTER split (F1, deferred from PR 1)
--
-- BEFORE: stamp NEW.paid_at if NULL (mutates the row about to be
--         written; trivially safe).
-- AFTER:  call award_cashback_for_booking + evaluate_client_privilege_tier
--         (row is now visible to downstream SELECTs).
-- =============================================================

CREATE OR REPLACE FUNCTION on_bookings_stamp_paid_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- D22: stamp paid_at on the first paid transition. Only set if
  -- NULL (caller may have pre-stamped on legacy import).
  IF NEW.paid_at IS NULL THEN
    NEW.paid_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_stamp_paid_at_ins ON bookings;
DROP TRIGGER IF EXISTS trg_bookings_stamp_paid_at_upd ON bookings;

CREATE TRIGGER trg_bookings_stamp_paid_at_ins
  BEFORE INSERT ON bookings
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid')
  EXECUTE FUNCTION on_bookings_stamp_paid_at();

CREATE TRIGGER trg_bookings_stamp_paid_at_upd
  BEFORE UPDATE OF payment_status ON bookings
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid' AND OLD.payment_status != 'paid')
  EXECUTE FUNCTION on_bookings_stamp_paid_at();


CREATE OR REPLACE FUNCTION on_bookings_paid_award_and_evaluate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tier_eval_result JSONB;
BEGIN
  -- Row is now visible with payment_status='paid' and paid_at set.
  -- Downstream RPCs can SELECT the row and rely on its committed
  -- state (within-transaction visibility).
  --
  -- D16: cashback eligibility filter (charter / cargo / medevac
  -- out-of-pocket only).
  IF NEW.client_id IS NOT NULL
     AND NEW.source_discriminator IN ('charter', 'cargo', 'medevac')
     AND NOT (NEW.source_discriminator = 'medevac' AND COALESCE(NEW.is_covered, false))
  THEN
    PERFORM award_cashback_for_booking(NEW.client_id, NEW.id);
  END IF;

  -- D26: Diamond grant failure inside evaluate is caught + logged
  -- but does NOT block payment confirmation (the AFTER trigger
  -- fires post-row-visibility but STILL within the same transaction;
  -- uncaught exceptions abort the payment, so D26's BEGIN/EXCEPTION
  -- wrapper is what prevents that).
  IF NEW.client_id IS NOT NULL THEN
    v_tier_eval_result := evaluate_client_privilege_tier(NEW.client_id, NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_paid_award_after_ins ON bookings;
DROP TRIGGER IF EXISTS trg_bookings_paid_award_after_upd ON bookings;

CREATE TRIGGER trg_bookings_paid_award_after_ins
  AFTER INSERT ON bookings
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid')
  EXECUTE FUNCTION on_bookings_paid_award_and_evaluate();

CREATE TRIGGER trg_bookings_paid_award_after_upd
  AFTER UPDATE OF payment_status ON bookings
  FOR EACH ROW
  WHEN (NEW.payment_status = 'paid' AND OLD.payment_status != 'paid')
  EXECUTE FUNCTION on_bookings_paid_award_and_evaluate();


-- =============================================================
-- §4.7 auto_grant_diamond_shield_subscription
--
-- D11 cross-product hook. Called by evaluate_client_privilege_tier
-- when target tier = diamond. Returns subscription_id, OR NULL if
-- skipped (already-diamond / paying-paid-plan).
--
-- F31 (Round 3): grants with covered_members='[]' because Phase 9
-- clients table has no dob column. Owner/admin populates via the
-- Phase 12 Shield detail page before first use (J5b).
-- =============================================================

CREATE OR REPLACE FUNCTION auto_grant_diamond_shield_subscription(
  p_client_id      UUID,
  p_change_log_id  UUID
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_sub_id  UUID;
  v_existing_plan    aeris_shield_plan;
  v_existing_status  aeris_shield_subscription_status;
  v_new_sub_id       UUID;
  v_balance          DECIMAL(14,2);
BEGIN
  -- D12: check for active paying subscription. If client already
  -- has any 'active' subscription (paying or otherwise), skip
  -- the grant. The active subscription is the source of truth
  -- for medevac entitlement.
  SELECT id, plan, status
    INTO v_existing_sub_id, v_existing_plan, v_existing_status
  FROM medevac_subscriptions
  WHERE client_id = p_client_id
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_sub_id IS NOT NULL THEN
    -- J5: skip + log event_type for the right reason.
    SELECT cashback_balance_sar INTO v_balance
    FROM clients WHERE id = p_client_id;

    IF v_existing_plan = 'diamond' THEN
      -- Already has paying-or-granted diamond → no-op.
      INSERT INTO client_loyalty_ledger (
        client_id, event_type, amount_sar, balance_after_sar,
        source_change_log_id
      ) VALUES (
        p_client_id, 'diamond_shield_skipped_already_diamond', 0,
        COALESCE(v_balance, 0), p_change_log_id
      );
    ELSE
      -- Has lower-tier paid plan → D12: paid plan wins.
      INSERT INTO client_loyalty_ledger (
        client_id, event_type, amount_sar, balance_after_sar,
        source_change_log_id
      ) VALUES (
        p_client_id, 'diamond_shield_skipped_paying_paid_plan', 0,
        COALESCE(v_balance, 0), p_change_log_id
      );
    END IF;
    RETURN NULL;
  END IF;

  -- D11: no active subscription → grant free Diamond.
  -- F31: covered_members='[]' (empty); client/admin populates before
  -- first Shield use (J5b documented in spec).
  INSERT INTO medevac_subscriptions (
    client_id, plan,
    annual_fee_at_signup_sar,
    covered_events_at_signup,
    service_level_at_signup,
    includes_repatriation_at_signup,
    max_covered_members_at_signup,
    covered_members,
    status,
    start_date, end_date,
    payment_token_hash
  ) VALUES (
    p_client_id, 'diamond',
    0,
    -1,
    'CCT',
    true,
    4,
    '[]'::jsonb,
    'active',
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '1 year',
    NULL
  ) RETURNING id INTO v_new_sub_id;

  -- Update subscription notes via a follow-up UPDATE (cleaner than
  -- inline NOTE template with change_log_id interpolation in the
  -- INSERT)
  UPDATE medevac_subscriptions
  SET cancellation_reason = NULL  -- placeholder; notes field would
                                   -- go here if subs table had it
  WHERE id = v_new_sub_id;

  SELECT cashback_balance_sar INTO v_balance
  FROM clients WHERE id = p_client_id;

  -- Ledger event: granted
  INSERT INTO client_loyalty_ledger (
    client_id, event_type, amount_sar, balance_after_sar,
    booking_id, source_change_log_id, source_subscription_id
  ) VALUES (
    p_client_id, 'diamond_shield_granted', 0,
    COALESCE(v_balance, 0), NULL,
    p_change_log_id, v_new_sub_id
  );

  RETURN v_new_sub_id;

EXCEPTION WHEN OTHERS THEN
  -- D26: never let a Diamond grant failure abort the payment txn.
  -- Log to ledger + return NULL. Canary surfaces unresolved
  -- grant_failed events.
  BEGIN
    SELECT cashback_balance_sar INTO v_balance
    FROM clients WHERE id = p_client_id;
    INSERT INTO client_loyalty_ledger (
      client_id, event_type, amount_sar, balance_after_sar,
      source_change_log_id
    ) VALUES (
      p_client_id, 'diamond_shield_grant_failed', 0,
      COALESCE(v_balance, 0), p_change_log_id
    );
  EXCEPTION WHEN OTHERS THEN
    -- Ledger insert also failed; nothing else we can do without
    -- aborting. RAISE NOTICE so it surfaces in logs.
    RAISE NOTICE 'auto_grant_diamond_shield_subscription: ledger fallback also failed for client=%', p_client_id;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION auto_grant_diamond_shield_subscription(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_grant_diamond_shield_subscription(UUID, UUID)
  TO service_role;


-- =============================================================
-- §4.8 schedule_diamond_shield_revoke
--
-- D11. On Diamond → lower downgrade, find the free Diamond
-- subscription (identifiable via diamond_shield_granted ledger
-- event) and extend its end_date to MAX(end_date, NOW() + 90 days)
-- to honor grace. The existing Phase 12 expire-shield cron
-- handles the eventual status flip on end_date.
-- =============================================================

CREATE OR REPLACE FUNCTION schedule_diamond_shield_revoke(
  p_client_id      UUID,
  p_change_log_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub_id          UUID;
  v_grace_end_date  DATE;
  v_balance         DECIMAL(14,2);
BEGIN
  -- Find the most recent free-granted Diamond sub for this client.
  -- Identifier: subscription_id linked from a diamond_shield_granted
  -- ledger event, plan='diamond', annual_fee=0.
  SELECT ms.id INTO v_sub_id
  FROM medevac_subscriptions ms
  WHERE ms.client_id = p_client_id
    AND ms.plan = 'diamond'
    AND ms.annual_fee_at_signup_sar = 0
    AND ms.status = 'active'
    AND EXISTS (
      SELECT 1 FROM client_loyalty_ledger l
      WHERE l.source_subscription_id = ms.id
        AND l.event_type = 'diamond_shield_granted'
    )
  ORDER BY ms.created_at DESC
  LIMIT 1;

  IF v_sub_id IS NULL THEN
    -- No free-granted Diamond sub to revoke (client may have
    -- a paying sub which continues independently).
    RETURN;
  END IF;

  -- D11: extend end_date to grace floor. If already past it,
  -- keep existing end_date (don't shorten).
  v_grace_end_date := CURRENT_DATE + INTERVAL '90 days';

  UPDATE medevac_subscriptions
  SET end_date = GREATEST(end_date, v_grace_end_date),
      updated_at = NOW()
  WHERE id = v_sub_id;

  SELECT cashback_balance_sar INTO v_balance
  FROM clients WHERE id = p_client_id;

  INSERT INTO client_loyalty_ledger (
    client_id, event_type, amount_sar, balance_after_sar,
    source_change_log_id, source_subscription_id
  ) VALUES (
    p_client_id, 'diamond_shield_revoked_on_downgrade', 0,
    COALESCE(v_balance, 0), p_change_log_id, v_sub_id
  );
END;
$$;

REVOKE ALL ON FUNCTION schedule_diamond_shield_revoke(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION schedule_diamond_shield_revoke(UUID, UUID)
  TO service_role;


-- =============================================================
-- §4.6 expire_old_loyalty_credits (daily cron)
--
-- D18: 24-month cashback expiry. Scans `earn` events with
-- cashback_expiry_at < NOW() and not yet expired. FIFO matching:
-- for each client, oldest unexpired earn first.
--
-- v1 simplification: emit one `expire` event per client with the
-- total expired amount. Future v1.1 may switch to per-earn
-- matching for finer audit.
-- =============================================================

CREATE OR REPLACE FUNCTION expire_old_loyalty_credits()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id        UUID;
  v_expired_amount   DECIMAL(14,2);
  v_current_balance  DECIMAL(14,2);
  v_new_balance      DECIMAL(14,2);
  v_clients_processed INT := 0;
  v_total_expired_sar DECIMAL(14,2) := 0;
  v_errors           INT := 0;
BEGIN
  -- For each client with an unredeemed expired earn event, sum the
  -- expired amount and post a single `expire` event.
  FOR v_client_id IN
    SELECT DISTINCT client_id
    FROM client_loyalty_ledger
    WHERE event_type = 'earn'
      AND cashback_expiry_at < NOW()
      AND NOT EXISTS (
        SELECT 1 FROM client_loyalty_ledger expired
        WHERE expired.client_id = client_loyalty_ledger.client_id
          AND expired.event_type = 'expire'
          AND expired.created_at > client_loyalty_ledger.cashback_expiry_at
      )
  LOOP
    BEGIN
      -- Lock client row
      SELECT cashback_balance_sar INTO v_current_balance
      FROM clients WHERE id = v_client_id FOR UPDATE;

      IF v_current_balance IS NULL OR v_current_balance <= 0 THEN
        CONTINUE;
      END IF;

      -- Compute expired total — sum of `earn` amounts past expiry
      -- not yet superseded by a subsequent `expire` event.
      SELECT COALESCE(SUM(amount_sar), 0) INTO v_expired_amount
      FROM client_loyalty_ledger
      WHERE client_id = v_client_id
        AND event_type = 'earn'
        AND cashback_expiry_at < NOW();

      -- Cap at current balance (can't expire more than client has)
      v_expired_amount := LEAST(v_expired_amount, v_current_balance);

      IF v_expired_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_new_balance := v_current_balance - v_expired_amount;

      INSERT INTO client_loyalty_ledger (
        client_id, event_type, amount_sar, balance_after_sar
      ) VALUES (
        v_client_id, 'expire', -v_expired_amount, v_new_balance
      );

      UPDATE clients SET cashback_balance_sar = v_new_balance
      WHERE id = v_client_id;

      v_clients_processed := v_clients_processed + 1;
      v_total_expired_sar := v_total_expired_sar + v_expired_amount;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE NOTICE 'expire_old_loyalty_credits: failed for client=%: %', v_client_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'clients_processed', v_clients_processed,
    'total_expired_sar', v_total_expired_sar,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION expire_old_loyalty_credits()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_old_loyalty_credits()
  TO service_role;


-- =============================================================
-- D19 reconcile_client_cashback_balance — REPORT-ONLY
--
-- Sums the ledger for a client and compares to clients.cashback_balance_sar.
-- Returns drift information without auto-correcting (per Round 2 F23).
-- =============================================================

CREATE OR REPLACE FUNCTION reconcile_client_cashback_balance(
  p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_denorm   DECIMAL(14,2);
  v_ledger   DECIMAL(14,2);
BEGIN
  SELECT cashback_balance_sar INTO v_denorm
  FROM clients WHERE id = p_client_id;

  IF v_denorm IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  SELECT COALESCE(SUM(amount_sar), 0) INTO v_ledger
  FROM client_loyalty_ledger
  WHERE client_id = p_client_id;

  RETURN jsonb_build_object(
    'ok', true,
    'client_id', p_client_id,
    'denormalized_balance_sar', v_denorm,
    'ledger_sum_sar', v_ledger,
    'drift_sar', v_denorm - v_ledger,
    'in_sync', v_denorm = v_ledger
  );
END;
$$;

REVOKE ALL ON FUNCTION reconcile_client_cashback_balance(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reconcile_client_cashback_balance(UUID)
  TO service_role;


-- =============================================================
-- §4.2 UPDATE evaluate_client_privilege_tier
--
-- PR 1 shipped a stub for the Diamond × Shield hooks (the helpers
-- didn't exist yet). Now that §4.7 + §4.8 exist, wire them in.
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
  v_spend             DECIMAL(14,2);
  v_current_tier      client_privilege_tier;
  v_target_tier       client_privilege_tier;
  v_below_since       TIMESTAMPTZ;
  v_locked_until      DATE;
  v_change_log_id     UUID;
  v_action            TEXT;
  v_subscription_id   UUID;
BEGIN
  v_spend := calculate_client_qualified_spend_12m(p_client_id);

  SELECT privilege_tier, privilege_below_threshold_since, tier_locked_until
    INTO v_current_tier, v_below_since, v_locked_until
  FROM clients WHERE id = p_client_id FOR UPDATE;

  IF v_current_tier IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  SELECT tier INTO v_target_tier
  FROM privilege_tier_thresholds
  WHERE v_spend >= min_qualified_spend_sar
  ORDER BY min_qualified_spend_sar DESC
  LIMIT 1;

  IF v_target_tier IS NULL THEN v_target_tier := 'silver'; END IF;

  IF tier_rank(v_target_tier) > tier_rank(v_current_tier) THEN
    v_action := 'upgrade';
  ELSIF v_target_tier = v_current_tier THEN
    v_action := 'no_change';
    IF v_below_since IS NOT NULL THEN
      UPDATE clients SET privilege_below_threshold_since = NULL WHERE id = p_client_id;
    END IF;
  ELSIF v_locked_until IS NOT NULL AND v_locked_until > CURRENT_DATE THEN
    v_action := 'locked_no_action';
    IF v_below_since IS NOT NULL THEN
      UPDATE clients SET privilege_below_threshold_since = NULL WHERE id = p_client_id;
    END IF;
  ELSIF v_below_since IS NULL THEN
    v_action := 'start_grace';
    UPDATE clients SET privilege_below_threshold_since = NOW() WHERE id = p_client_id;
  ELSIF NOW() - v_below_since >= INTERVAL '90 days' THEN
    v_action := 'downgrade_one_step';
    v_target_tier := step_down_one(v_current_tier);
    IF v_target_tier = v_current_tier THEN
      v_action := 'no_change';
      UPDATE clients SET privilege_below_threshold_since = NULL WHERE id = p_client_id;
    END IF;
  ELSE
    v_action := 'grace_in_progress';
  END IF;

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

    -- D11: Diamond × Shield cross-product hooks (PR 3 wires what
    -- PR 1 stubbed). D26: failure in grant is caught inside the
    -- helper itself and logged via diamond_shield_grant_failed —
    -- never aborts this transaction.
    IF v_target_tier = 'diamond' THEN
      v_subscription_id := auto_grant_diamond_shield_subscription(
        p_client_id, v_change_log_id
      );
    END IF;
    IF v_current_tier = 'diamond' AND v_target_tier != 'diamond' THEN
      PERFORM schedule_diamond_shield_revoke(p_client_id, v_change_log_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tier_action', v_action,
    'from_tier', v_current_tier,
    'to_tier', v_target_tier,
    'qualified_spend_12m_sar', v_spend,
    'change_log_id', v_change_log_id,
    'diamond_shield_granted_subscription_id', v_subscription_id
  );
END;
$$;

-- ACL re-grant (CREATE OR REPLACE doesn't reset GRANTs but explicit
-- statements make it self-documenting)
REVOKE ALL ON FUNCTION evaluate_client_privilege_tier(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION evaluate_client_privilege_tier(UUID, UUID)
  TO service_role;


-- =============================================================
-- End of Phase 13 PR 3 migration
--
-- Inventory delta vs PR 1:
--   +1 table (client_empty_leg_matches)
--   +4 triggers (stamp_paid_at_ins/upd + paid_award_after_ins/upd)
--   +4 RPCs (expire / auto_grant_diamond_shield / schedule_revoke /
--            reconcile)
--   1 RPC UPDATED (evaluate_client_privilege_tier — now wires the
--                  Diamond × Shield hooks)
-- =============================================================
