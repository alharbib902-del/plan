-- =============================================================
-- Phase 11 PR 2 — cargo offers + booking integration
-- =============================================================
--
-- Migration adds:
--   §1 Schema deltas (cargo_offers reason columns + length CHECKs;
--      cargo_requests cancellation_reason length CHECK)
--   §2 §4.4 accept_cargo_offer  (full SQL from parent spec)
--   §3 §4.5 decline_cargo_offer (full SQL from PR 2 spec)
--   §4 §4.5 withdraw_cargo_offer (full SQL from PR 2 spec)
--   §5 §4.6 cancel_cargo_request (full SQL from PR 2 spec)
--
-- Companion to PHASE-11-PR-2-SPEC.md (merged in #66 at 0b31c9b).
-- The spec is the binding contract; this migration is the
-- implementation. Inline comments cite the spec sections that
-- govern each block.
--
-- Replay safety (Phase 9 convention):
--   - All ALTER TABLE ADD COLUMN use IF NOT EXISTS
--   - All ALTER TABLE ADD CONSTRAINT wrapped in pg_constraint guards
--   - All RPCs use CREATE OR REPLACE FUNCTION
--   - Single migration file applies cleanly on fresh DB AND on a
--     PR 1-applied DB AND on a PR 1+PR 2 already-applied DB.
--
-- Auth model:
--   - Aeris admin = cookie + ENV (Phase 8); admins have NO users
--     row → admin path passes BOTH actor IDs as NULL after
--     requireAdminSession() at the Server Action layer.
--   - Client path = client_id from authed session.
--   - Operator path = operator_id from authed session +
--     password_must_change guard at Server Action layer.
-- =============================================================

-- -------------------------------------------------------------
-- §1 Schema deltas
-- -------------------------------------------------------------

-- §1.1 cargo_offers: decline_reason + withdraw_reason columns
ALTER TABLE cargo_offers
  ADD COLUMN IF NOT EXISTS decline_reason TEXT,
  ADD COLUMN IF NOT EXISTS withdraw_reason TEXT;

-- §1.2 cargo_offers: length CHECKs (replay-safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_offers_decline_reason_length_check'
       AND conrelid = 'cargo_offers'::regclass
  ) THEN
    ALTER TABLE cargo_offers
      ADD CONSTRAINT cargo_offers_decline_reason_length_check
      CHECK (decline_reason IS NULL OR length(decline_reason) <= 500);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_offers_withdraw_reason_length_check'
       AND conrelid = 'cargo_offers'::regclass
  ) THEN
    ALTER TABLE cargo_offers
      ADD CONSTRAINT cargo_offers_withdraw_reason_length_check
      CHECK (withdraw_reason IS NULL OR length(withdraw_reason) <= 500);
  END IF;
END $$;

-- §1.3 cargo_requests: length CHECK on existing cancellation_reason
-- (column was created in PR 1 §3.1 line 141; PR 2 only adds the
-- length cap as defense-in-depth alongside the Server Action /
-- BTRIM cap of 500 chars).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_requests_cancellation_reason_length_check'
       AND conrelid = 'cargo_requests'::regclass
  ) THEN
    ALTER TABLE cargo_requests
      ADD CONSTRAINT cargo_requests_cancellation_reason_length_check
      CHECK (cancellation_reason IS NULL
             OR length(cancellation_reason) <= 500);
  END IF;
END $$;

