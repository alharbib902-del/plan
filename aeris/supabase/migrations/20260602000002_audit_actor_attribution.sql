-- SEC-04 — record the admin actor in Cargo + MedEvac on-behalf audit logs.
--
-- The accept/decline/cancel RPCs accept p_actor_admin_user_id but only
-- accept_cargo_offer wrote it to audit_logs.new_value; the other five
-- dropped it, so admin on-behalf actions logged the admin actor as NULL
-- (SEC-04 — weakened audit attribution).
--
-- Each block below is the EXACT current function body (extracted verbatim
-- from 20260519000031 + 20260526000041) with a SINGLE added line in the
-- audit jsonb_build_object:
--     'actor_admin_user_id', p_actor_admin_user_id
-- placed right after the existing 'actor_client_id' key. No logic, lock,
-- guard, or signature change. CREATE OR REPLACE preserves existing grants;
-- the REVOKE/GRANT are repeated defensively (codebase convention, keeps
-- PUBLIC off). The Server Actions are updated in the same PR to pass
-- session.adminUserId instead of NULL.
--
-- Scope (founder): on-behalf accept/decline/cancel only. NOT expanded to
-- admin_activate_subscription (no actor param) or DB-side RBAC.

-- =============================================================
-- decline_cargo_offer — + admin actor attribution (SEC-04)
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
      'actor_admin_user_id', p_actor_admin_user_id,
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
-- cancel_cargo_request — + admin actor attribution (SEC-04)
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
      'actor_admin_user_id', p_actor_admin_user_id,
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
-- accept_medevac_offer — + admin actor attribution (SEC-04)
-- =============================================================

