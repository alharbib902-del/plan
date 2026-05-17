-- =============================================================
-- Phase 12 PR 2 — MedEvac offers + booking + subscriptions
-- =============================================================
--
-- Migration adds 5 SECURITY DEFINER RPCs from the spec:
--   §4.4 accept_medevac_offer      — client/admin accept; creates booking
--   §4.5 decline_medevac_offer     — client/admin decline (idempotent)
--   §4.5 withdraw_medevac_offer    — operator-initiated withdraw
--   §4.6 cancel_medevac_request    — client/admin cancel (cascades to offers)
--   §4.9 admin_activate_subscription — admin flip pending_payment → active
--
-- Spec: aeris/docs/PHASE-12-MEDEVAC-SPEC.md
-- (PR #75 merged at 082d90a, 16 Codex review rounds).
-- PR 1 (#76 merged at d5abe81) landed the tables + 6 RPCs;
-- PR 2 adds the lifecycle + admin activation RPCs.
--
-- All 5 RPCs mirror Phase 11 cargo PR 2 §4.4-§4.6 patterns
-- exactly with `cargo_` → `medevac_` rename, EXCEPT
-- accept_medevac_offer which:
--   (a) Uses booking shape source_offer_table='medevac_offers'
--       + source_discriminator='medevac' per D6
--   (b) Snapshots the medevac_offers operator + medical_team
--       + aircraft fields (not cargo's customs/insurance pricing)
--   (c) Lets the booked operator see the patient_name
--       post-acceptance (D8 (f) transition gate — the booking
--       carries customer_name_snapshot = patient_name_snapshot
--       so the operator's bookings page can render it; the
--       admin_pii_read audit only protects DIRECT reads of
--       medevac_requests.patient_name_snapshot, not the
--       snapshot copy on bookings)
--
-- Replay safety:
--   - All RPCs use CREATE OR REPLACE FUNCTION
--   - All ALTER TABLE guarded by pg_constraint checks
--   - Single migration file applies cleanly on fresh DB AND
--     on a PR 1-applied DB AND on a PR 2 already-applied DB
--
-- Auth model (unchanged from Phase 11):
--   - Aeris admin = cookie + ENV (Phase 8); admins have NO users
--     row → admin path passes BOTH actor IDs as NULL after
--     requireAdminSession() at the Server Action layer.
--   - Client path = client_id from authed session.
--   - Operator path = operator_id from authed session +
--     password_must_change guard at Server Action layer.
-- =============================================================


-- =============================================================
-- §4.4 — accept_medevac_offer
--
-- Mirror of Phase 11 §4.4 accept_cargo_offer with the booking
-- shape adjusted for medevac (D6). Preserves all the Phase 11
-- safety invariants:
--   - Round 4 P1 #1 deadlock-safe lock order (parent first,
--     siblings in id-ORDER for FOR UPDATE)
--   - Round 5 P1 #1 explicit booking-shape (offer_id=NULL,
--     trip_request_id=NULL, source_offer_table='medevac_offers',
--     source_offer_id=v_offer.id, source_discriminator='medevac')
--   - Round 6 P1 #1 actor_ambiguous-only check (admin path
--     passes both NULL because admins have no users row)
--   - Round 3 P1 #1 audit_logs schema (entity_type, entity_id,
--     action, new_value, user_id=NULL; actor info inside new_value)
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
-- §4.5 — decline_medevac_offer
--
-- Mirror of Phase 11 §4.5 decline_cargo_offer. Auth-before-
-- idempotency (Phase 11 round 1 PR #66 P2 #2 pattern): a
-- logged-in client probing arbitrary offer UUIDs must NOT
-- learn whether they're already declined; only the request
-- owner (or admin for guest paths) gets to see status.
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
-- §4.5 — withdraw_medevac_offer
--
-- Operator-initiated withdraw. Mirror of Phase 11 §4.5
-- withdraw_cargo_offer. Authorization: operator who SUBMITTED
-- the offer (operator_id match). Idempotent: re-calling on an
-- already-withdrawn offer returns {ok:true, already_withdrawn:true}.
-- =============================================================

CREATE OR REPLACE FUNCTION withdraw_medevac_offer(
  p_offer_id UUID,
  p_actor_operator_id UUID,
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
  IF p_actor_operator_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'operator_id_required');
  END IF;

  -- Reason length cap.
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

  -- Authorization (must be the offer's own operator).
  IF v_offer.operator_id <> p_actor_operator_id THEN
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

  UPDATE medevac_offers
     SET status = 'withdrawn',
         decided_at = NOW(),
         withdraw_reason = NULLIF(BTRIM(p_reason), ''),
         updated_at = NOW()
   WHERE id = p_offer_id;

  INSERT INTO audit_logs (entity_type, entity_id, action, new_value, user_id)
  VALUES (
    'medevac_offers',
    p_offer_id,
    'medevac_offer_withdrawn',
    jsonb_build_object(
      'actor_operator_id', p_actor_operator_id,
      'mev_number', v_request.medevac_request_number,
      'reason', NULLIF(BTRIM(p_reason), '')
    ),
    NULL
  );

  RETURN json_build_object('ok', true, 'offer_id', p_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION withdraw_medevac_offer(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION withdraw_medevac_offer(UUID, UUID, TEXT)
  TO service_role;


-- =============================================================
-- §4.6 — cancel_medevac_request
--
-- Client/admin cancellation. Mirror of Phase 11 §4.6
-- cancel_cargo_request. Cascades pending offers to 'declined'.
-- Auth-before-idempotency (same Phase 11 round 1 P2 #2 pattern).
--
-- Note: a 'covered' request (J5 Shield path) cannot be
-- cancelled via this RPC — the booking is already confirmed
-- and the subscription event already consumed. A future
-- "Shield event refund" flow would be needed instead; out of
-- scope for Phase 12.
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


-- =============================================================
-- §4.9 — admin_activate_subscription
--
-- NEW — admin-only path for Phase 12 (before Phase 14 wires
-- HyperPay). Flips status from 'pending_payment' to 'active'
-- and stamps start_date + end_date + next_renewal_due.
--
-- Round 6 PR #75 P2 #4 fix relaxed the active_has_dates CHECK
-- so 'cancelled' rows could sit with NULL dates pre-activation;
-- but 'active' STILL requires both dates populated, so this
-- RPC must stamp them atomically with the status flip.
--
-- Date math:
--   start_date := CURRENT_DATE
--   end_date   := CURRENT_DATE + INTERVAL '1 year'
--   next_renewal_due := end_date - INTERVAL '30 days'
-- (Riyadh wall-clock semantics — Saudi Arabia is UTC+3 fixed.)
-- =============================================================

CREATE OR REPLACE FUNCTION admin_activate_subscription(
  p_subscription_id UUID
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_subscription medevac_subscriptions%ROWTYPE;
  v_start DATE;
  v_end DATE;
  v_renewal TIMESTAMPTZ;
BEGIN
  IF p_subscription_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'subscription_id_required');
  END IF;

  -- Lock the subscription row.
  SELECT * INTO v_subscription
    FROM medevac_subscriptions
   WHERE id = p_subscription_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'subscription_not_found');
  END IF;

  -- Idempotency: already-active returns ok.
  IF v_subscription.status = 'active' THEN
    RETURN json_build_object(
      'ok', true,
      'already_active', true,
      'subscription_id', p_subscription_id,
      'start_date', v_subscription.start_date,
      'end_date', v_subscription.end_date
    );
  END IF;

  -- Activation only allowed from pending_payment.
  IF v_subscription.status <> 'pending_payment' THEN
    RETURN json_build_object('ok', false, 'error', 'subscription_not_activatable',
      'current_status', v_subscription.status);
  END IF;

  v_start := CURRENT_DATE;
  v_end := CURRENT_DATE + INTERVAL '1 year';
  v_renewal := (v_end - INTERVAL '30 days')::TIMESTAMPTZ;

  UPDATE medevac_subscriptions
     SET status = 'active',
         start_date = v_start,
         end_date = v_end,
         next_renewal_due = v_renewal,
         updated_at = NOW()
   WHERE id = p_subscription_id;

  INSERT INTO audit_logs (entity_type, entity_id, action, new_value, user_id)
  VALUES (
    'medevac_subscriptions',
    p_subscription_id,
    'subscription_activated',
    jsonb_build_object(
      'subscription_number', v_subscription.subscription_number,
      'plan', v_subscription.plan,
      'start_date', v_start,
      'end_date', v_end,
      'next_renewal_due', v_renewal
    ),
    NULL
  );

  RETURN json_build_object(
    'ok', true,
    'subscription_id', p_subscription_id,
    'subscription_number', v_subscription.subscription_number,
    'start_date', v_start,
    'end_date', v_end,
    'next_renewal_due', v_renewal
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_activate_subscription(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_activate_subscription(UUID)
  TO service_role;


-- =============================================================
-- Migration summary
-- =============================================================
-- Phase 12 PR 2 adds:
--   - 5 NEW SECURITY DEFINER RPCs (§4.4, §4.5 ×2, §4.6, §4.9)
--   - Each RPC: REVOKE PUBLIC, anon, authenticated; GRANT service_role
--   - No table/ENUM/index changes (PR 1 already shipped all of them)
--   - audit_logs writes: PII-redacted per D12 (no patient_name)
--   - Booking shape per D6: source_offer_table='medevac_offers',
--     source_discriminator='medevac', offer_id=NULL, trip_request_id=NULL
--
-- Spec Probe 35-36 (PR 2) verifies the offer → accept → booking
-- chip flow; Probe 38 verifies the J5 covered path (which routes
-- via §4.7 consume_aeris_shield_event, NOT this PR's RPCs).
-- =============================================================