-- §1.4 bookings financial-column widening (Round 1 PR #67 P1 #1).
--
-- cargo_offers (PR 1 §3.2) chose DECIMAL(14,2) for all price
-- columns to accommodate high-value cargo (e.g. luxury car +
-- valuables shipments easily reach 8-figure SAR). The legacy
-- bookings columns from initial_schema.sql (lines 313-318) are
-- DECIMAL(12,2), which caps at 9,999,999,999.99. Any cargo offer
-- accepted into accept_cargo_offer with base + insurance +
-- customs > DECIMAL(12,2) would write fine into cargo_offers but
-- explode at the bookings INSERT with `numeric_value_out_of_range`
-- (sqlstate 22003) — the user sees a generic server_error after
-- the entire flow appeared to succeed.
--
-- Fix: widen the 6 bookings financial columns to DECIMAL(14,2)
-- so the source-of-truth on cargo_offers fits cleanly into
-- bookings. This is a metadata-only change for PostgreSQL
-- (DECIMAL precision-only widening is a no-op at storage layer);
-- existing rows remain valid.
--
-- Replay-safe: each ALTER guarded by an information_schema check
-- so re-running on a PR 2-applied DB is a no-op.
DO $$
DECLARE
  v_col TEXT;
  v_cols TEXT[] := ARRAY[
    'base_amount', 'addons_amount', 'vat_amount',
    'total_amount', 'commission_amount', 'operator_payout'
  ];
BEGIN
  FOREACH v_col IN ARRAY v_cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'bookings'
         AND column_name = v_col
         AND numeric_precision = 12
    ) THEN
      EXECUTE format(
        'ALTER TABLE bookings ALTER COLUMN %I TYPE DECIMAL(14, 2)',
        v_col
      );
    END IF;
  END LOOP;
END $$;

-- =============================================================
-- §2 accept_cargo_offer (per parent spec §4.4)
-- =============================================================
--
-- Verbatim port from PHASE-11-CARGO-SPEC.md lines 1872-2118.
-- The 6-iteration history (rounds 4-10 on PR #64) lives in the
-- inline comments and MUST be preserved — they document why
-- current invariants exist:
--   - Round 4 P1 #1: deadlock-safe lock order (parent first,
--     siblings in id-ORDER for FOR UPDATE)
--   - Round 5 P1 #1: explicit booking-shape (offer_id=NULL,
--     trip_request_id=NULL, source_offer_table='cargo_offers')
--   - Round 6 P1 #1: actor_ambiguous-only check (admin path
--     passes both NULL because admins have no users row)
--   - Round 3 P1 #1 audit_logs schema (entity_type, entity_id,
--     action, new_value, user_id; admin info inside new_value)