CREATE OR REPLACE FUNCTION accept_medevac_offer(
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
  v_offer medevac_offers%ROWTYPE;
  v_request medevac_requests%ROWTYPE;
  v_booking_id UUID;
  v_request_id_for_lock UUID;
BEGIN
  -- actor_ambiguous-only (Phase 11 round 6 P1 #1 pattern)
  IF p_actor_client_id IS NOT NULL AND p_actor_admin_user_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'actor_ambiguous');
  END IF;

  -- Deadlock-safe lock order (Phase 11 round 4 P1 #1 pattern)
  SELECT medevac_request_id INTO v_request_id_for_lock
    FROM medevac_offers WHERE id = p_offer_id;
  IF v_request_id_for_lock IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  -- Step 1: lock parent request first.
  SELECT * INTO v_request FROM medevac_requests
   WHERE id = v_request_id_for_lock FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  -- Step 2: lock all siblings in id-ORDER (deadlock-safe).
  PERFORM 1 FROM medevac_offers
    WHERE medevac_request_id = v_request_id_for_lock
    ORDER BY id
    FOR UPDATE;

  -- Step 3: re-load target offer post-lock.
  SELECT * INTO v_offer FROM medevac_offers
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
    -- Admin path — only allowed on guest requests (mirrors cargo).
    IF v_request.client_id IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'error',
        'admin_cannot_accept_for_authed_client');
    END IF;
  END IF;

  -- D6 booking shape: source_offer_table='medevac_offers',
  -- source_offer_id=v_offer.id, source_discriminator='medevac',
  -- offer_id=NULL, trip_request_id=NULL.
  --
  -- D8 (f) transition gate — the booked operator legitimately
  -- needs patient_name for transport coordination, so we copy
  -- the snapshot into bookings.customer_name_snapshot. This is
  -- the only post-acceptance fanout of patient PII; the
  -- admin_pii_read audit (§4.10) guards DIRECT reads of
  -- medevac_requests.patient_name_snapshot.
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
    v_request.from_iata, v_request.to_iata,
    v_request.from_location_freeform, v_request.to_hospital_name,
    NULL, NULL,
    'medevac_offers',
    v_offer.id,
    'medevac',
    v_request.client_id,
    v_request.patient_name_snapshot,
    v_request.contact_phone_snapshot,
    v_offer.operator_id,
    v_offer.operator_name_snapshot,
    v_offer.operator_phone_snapshot,
    v_offer.operator_email_snapshot,
    v_offer.aircraft_id,
    v_offer.aircraft_snapshot,
    v_offer.base_price_sar,
    v_offer.medical_team_price_sar + v_offer.insurance_coordination_price_sar,
    NULL,
    v_offer.total_price_sar,
    NULL, NULL,
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_offer.proposed_pickup_at,
    NULL, NULL
  )
  RETURNING id INTO v_booking_id;

  -- Flip offer + request statuses
  UPDATE medevac_offers
     SET status = 'accepted',
         decided_at = v_now,
         decided_by_user_id = p_actor_client_id,
         updated_at = v_now
   WHERE id = p_offer_id;

  UPDATE medevac_requests
     SET status = 'accepted',
         accepted_offer_id = p_offer_id,
         updated_at = v_now
   WHERE id = v_request.id;

  -- Decline siblings
  UPDATE medevac_offers
     SET status = 'declined',
         decided_at = v_now,
         decided_by_user_id = p_actor_client_id,
         updated_at = v_now
   WHERE medevac_request_id = v_request.id
     AND id <> p_offer_id
     AND status = 'pending';

  -- D12 audit: PII redacted (MEV-XXXX + service_level +
  -- condition_severity only); patient_name NEVER in new_value.
  INSERT INTO audit_logs (
    entity_type, entity_id, action, new_value, user_id
  ) VALUES (
    'booking', v_booking_id, 'medevac_offer_accepted',
    jsonb_build_object(
      'offer_id', p_offer_id,
      'medevac_request_id', v_request.id,
      'mev_number', v_request.medevac_request_number,
      'service_level', v_request.service_level,
      'condition_severity', v_request.condition_severity,
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
    'medevac_request_id', v_request.id,
    'accepted_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION accept_medevac_offer(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_medevac_offer(UUID, UUID, UUID)
  TO service_role;

-- =============================================================
-- decline_medevac_offer — + admin actor attribution (SEC-04)
-- =============================================================

CREATE OR REPLACE FUNCTION decline_medevac_offer(
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
  v_offer medevac_offers%ROWTYPE;
  v_request medevac_requests%ROWTYPE;
  v_request_id_for_lock UUID;
BEGIN
  IF p_actor_client_id IS NOT NULL AND p_actor_admin_user_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'actor_ambiguous');
  END IF;

  -- Reason length cap (defense-in-depth; Server Action validates too).
  IF p_reason IS NOT NULL AND length(BTRIM(p_reason)) > 500 THEN
    RETURN json_build_object('ok', false, 'error', 'reason_too_long');
  END IF;

  -- Deterministic lock order: parent request first, then offer.
  SELECT medevac_request_id INTO v_request_id_for_lock
    FROM medevac_offers WHERE id = p_offer_id;
  IF v_request_id_for_lock IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  SELECT * INTO v_request FROM medevac_requests
   WHERE id = v_request_id_for_lock FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  SELECT * INTO v_offer FROM medevac_offers
   WHERE id = p_offer_id FOR UPDATE;

  -- Auth-before-idempotency (Phase 11 round 1 PR #66 P2 #2).
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

  UPDATE medevac_offers
     SET status = 'declined',
         decided_at = NOW(),
         decided_by_user_id = p_actor_client_id,
         decline_reason = NULLIF(BTRIM(p_reason), ''),
         updated_at = NOW()
   WHERE id = p_offer_id;

  -- D12 PII-redacted audit.
  INSERT INTO audit_logs (entity_type, entity_id, action, new_value, user_id)
  VALUES (
    'medevac_offers',
    p_offer_id,
    'medevac_offer_declined',
    jsonb_build_object(
      'actor_type', CASE WHEN p_actor_client_id IS NOT NULL THEN 'client' ELSE 'admin' END,
      'actor_client_id', p_actor_client_id,
      'actor_admin_user_id', p_actor_admin_user_id,
      'mev_number', v_request.medevac_request_number,
      'reason', NULLIF(BTRIM(p_reason), '')
    ),
    NULL
  );

  RETURN json_build_object('ok', true, 'offer_id', p_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION decline_medevac_offer(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION decline_medevac_offer(UUID, UUID, UUID, TEXT)
  TO service_role;

-- =============================================================
-- cancel_medevac_request — + admin actor attribution (SEC-04)
-- =============================================================

CREATE OR REPLACE FUNCTION cancel_medevac_request(
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
  v_request medevac_requests%ROWTYPE;
  v_cascade_declined INT := 0;
BEGIN
  IF p_actor_client_id IS NOT NULL AND p_actor_admin_user_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'actor_ambiguous');
  END IF;

  IF p_reason IS NOT NULL AND length(BTRIM(p_reason)) > 500 THEN
    RETURN json_build_object('ok', false, 'error', 'reason_too_long');
  END IF;

  SELECT * INTO v_request FROM medevac_requests
   WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  -- Auth-before-idempotency.
  IF p_actor_client_id IS NOT NULL THEN
    IF v_request.client_id IS NULL OR v_request.client_id <> p_actor_client_id THEN
      RETURN json_build_object('ok', false, 'error', 'forbidden');
    END IF;
  ELSE
    -- Admin path: must be guest request.
    IF v_request.client_id IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'error', 'admin_cannot_cancel_authed');
    END IF;
  END IF;

  -- Idempotency.
  IF v_request.status = 'cancelled' THEN
    RETURN json_build_object('ok', true, 'already_cancelled', true,
      'cascade_declined_offers', 0);
  END IF;

  -- Cannot cancel terminal states.
  IF v_request.status IN ('accepted', 'covered', 'expired') THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_cancellable',
      'current_status', v_request.status);
  END IF;

  -- Cascade-decline any pending offers on this request.
  WITH cascade AS (
    UPDATE medevac_offers
       SET status = 'declined',
           decided_at = NOW(),
           decided_by_user_id = p_actor_client_id,
           decline_reason = 'request_cancelled',
           updated_at = NOW()
     WHERE medevac_request_id = p_request_id
       AND status = 'pending'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_cascade_declined FROM cascade;

  UPDATE medevac_requests
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancellation_reason = NULLIF(BTRIM(p_reason), ''),
         updated_at = NOW()
   WHERE id = p_request_id;

  INSERT INTO audit_logs (entity_type, entity_id, action, new_value, user_id)
  VALUES (
    'medevac_requests',
    p_request_id,
    'medevac_request_cancelled',
    jsonb_build_object(
      'actor_type', CASE WHEN p_actor_client_id IS NOT NULL THEN 'client' ELSE 'admin' END,
      'actor_client_id', p_actor_client_id,
      'actor_admin_user_id', p_actor_admin_user_id,
      'mev_number', v_request.medevac_request_number,
      'cascade_declined_offers', v_cascade_declined,
      'reason', NULLIF(BTRIM(p_reason), '')
    ),
    NULL
  );

  RETURN json_build_object(
    'ok', true,
    'request_id', p_request_id,
    'cascade_declined_offers', v_cascade_declined
  );
END;
$$;

REVOKE ALL ON FUNCTION cancel_medevac_request(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_medevac_request(UUID, UUID, UUID, TEXT)
  TO service_role;