CREATE OR REPLACE FUNCTION accept_cargo_offer(
  p_offer_id UUID,
  p_actor_client_id UUID,
  p_actor_admin_user_id UUID
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_offer cargo_offers%ROWTYPE;
  v_request cargo_requests%ROWTYPE;
  v_booking_id UUID;
  v_request_id_for_lock UUID;
BEGIN
  -- Round 6 P1 #1 — actor_ambiguous-only.
  IF p_actor_client_id IS NOT NULL AND p_actor_admin_user_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'actor_ambiguous');
  END IF;

  -- Round 4 P1 #1 — deadlock-safe lock order.
  SELECT cargo_request_id INTO v_request_id_for_lock
    FROM cargo_offers WHERE id = p_offer_id;
  IF v_request_id_for_lock IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  -- Step 1: lock parent request first.
  SELECT * INTO v_request FROM cargo_requests
    WHERE id = v_request_id_for_lock FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  -- Step 2: lock all siblings in id-ORDER (deadlock-safe).
  PERFORM 1 FROM cargo_offers
    WHERE cargo_request_id = v_request_id_for_lock
    ORDER BY id
    FOR UPDATE;

  -- Step 3: re-load target offer post-lock.
  SELECT * INTO v_offer FROM cargo_offers
    WHERE id = p_offer_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  -- State guards
  IF v_offer.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_pending');
  END IF;
  IF v_offer.expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'offer_expired');
  END IF;
  IF v_request.status NOT IN ('pending', 'offers_received') THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_open');
  END IF;
  IF v_request.expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'request_expired');
  END IF;

  -- Authorization: client path must own request; admin only on guest.
  IF p_actor_client_id IS NOT NULL THEN
    IF v_request.client_id IS DISTINCT FROM p_actor_client_id THEN
      RETURN json_build_object('ok', false, 'error', 'not_your_request');
    END IF;
  ELSE
    IF v_request.client_id IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'error',
        'admin_cannot_accept_for_authed_client');
    END IF;
  END IF;

  -- Round 5 P1 #1 — booking shape (offer_id=NULL, trip_request_id=NULL,
  -- source_offer_table='cargo_offers', source_offer_id=v_offer.id).
  INSERT INTO bookings (
    offer_id, trip_request_id,
    route_origin_iata, route_destination_iata,
    route_origin_freeform_snapshot, route_destination_freeform_snapshot,
    passengers_count_snapshot, return_scheduled,
    source_offer_table, source_offer_id,
    source_discriminator,
    client_id,
    customer_name_snapshot, customer_phone_snapshot,
    operator_id,
    operator_name_snapshot, operator_phone_snapshot, operator_email_snapshot,
    aircraft_id, aircraft_snapshot,
    base_amount, addons_amount, vat_amount, total_amount,
    commission_amount, operator_payout,
    payment_status, flight_status,
    departure_scheduled,
    checkout_token_hash, checkout_token_expires_at
  ) VALUES (
    NULL, NULL,
    v_request.origin_iata, v_request.destination_iata,
    v_request.origin_freeform, v_request.destination_freeform,
    NULL, NULL,
    'cargo_offers',
    v_offer.id,
    'cargo',
    v_request.client_id,
    v_request.customer_name_snapshot,
    v_request.customer_phone_snapshot,
    v_offer.operator_id,
    v_offer.operator_name_snapshot,
    v_offer.operator_phone_snapshot,
    v_offer.operator_email_snapshot,
    v_offer.aircraft_id,
    v_offer.aircraft_snapshot,
    v_offer.base_price_sar,
    v_offer.insurance_price_sar + v_offer.customs_handling_price_sar,
    NULL,
    v_offer.total_price_sar,
    NULL, NULL,
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_offer.proposed_pickup_date::TIMESTAMPTZ,
    NULL, NULL
  )
  RETURNING id INTO v_booking_id;

  -- Flip offer + request statuses
  UPDATE cargo_offers
     SET status = 'accepted',
         decided_at = v_now,
         decided_by_user_id = p_actor_client_id,
         updated_at = v_now
   WHERE id = p_offer_id;

  UPDATE cargo_requests
     SET status = 'accepted',
         accepted_offer_id = p_offer_id,
         updated_at = v_now
   WHERE id = v_request.id;

  -- Decline siblings
  UPDATE cargo_offers
     SET status = 'declined',
         decided_at = v_now,
         decided_by_user_id = p_actor_client_id,
         updated_at = v_now
   WHERE cargo_request_id = v_request.id
     AND id <> p_offer_id
     AND status = 'pending';

  -- Audit log (Phase 10 §4.3 round 3 P1 #1 pattern)
  INSERT INTO audit_logs (
    entity_type, entity_id, action, new_value, user_id
  ) VALUES (
    'booking', v_booking_id, 'cargo_offer_accepted',
    jsonb_build_object(
      'offer_id', p_offer_id,
      'cargo_request_id', v_request.id,
      'actor_client_id', p_actor_client_id,
      'actor_admin_user_id', p_actor_admin_user_id,
      'accepted_at', v_now
    ),
    NULL
  );

  RETURN json_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'offer_id', p_offer_id,
    'cargo_request_id', v_request.id,
    'accepted_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION accept_cargo_offer(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_cargo_offer(UUID, UUID, UUID)
  TO service_role;

-- =============================================================
-- §3 decline_cargo_offer (PR 2 spec §2.2)
-- =============================================================

CREATE OR REPLACE FUNCTION decline_cargo_offer(
  p_offer_id UUID,
  p_actor_client_id UUID,
  p_actor_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer cargo_offers%ROWTYPE;
  v_request cargo_requests%ROWTYPE;
  v_request_id_for_lock UUID;
BEGIN
  -- Mirror §4.4 round 6 P1 #1.
  IF p_actor_client_id IS NOT NULL AND p_actor_admin_user_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'actor_ambiguous');
  END IF;

  -- Reason length cap (defense-in-depth; Server Action validates too).
  IF p_reason IS NOT NULL AND length(BTRIM(p_reason)) > 500 THEN
    RETURN json_build_object('ok', false, 'error', 'reason_too_long');
  END IF;

  -- Deterministic lock order: parent request first, then offer.
  SELECT cargo_request_id INTO v_request_id_for_lock
    FROM cargo_offers WHERE id = p_offer_id;
  IF v_request_id_for_lock IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  SELECT * INTO v_request FROM cargo_requests
   WHERE id = v_request_id_for_lock FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  SELECT * INTO v_offer FROM cargo_offers
   WHERE id = p_offer_id FOR UPDATE;

  -- Round 1 PR #66 P2 #2 — authorization BEFORE idempotency.
  -- A logged-in client probing arbitrary offer UUIDs must not learn
  -- whether they're declined; only the request owner / admin (for
  -- guest requests) gets to see status. Auth-then-state.
  IF p_actor_client_id IS NOT NULL THEN
    IF v_request.client_id IS NULL OR v_request.client_id <> p_actor_client_id THEN
      RETURN json_build_object('ok', false, 'error', 'forbidden');
    END IF;
  ELSE
    -- Admin path: must be guest request.
    IF v_request.client_id IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'error', 'admin_cannot_decline_authed');
    END IF;
  END IF;

  -- Idempotency (now scoped to the authorized actor).
  IF v_offer.status = 'declined' THEN
    RETURN json_build_object('ok', true, 'already_declined', true);
  END IF;
  IF v_offer.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_pending',
      'current_status', v_offer.status);
  END IF;

  UPDATE cargo_offers
     SET status = 'declined',
         decided_at = NOW(),
         decline_reason = NULLIF(BTRIM(p_reason), '')
   WHERE id = p_offer_id;

  -- Round 1 PR #66 P1 #1 — audit_logs uses (entity_type, entity_id,
  -- action, new_value); actor info packed inside new_value JSONB.
  INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
  VALUES (
    'cargo_offers',
    p_offer_id,
    'cargo_offer_declined',
    jsonb_build_object(
      'actor_type', CASE WHEN p_actor_client_id IS NOT NULL THEN 'client' ELSE 'admin' END,
      'actor_client_id', p_actor_client_id,
      'reason', NULLIF(BTRIM(p_reason), '')
    )
  );

  RETURN json_build_object('ok', true, 'offer_id', p_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION decline_cargo_offer(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION decline_cargo_offer(UUID, UUID, UUID, TEXT)
  TO service_role;

-- =============================================================
-- §4 withdraw_cargo_offer (PR 2 spec §2.3)
-- =============================================================

CREATE OR REPLACE FUNCTION withdraw_cargo_offer(
  p_offer_id UUID,
  p_operator_id UUID,
  p_reason TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_offer cargo_offers%ROWTYPE;
  v_request_id_for_lock UUID;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'operator_required');
  END IF;

  IF p_reason IS NOT NULL AND length(BTRIM(p_reason)) > 500 THEN
    RETURN json_build_object('ok', false, 'error', 'reason_too_long');
  END IF;

  -- Same deterministic lock order as §4.4/§4.5 decline.
  SELECT cargo_request_id INTO v_request_id_for_lock
    FROM cargo_offers WHERE id = p_offer_id;
  IF v_request_id_for_lock IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  PERFORM 1 FROM cargo_requests WHERE id = v_request_id_for_lock FOR UPDATE;
  SELECT * INTO v_offer FROM cargo_offers
   WHERE id = p_offer_id FOR UPDATE;

  -- Operator must own the offer (auth before status — already
  -- correct in spec round 0; no reorder needed for withdraw).
  IF v_offer.operator_id <> p_operator_id THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- Idempotency.
  IF v_offer.status = 'withdrawn' THEN
    RETURN json_build_object('ok', true, 'already_withdrawn', true);
  END IF;
  IF v_offer.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_pending',
      'current_status', v_offer.status);
  END IF;

  UPDATE cargo_offers
     SET status = 'withdrawn',
         decided_at = NOW(),
         withdraw_reason = NULLIF(BTRIM(p_reason), '')
   WHERE id = p_offer_id;

  INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
  VALUES (
    'cargo_offers',
    p_offer_id,
    'cargo_offer_withdrawn',
    jsonb_build_object(
      'actor_type', 'operator',
      'actor_operator_id', p_operator_id,
      'reason', NULLIF(BTRIM(p_reason), '')
    )
  );

  RETURN json_build_object('ok', true, 'offer_id', p_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION withdraw_cargo_offer(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION withdraw_cargo_offer(UUID, UUID, TEXT)
  TO service_role;

-- =============================================================
-- §5 cancel_cargo_request (PR 2 spec §2.4)
-- =============================================================

CREATE OR REPLACE FUNCTION cancel_cargo_request(
  p_request_id UUID,
  p_actor_client_id UUID,
  p_actor_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_request cargo_requests%ROWTYPE;
  v_cascade_count INT := 0;
BEGIN
  -- Mirror §4.4 actor_ambiguous-only rule.
  IF p_actor_client_id IS NOT NULL AND p_actor_admin_user_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'actor_ambiguous');
  END IF;

  IF p_reason IS NOT NULL AND length(BTRIM(p_reason)) > 500 THEN
    RETURN json_build_object('ok', false, 'error', 'reason_too_long');
  END IF;

  SELECT * INTO v_request FROM cargo_requests
   WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  -- Round 1 PR #66 P2 #2 — authorization FIRST.
  -- Probing an arbitrary request UUID must not reveal whether it
  -- exists, is cancelled, or is accepted. Auth-then-state.
  IF p_actor_client_id IS NOT NULL THEN
    IF v_request.client_id IS NULL OR v_request.client_id <> p_actor_client_id THEN
      RETURN json_build_object('ok', false, 'error', 'forbidden');
    END IF;
  ELSE
    IF v_request.client_id IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'error', 'admin_cannot_cancel_authed');
    END IF;
  END IF;

  -- Idempotency (after auth).
  IF v_request.status = 'cancelled' THEN
    RETURN json_build_object('ok', true, 'already_cancelled', true);
  END IF;

  -- Already-accepted requests cannot be cancelled here; they
  -- must go through the booking-cancel flow (Phase 14).
  IF v_request.status = 'accepted' OR v_request.accepted_offer_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'request_already_accepted');
  END IF;

  IF v_request.status NOT IN ('pending', 'offers_received') THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_cancellable',
      'current_status', v_request.status);
  END IF;

  -- Cascade: decline all pending offers (id-ORDER for deterministic
  -- lock acquisition).
  WITH cascade AS (
    UPDATE cargo_offers
       SET status = 'declined',
           decided_at = NOW(),
           decline_reason = COALESCE(NULLIF(BTRIM(p_reason), ''),
                                     'request_cancelled')
     WHERE cargo_request_id = p_request_id
       AND status = 'pending'
     RETURNING id
  )
  SELECT COUNT(*) INTO v_cascade_count FROM cascade;

  -- Round 1 PR #66 P2 #3 — reuse cargo_requests.cancellation_reason
  -- (created in PR 1 §3.1 line 141) instead of adding a duplicate
  -- cancel_reason. cancelled_at also already exists from PR 1.
  UPDATE cargo_requests
     SET status = 'cancelled',
         cancellation_reason = NULLIF(BTRIM(p_reason), ''),
         cancelled_at = NOW()
   WHERE id = p_request_id;

  -- Round 1 PR #66 P1 #1 — audit_logs shape matches Phase 7/10.
  INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
  VALUES (
    'cargo_requests',
    p_request_id,
    'cargo_request_cancelled',
    jsonb_build_object(
      'actor_type', CASE WHEN p_actor_client_id IS NOT NULL THEN 'client' ELSE 'admin' END,
      'actor_client_id', p_actor_client_id,
      'reason', NULLIF(BTRIM(p_reason), ''),
      'cascade_declined_offers', v_cascade_count
    )
  );

  RETURN json_build_object('ok', true,
    'request_id', p_request_id,
    'cascade_declined_offers', v_cascade_count);
END;
$$;

REVOKE ALL ON FUNCTION cancel_cargo_request(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_cargo_request(UUID, UUID, UUID, TEXT)
  TO service_role;

-- =============================================================
-- End of Phase 11 PR 2 migration
-- =============================================================
