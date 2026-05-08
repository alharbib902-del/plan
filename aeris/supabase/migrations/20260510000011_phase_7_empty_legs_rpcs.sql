-- ============================================================
-- Phase 7 — Empty Legs (PR 2a SECURITY DEFINER RPC layer)
--
-- 11 public functions + 1 internal helper + 1 no-op stub
-- (`publish_empty_leg_event`, body shipped in PR 2e). All
-- public functions: SECURITY DEFINER + service-role-only
-- EXECUTE + structured-error contract on every validation
-- failure (no raises). The helper is REVOKEd from every role
-- including service_role — callable only from inside the
-- public functions, which run as the function-owner role.
--
-- Mirrors Phase 6.2 PR 2a's `_recompute_booking_totals`
-- pattern exactly. Lock order is consistent across all
-- mutation RPCs: lock the leg row first, validate, mutate,
-- recompute, return.
--
-- This file ships in PR 2a alongside `types/database.ts`
-- extensions (Args/Result types for the 11 publics) +
-- `lib/empty-legs/types.ts` re-exports + an extended
-- parity test that exercises the SQL formula against the
-- TS port at the same fixed sample points used by the
-- Layer-1 test in PR 1. RPC bodies for `expire_empty_leg_window`
-- + the real `publish_empty_leg_event` body land in PR 2e's
-- migration `20260511000012_phase_7_empty_legs_match_event.sql`.
--
-- Founder Probes 5, 6, 7 verify RPC grants + parity +
-- release/admin-release/manual-sold smoke after this PR
-- ships.
-- ============================================================


-- ============================================================
-- 1. _recompute_empty_leg_price — internal helper
--
-- REVOKEd from every role including service_role. Callable
-- only from inside the 11 public functions below (they run
-- as the function-owner role).
--
-- Caller MUST hold a row lock on empty_legs(p_leg_id) before
-- calling. The helper performs no validation — it assumes
-- the row is locked and the caller has already decided that
-- a recompute is appropriate.
--
-- Body:
--   1. SELECT auction_initial_discount_pct,
--      auction_floor_discount_pct, auction_curve,
--      auction_window_start_at, auction_window_end_at,
--      original_price, status from empty_legs(p_leg_id).
--   2. If status <> 'available', return early (no price
--      changes on reserved/sold/expired/cancelled rows).
--   3. If NOW() <= auction_window_start_at, leave price
--      untouched (auction hasn't opened).
--   4. If NOW() >= auction_window_end_at, set
--      current_discount_pct = auction_floor_discount_pct;
--      current_price = original_price * (1 - floor/100);
--      UPDATE.
--   5. Otherwise compute elapsed in [0, 1] and apply the
--      Dutch-auction formula per `auction_curve`. UPDATE
--      `last_price_drop_at = NOW()` only if the new pct
--      strictly exceeds the old pct (skip the timestamp
--      update on no-op ticks so the audit-log trigger
--      doesn't fire trivially).
-- ============================================================

CREATE OR REPLACE FUNCTION _recompute_empty_leg_price(
  p_leg_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now            TIMESTAMPTZ := NOW();
  v_initial        DECIMAL(4,2);
  v_floor          DECIMAL(4,2);
  v_curve          VARCHAR(20);
  v_start          TIMESTAMPTZ;
  v_end            TIMESTAMPTZ;
  v_original       DECIMAL(12,2);
  v_status         empty_leg_status;
  v_elapsed        NUMERIC;
  v_remaining      NUMERIC;
  v_new_pct        DECIMAL(4,2);
  v_old_pct        DECIMAL(4,2);
  v_new_price      DECIMAL(12,2);
BEGIN
  SELECT auction_initial_discount_pct,
         auction_floor_discount_pct,
         auction_curve,
         auction_window_start_at,
         auction_window_end_at,
         original_price,
         status,
         current_discount_pct
    INTO v_initial, v_floor, v_curve,
         v_start, v_end, v_original, v_status, v_old_pct
    FROM empty_legs
    WHERE id = p_leg_id;

  IF v_status <> 'available' THEN
    RETURN;
  END IF;

  IF v_now <= v_start THEN
    RETURN;
  END IF;

  IF v_now >= v_end THEN
    v_new_pct := v_floor;
  ELSE
    -- elapsed in [0, 1]
    v_elapsed := EXTRACT(EPOCH FROM (v_now - v_start))
               / NULLIF(EXTRACT(EPOCH FROM (v_end - v_start)), 0);
    IF v_elapsed IS NULL THEN
      v_elapsed := 1;
    END IF;
    IF v_elapsed < 0 THEN v_elapsed := 0; END IF;
    IF v_elapsed > 1 THEN v_elapsed := 1; END IF;

    IF v_curve = 'linear' THEN
      v_new_pct := v_initial + (v_floor - v_initial) * v_elapsed;
    ELSE
      -- 'accelerating' (default; CHECK constraint enforces
      -- the 2-value enum).
      -- pct = floor + (initial − floor) × (1 − elapsed)^2
      v_remaining := 1 - v_elapsed;
      v_new_pct := v_floor + (v_initial - v_floor) * v_remaining * v_remaining;
    END IF;
  END IF;

  v_new_price := ROUND(v_original * (1 - v_new_pct / 100), 2);

  UPDATE empty_legs
    SET current_discount_pct = v_new_pct,
        current_price = v_new_price,
        last_price_drop_at = CASE
          WHEN v_new_pct > v_old_pct THEN v_now
          ELSE last_price_drop_at
        END
    WHERE id = p_leg_id;
END;
$$;

REVOKE ALL ON FUNCTION _recompute_empty_leg_price(UUID)
  FROM PUBLIC, anon, authenticated, service_role;


-- ============================================================
-- 2. publish_empty_leg — admin OR operator publishes
--
-- Validates inputs (route presence, window order, price > 0,
-- max_passengers in [1,19], discount initial < floor,
-- auction window end > NOW()) and INSERTs an empty_legs row
-- with status = 'available', current_discount_pct =
-- auction_initial_discount_pct, current_price computed from
-- the discount.
--
-- After INSERT, fires `publish_empty_leg_event(leg_id,
-- 'published')` — which is a no-op stub in PR 2a. PR 2e
-- replaces the body with the real outbox-write logic.
-- ============================================================

CREATE OR REPLACE FUNCTION publish_empty_leg(
  p_operator_id                  UUID,
  p_operator_stub_id             UUID,
  p_operator_name                TEXT,
  p_operator_phone               TEXT,
  p_operator_email               TEXT,
  p_aircraft_id                  UUID,
  p_aircraft_text                TEXT,
  p_parent_booking_id            UUID,
  p_departure_airport_iata       TEXT,
  p_departure_airport_freeform   TEXT,
  p_arrival_airport_iata         TEXT,
  p_arrival_airport_freeform     TEXT,
  p_departure_window_start       TIMESTAMPTZ,
  p_departure_window_end         TIMESTAMPTZ,
  p_flexibility_hours            INT,
  p_original_price               DECIMAL(12,2),
  p_max_passengers               INT,
  p_auction_initial_discount_pct DECIMAL(4,2),
  p_auction_floor_discount_pct   DECIMAL(4,2),
  p_auction_curve                TEXT,
  p_auction_window_lead_hours    INT,
  p_suppress_notifications       BOOLEAN
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now              TIMESTAMPTZ := NOW();
  v_window_end_at    TIMESTAMPTZ;
  v_initial          DECIMAL(4,2);
  v_floor            DECIMAL(4,2);
  v_curve            TEXT;
  v_lead_hours       INT;
  v_flex_hours       INT;
  v_initial_price    DECIMAL(12,2);
  v_leg_id           UUID;
  v_leg_number       VARCHAR(20);
BEGIN
  -- Default values for optional inputs.
  v_initial    := COALESCE(p_auction_initial_discount_pct, 40);
  v_floor      := COALESCE(p_auction_floor_discount_pct, 70);
  v_curve      := COALESCE(p_auction_curve, 'accelerating');
  v_lead_hours := COALESCE(p_auction_window_lead_hours, 6);
  v_flex_hours := COALESCE(p_flexibility_hours, 3);

  -- Route presence.
  IF NULLIF(TRIM(p_departure_airport_iata), '') IS NULL
     AND NULLIF(TRIM(p_departure_airport_freeform), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'departure_route_missing');
  END IF;

  IF NULLIF(TRIM(p_arrival_airport_iata), '') IS NULL
     AND NULLIF(TRIM(p_arrival_airport_freeform), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'arrival_route_missing');
  END IF;

  -- Validate non-empty IATA codes against airports(iata_code)
  -- BEFORE the INSERT. Without this, a non-empty but unknown
  -- IATA value would surface as a raw PostgreSQL FK violation
  -- instead of the structured RPC error contract (Codex
  -- round-1 P1 #2 fix).
  IF NULLIF(TRIM(p_departure_airport_iata), '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM airports
         WHERE iata_code = TRIM(p_departure_airport_iata)
     ) THEN
    RETURN json_build_object('ok', false, 'error', 'departure_airport_unknown');
  END IF;

  IF NULLIF(TRIM(p_arrival_airport_iata), '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM airports
         WHERE iata_code = TRIM(p_arrival_airport_iata)
     ) THEN
    RETURN json_build_object('ok', false, 'error', 'arrival_airport_unknown');
  END IF;

  -- Window order.
  IF p_departure_window_end <= p_departure_window_start THEN
    RETURN json_build_object('ok', false, 'error', 'departure_window_invalid');
  END IF;

  -- Price + capacity.
  IF p_original_price IS NULL OR p_original_price <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'original_price_invalid');
  END IF;

  IF p_max_passengers IS NULL OR p_max_passengers < 1 OR p_max_passengers > 19 THEN
    RETURN json_build_object('ok', false, 'error', 'max_passengers_invalid');
  END IF;

  -- Discount bounds.
  IF v_initial < 10 OR v_initial > 50 THEN
    RETURN json_build_object('ok', false, 'error', 'auction_initial_discount_out_of_range');
  END IF;

  IF v_floor < 50 OR v_floor > 90 THEN
    RETURN json_build_object('ok', false, 'error', 'auction_floor_discount_out_of_range');
  END IF;

  -- Reject equality too (Codex round-1 P2 #1 fix). Phase 7
  -- contract requires a strictly increasing Dutch-auction
  -- range; equality produces a no-op curve. The PR 1
  -- schema CHECK uses `>=` (defense in depth, permissive);
  -- the RPC validation is stricter so the structured-error
  -- contract surfaces this case before the INSERT runs.
  IF v_floor <= v_initial THEN
    RETURN json_build_object('ok', false, 'error', 'auction_floor_below_initial');
  END IF;

  -- Curve enum.
  IF v_curve NOT IN ('linear', 'accelerating') THEN
    RETURN json_build_object('ok', false, 'error', 'auction_curve_invalid');
  END IF;

  -- Compute auction_window_end_at = departure_window_start - lead_hours.
  v_window_end_at := p_departure_window_start - make_interval(hours => v_lead_hours);

  -- Auction window must close after NOW().
  IF v_window_end_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'auction_window_already_closed');
  END IF;

  -- Initial price = original × (1 − initial/100).
  v_initial_price := ROUND(p_original_price * (1 - v_initial / 100), 2);

  -- INSERT.
  INSERT INTO empty_legs (
    parent_booking_id, operator_id, operator_stub_id,
    operator_name_snapshot, operator_phone_snapshot,
    operator_email_snapshot,
    aircraft_id, aircraft_snapshot,
    departure_airport, departure_airport_freeform_snapshot,
    arrival_airport, arrival_airport_freeform_snapshot,
    departure_window_start, departure_window_end,
    flexibility_hours,
    original_price, current_discount_pct, current_price,
    max_passengers, status,
    auction_initial_discount_pct,
    auction_floor_discount_pct,
    auction_curve,
    auction_window_start_at,
    auction_window_end_at,
    suppress_notifications
  ) VALUES (
    p_parent_booking_id, p_operator_id, p_operator_stub_id,
    NULLIF(TRIM(p_operator_name), ''),
    NULLIF(TRIM(p_operator_phone), ''),
    NULLIF(TRIM(p_operator_email), ''),
    p_aircraft_id,
    NULLIF(TRIM(p_aircraft_text), ''),
    NULLIF(TRIM(p_departure_airport_iata), ''),
    NULLIF(TRIM(p_departure_airport_freeform), ''),
    NULLIF(TRIM(p_arrival_airport_iata), ''),
    NULLIF(TRIM(p_arrival_airport_freeform), ''),
    p_departure_window_start, p_departure_window_end,
    v_flex_hours,
    p_original_price, v_initial, v_initial_price,
    p_max_passengers, 'available',
    v_initial, v_floor, v_curve,
    v_now, v_window_end_at,
    COALESCE(p_suppress_notifications, false)
  )
  RETURNING id, leg_number INTO v_leg_id, v_leg_number;

  -- Defensive recompute (no-op at insert time but symmetric
  -- with the rest of the family).
  PERFORM _recompute_empty_leg_price(v_leg_id);

  -- Fire publish event hook (stub in PR 2a; PR 2e replaces).
  PERFORM publish_empty_leg_event(v_leg_id, 'published');

  RETURN json_build_object(
    'ok', true,
    'leg_id', v_leg_id,
    'leg_number', v_leg_number,
    'current_price', v_initial_price
  );
END;
$$;

REVOKE ALL ON FUNCTION publish_empty_leg(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID,
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  INT, DECIMAL, INT, DECIMAL, DECIMAL, TEXT, INT, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION publish_empty_leg(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID,
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  INT, DECIMAL, INT, DECIMAL, DECIMAL, TEXT, INT, BOOLEAN
) TO service_role;


-- ============================================================
-- 3. update_empty_leg_price — admin/operator manual reprice
--
-- Validates new_price is between original × (1 − floor/100)
-- and original_price (no markup, no over-discount). Flips
-- `current_price` to p_new_price, recomputes
-- `current_discount_pct` from p_new_price against
-- `original_price`, sets `last_price_drop_at = NOW()` if
-- the new price is strictly less than the old. Fires
-- `publish_empty_leg_event(leg_id, 'price_dropped')` only
-- on price decrease.
-- ============================================================

CREATE OR REPLACE FUNCTION update_empty_leg_price(
  p_leg_id    UUID,
  p_new_price DECIMAL(12,2)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now          TIMESTAMPTZ := NOW();
  v_status       empty_leg_status;
  v_original     DECIMAL(12,2);
  v_floor        DECIMAL(4,2);
  v_old_price    DECIMAL(12,2);
  v_min_price    DECIMAL(12,2);
  v_new_pct      DECIMAL(4,2);
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, original_price, auction_floor_discount_pct, current_price
    INTO v_status, v_original, v_floor, v_old_price
    FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'available' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_available');
  END IF;

  IF p_new_price IS NULL OR p_new_price <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'new_price_invalid');
  END IF;

  IF p_new_price > v_original THEN
    RETURN json_build_object('ok', false, 'error', 'new_price_above_original');
  END IF;

  v_min_price := ROUND(v_original * (1 - v_floor / 100), 2);
  IF p_new_price < v_min_price THEN
    RETURN json_build_object('ok', false, 'error', 'new_price_below_floor');
  END IF;

  -- discount % from the new price.
  v_new_pct := ROUND((1 - p_new_price / v_original) * 100, 2);

  UPDATE empty_legs
    SET current_price = p_new_price,
        current_discount_pct = v_new_pct,
        last_price_drop_at = CASE
          WHEN p_new_price < v_old_price THEN v_now
          ELSE last_price_drop_at
        END
    WHERE id = p_leg_id;

  IF p_new_price < v_old_price THEN
    PERFORM publish_empty_leg_event(p_leg_id, 'price_dropped');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'current_price', p_new_price,
    'current_discount_pct', v_new_pct,
    'fired_event', p_new_price < v_old_price
  );
END;
$$;

REVOKE ALL ON FUNCTION update_empty_leg_price(UUID, DECIMAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_empty_leg_price(UUID, DECIMAL)
  TO service_role;


-- ============================================================
-- 4. reserve_empty_leg — public reserve (10-minute hold)
--
-- Called by the public marketplace's reserve Server Action
-- after the customer fills the form. The reservation token
-- itself is HMAC-signed and minted application-side
-- (`lib/empty-legs/reservation-token.ts`); the RPC receives
-- only the sha256 hash + expiry. Mirror Phase 6.2's
-- `bookings.checkout_token_hash` pattern (DB never sees the
-- raw token).
-- ============================================================

CREATE OR REPLACE FUNCTION reserve_empty_leg(
  p_leg_id          UUID,
  p_token_hash      VARCHAR(64),
  p_expires_at      TIMESTAMPTZ,
  p_customer_name   VARCHAR(120),
  p_customer_phone  VARCHAR(20)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now           TIMESTAMPTZ := NOW();
  v_status        empty_leg_status;
  v_window_end    TIMESTAMPTZ;
  v_dep_window    TIMESTAMPTZ;
  v_max_expiry    TIMESTAMPTZ;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, auction_window_end_at, departure_window_start
    INTO v_status, v_window_end, v_dep_window
    FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'available' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_available');
  END IF;

  IF v_window_end IS NOT NULL AND v_window_end <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'leg_window_closed');
  END IF;

  IF p_token_hash IS NULL OR LENGTH(p_token_hash) < 16 THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_token_invalid');
  END IF;

  -- Bound the reservation hold to the spec-mandated 10-minute
  -- window AND ensure it does not stretch past the leg's
  -- departure_window_start (Codex round-1 P2 #2 fix). Without
  -- this, a buggy or crafted Server Action call could reserve
  -- an empty leg for hours/days, blocking availability past
  -- the intended hold. The Server Action mints tokens with
  -- a 10-minute TTL, so the bounded ceiling here is defense
  -- in depth at the DB layer.
  v_max_expiry := LEAST(v_now + INTERVAL '10 minutes', v_dep_window);
  IF p_expires_at IS NULL OR p_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_expiry_invalid');
  END IF;
  IF p_expires_at > v_max_expiry THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_expiry_too_far');
  END IF;

  IF NULLIF(TRIM(p_customer_name), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_name_missing');
  END IF;

  IF NULLIF(TRIM(p_customer_phone), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_phone_missing');
  END IF;

  UPDATE empty_legs
    SET status = 'reserved',
        reservation_token_hash = p_token_hash,
        reservation_expires_at = p_expires_at,
        reservation_customer_name_snapshot = TRIM(p_customer_name),
        reservation_customer_phone_snapshot = TRIM(p_customer_phone)
    WHERE id = p_leg_id;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'reservation_expires_at', p_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION reserve_empty_leg(
  UUID, VARCHAR, TIMESTAMPTZ, VARCHAR, VARCHAR
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_empty_leg(
  UUID, VARCHAR, TIMESTAMPTZ, VARCHAR, VARCHAR
) TO service_role;


-- ============================================================
-- 5. confirm_empty_leg_reservation — admin confirms
--
-- Called by admin after the WhatsApp coordination call
-- confirms the reservation. INSERTs a `bookings` row using
-- the snapshot fields from the leg + reservation, flips the
-- leg to `'sold'`, populates `customer_booking_id`. The
-- bookings INSERT mirrors `accept_offer`'s step 9 column
-- shape exactly so the Phase 6.2 admin add-ons surface
-- reads the new booking transparently.
-- ============================================================

CREATE OR REPLACE FUNCTION confirm_empty_leg_reservation(
  p_leg_id     UUID,
  p_token_hash VARCHAR(64)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now             TIMESTAMPTZ := NOW();
  v_leg             empty_legs%ROWTYPE;
  v_booking_id      UUID;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT * INTO v_leg FROM empty_legs WHERE id = p_leg_id;

  IF v_leg.status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  IF v_leg.reservation_expires_at IS NOT NULL
     AND v_leg.reservation_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_expired');
  END IF;

  -- NULL-safe compare (Codex round-1 P1 #1 fix). SQL
  -- `column <> NULL` evaluates to NULL, not TRUE/FALSE, so
  -- a `p_token_hash = NULL` payload would silently pass an
  -- `OR <>` check. `IS DISTINCT FROM` treats NULL on either
  -- side as "differs", which is what we want here. Defense
  -- in depth: also reject NULL `p_token_hash` explicitly.
  IF p_token_hash IS NULL
     OR v_leg.reservation_token_hash IS DISTINCT FROM p_token_hash THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_token_mismatch');
  END IF;

  -- Defensive: reservation snapshot fields must be present.
  IF v_leg.reservation_customer_name_snapshot IS NULL
     OR v_leg.reservation_customer_phone_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_state_invalid');
  END IF;

  -- Route presence guard (defense in depth — schema CHECK
  -- enforces this on insert, but the booking insert below
  -- needs at least one populated route per side).
  IF v_leg.departure_airport IS NULL
     AND v_leg.departure_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_origin_missing');
  END IF;

  IF v_leg.arrival_airport IS NULL
     AND v_leg.arrival_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_destination_missing');
  END IF;

  -- INSERT the bookings row. Column shape mirrors
  -- accept_offer's step 9 exactly.
  INSERT INTO bookings (
    offer_id,
    trip_request_id,
    route_origin_iata,
    route_destination_iata,
    route_origin_freeform_snapshot,
    route_destination_freeform_snapshot,
    passengers_count_snapshot,
    return_scheduled,
    source_offer_table,
    source_offer_id,
    client_id,
    customer_name_snapshot,
    customer_phone_snapshot,
    operator_id,
    operator_name_snapshot,
    operator_phone_snapshot,
    operator_email_snapshot,
    aircraft_id,
    aircraft_snapshot,
    base_amount,
    addons_amount,
    vat_amount,
    total_amount,
    commission_amount,
    operator_payout,
    payment_status,
    flight_status,
    departure_scheduled,
    checkout_token_hash,
    checkout_token_expires_at
  ) VALUES (
    NULL,                                              -- offer_id
    NULL,                                              -- trip_request_id (Empty Legs are not customer-asked trips)
    v_leg.departure_airport,                           -- route_origin_iata
    v_leg.arrival_airport,                             -- route_destination_iata
    v_leg.departure_airport_freeform_snapshot,         -- route_origin_freeform_snapshot
    v_leg.arrival_airport_freeform_snapshot,           -- route_destination_freeform_snapshot
    v_leg.max_passengers,                              -- passengers_count_snapshot (Empty Legs treat max as booked count; trip-edit flow is out of scope)
    NULL,                                              -- return_scheduled (Empty Legs are one-way)
    'phase7_empty_leg',                                -- source_offer_table
    v_leg.id,                                          -- source_offer_id (re-uses leg id as discriminator target)
    NULL,                                              -- client_id (guest)
    v_leg.reservation_customer_name_snapshot,
    v_leg.reservation_customer_phone_snapshot,
    v_leg.operator_id,                                 -- may be NULL
    v_leg.operator_name_snapshot,
    v_leg.operator_phone_snapshot,
    v_leg.operator_email_snapshot,
    v_leg.aircraft_id,                                 -- may be NULL
    v_leg.aircraft_snapshot,
    v_leg.current_price,                               -- base_amount
    0,                                                 -- addons_amount
    NULL,                                              -- vat_amount (Phase 11)
    v_leg.current_price,                               -- total_amount
    NULL,                                              -- commission_amount (Phase 11)
    NULL,                                              -- operator_payout (Phase 11)
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_leg.departure_window_start,                      -- departure_scheduled
    NULL,                                              -- checkout_token_hash
    NULL                                               -- checkout_token_expires_at
  )
  RETURNING id INTO v_booking_id;

  -- Flip the leg to 'sold' + clear reservation columns.
  UPDATE empty_legs
    SET status = 'sold',
        customer_booking_id = v_booking_id,
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL
    WHERE id = p_leg_id;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'booking_id', v_booking_id
  );
END;
$$;

REVOKE ALL ON FUNCTION confirm_empty_leg_reservation(UUID, VARCHAR)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_empty_leg_reservation(UUID, VARCHAR)
  TO service_role;


-- ============================================================
-- 6. release_empty_leg_reservation — customer releases hold
--
-- Token-bound release of an active customer hold. Validates
-- the reservation token's hash matches the row's
-- `reservation_token_hash` and clears only the reservation
-- fields — the leg returns to `'available'` and remains
-- marketable. Distinct from `expire_empty_leg_reservation`
-- (cron, expired holds) and `cancel_empty_leg` (admin/
-- operator terminal cancel of the leg itself).
-- ============================================================

CREATE OR REPLACE FUNCTION release_empty_leg_reservation(
  p_leg_id     UUID,
  p_token_hash VARCHAR(64)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   empty_leg_status;
  v_hash     VARCHAR(64);
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, reservation_token_hash INTO v_status, v_hash
    FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  -- NULL-safe compare (Codex round-1 P1 #1 fix). See
  -- §5 confirm_empty_leg_reservation for rationale.
  IF p_token_hash IS NULL
     OR v_hash IS DISTINCT FROM p_token_hash THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_token_mismatch');
  END IF;

  UPDATE empty_legs
    SET status = 'available',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL
    WHERE id = p_leg_id;

  -- The leg may have missed Dutch-auction ticks while held;
  -- snap current_price back onto the curve at NOW().
  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION release_empty_leg_reservation(UUID, VARCHAR)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_empty_leg_reservation(UUID, VARCHAR)
  TO service_role;


-- ============================================================
-- 7. admin_release_empty_leg_reservation — admin force-release
--
-- Codex iteration-3 P1 #2 fix. Admin counterpart to §6 — same
-- effect (clear reservation, flip back to 'available'), but
-- without the token-hash check. The PR 2b admin Case-2
-- "إلغاء التحفظ" button calls this RPC. `expire_empty_leg_reservation`
-- (§9) is reserved for cron-expired holds only.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_release_empty_leg_reservation(
  p_leg_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status empty_leg_status;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status INTO v_status FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  UPDATE empty_legs
    SET status = 'available',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL
    WHERE id = p_leg_id;

  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION admin_release_empty_leg_reservation(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_release_empty_leg_reservation(UUID)
  TO service_role;


-- ============================================================
-- 8. cancel_empty_leg — admin/operator terminal cancel
--
-- Allowed when status ∈ ('available', 'reserved'). Rejected
-- on 'sold' (admin uses a separate booking-cancellation flow,
-- not in Phase 7) or already 'cancelled' / 'expired' with
-- `leg_terminal`. Writes a row to `audit_logs` with the
-- caller's reason text (the AFTER UPDATE audit trigger from
-- PR 1 §10 catches the status flip automatically; this
-- explicit insert appends the reason).
-- ============================================================

CREATE OR REPLACE FUNCTION cancel_empty_leg(
  p_leg_id UUID,
  p_reason TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status empty_leg_status;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status INTO v_status FROM empty_legs WHERE id = p_leg_id;

  IF v_status NOT IN ('available', 'reserved') THEN
    RETURN json_build_object('ok', false,
      'error', CASE v_status
                 WHEN 'sold' THEN 'leg_sold_use_booking_flow'
                 ELSE 'leg_terminal'
               END);
  END IF;

  UPDATE empty_legs
    SET status = 'cancelled',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL
    WHERE id = p_leg_id;

  -- Append the reason to audit_logs. The PR 1 §10 audit
  -- trigger logs the status flip with old/new row jsonb;
  -- this explicit insert adds the structured reason text.
  INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
    VALUES (
      'empty_legs', p_leg_id, 'cancel',
      jsonb_build_object('reason', NULLIF(TRIM(p_reason), ''))
    );

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION cancel_empty_leg(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_empty_leg(UUID, TEXT)
  TO service_role;


-- ============================================================
-- 9. expire_empty_leg_reservation — cron-callable ONLY
--
-- Called by the Vercel Cron route every 5 minutes for any
-- leg whose status = 'reserved' AND
-- `reservation_expires_at <= NOW()`. Cron-only path —
-- returns no-op when `reservation_expires_at > NOW()`, so
-- Phase 7 admin UI does NOT call this directly (uses §7
-- `admin_release_empty_leg_reservation` instead).
-- ============================================================

CREATE OR REPLACE FUNCTION expire_empty_leg_reservation(
  p_leg_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now             TIMESTAMPTZ := NOW();
  v_status          empty_leg_status;
  v_expires_at      TIMESTAMPTZ;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, reservation_expires_at
    INTO v_status, v_expires_at
    FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  IF v_expires_at IS NULL OR v_expires_at > v_now THEN
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  UPDATE empty_legs
    SET status = 'available',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL
    WHERE id = p_leg_id;

  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION expire_empty_leg_reservation(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_empty_leg_reservation(UUID)
  TO service_role;


-- ============================================================
-- 10. tick_empty_leg_dutch_auction — cron-callable
--
-- Idempotent: re-running on the same minute returns no-op.
-- Captures `current_discount_pct` BEFORE recompute; calls
-- `_recompute_empty_leg_price`; re-reads AFTER. If the new
-- pct strictly exceeds the captured pct, fires
-- `publish_empty_leg_event(leg_id, 'price_dropped')` —
-- otherwise no event fires.
-- ============================================================

CREATE OR REPLACE FUNCTION tick_empty_leg_dutch_auction(
  p_leg_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   empty_leg_status;
  v_old_pct  DECIMAL(4,2);
  v_new_pct  DECIMAL(4,2);
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, current_discount_pct
    INTO v_status, v_old_pct
    FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'available' THEN
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  PERFORM _recompute_empty_leg_price(p_leg_id);

  SELECT current_discount_pct INTO v_new_pct
    FROM empty_legs WHERE id = p_leg_id;

  IF v_new_pct > v_old_pct THEN
    PERFORM publish_empty_leg_event(p_leg_id, 'price_dropped');
    RETURN json_build_object(
      'ok', true,
      'leg_id', p_leg_id,
      'old_pct', v_old_pct,
      'new_pct', v_new_pct,
      'fired_event', true
    );
  END IF;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'old_pct', v_old_pct,
    'new_pct', v_new_pct,
    'fired_event', false
  );
END;
$$;

REVOKE ALL ON FUNCTION tick_empty_leg_dutch_auction(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION tick_empty_leg_dutch_auction(UUID)
  TO service_role;


-- ============================================================
-- 11. admin_mark_empty_leg_sold — single-RPC manual sold path
--
-- Codex iteration-1 P1 #4 fix. Admin path bypasses the
-- reservation state entirely (founder collects verbal commit
-- over WhatsApp before invoking, so no hold layer needed).
-- INSERTs the bookings row + flips the leg to 'sold' + writes
-- customer_booking_id atomically — single transaction, single
-- rpc() call from the Server Action.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_mark_empty_leg_sold(
  p_leg_id         UUID,
  p_customer_name  TEXT,
  p_customer_phone TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now            TIMESTAMPTZ := NOW();
  v_leg            empty_legs%ROWTYPE;
  v_booking_id     UUID;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT * INTO v_leg FROM empty_legs WHERE id = p_leg_id;

  IF v_leg.status <> 'available' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_available');
  END IF;

  IF v_leg.auction_window_end_at IS NOT NULL
     AND v_leg.auction_window_end_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'leg_window_closed');
  END IF;

  IF NULLIF(TRIM(p_customer_name), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_name_missing');
  END IF;

  IF NULLIF(TRIM(p_customer_phone), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_phone_missing');
  END IF;

  -- Defensive route presence (mirrors §5 confirm).
  IF v_leg.departure_airport IS NULL
     AND v_leg.departure_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_origin_missing');
  END IF;

  IF v_leg.arrival_airport IS NULL
     AND v_leg.arrival_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_destination_missing');
  END IF;

  -- INSERT the bookings row using the EXACT same column list +
  -- value expressions as confirm_empty_leg_reservation's step.
  -- Both functions stay in lockstep; if one changes, the other
  -- changes in the same migration.
  INSERT INTO bookings (
    offer_id,
    trip_request_id,
    route_origin_iata,
    route_destination_iata,
    route_origin_freeform_snapshot,
    route_destination_freeform_snapshot,
    passengers_count_snapshot,
    return_scheduled,
    source_offer_table,
    source_offer_id,
    client_id,
    customer_name_snapshot,
    customer_phone_snapshot,
    operator_id,
    operator_name_snapshot,
    operator_phone_snapshot,
    operator_email_snapshot,
    aircraft_id,
    aircraft_snapshot,
    base_amount,
    addons_amount,
    vat_amount,
    total_amount,
    commission_amount,
    operator_payout,
    payment_status,
    flight_status,
    departure_scheduled,
    checkout_token_hash,
    checkout_token_expires_at
  ) VALUES (
    NULL,
    NULL,
    v_leg.departure_airport,
    v_leg.arrival_airport,
    v_leg.departure_airport_freeform_snapshot,
    v_leg.arrival_airport_freeform_snapshot,
    v_leg.max_passengers,
    NULL,
    'phase7_empty_leg',
    v_leg.id,
    NULL,
    TRIM(p_customer_name),
    TRIM(p_customer_phone),
    v_leg.operator_id,
    v_leg.operator_name_snapshot,
    v_leg.operator_phone_snapshot,
    v_leg.operator_email_snapshot,
    v_leg.aircraft_id,
    v_leg.aircraft_snapshot,
    v_leg.current_price,
    0,
    NULL,
    v_leg.current_price,
    NULL,
    NULL,
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_leg.departure_window_start,
    NULL,
    NULL
  )
  RETURNING id INTO v_booking_id;

  UPDATE empty_legs
    SET status = 'sold',
        customer_booking_id = v_booking_id
    WHERE id = p_leg_id;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'booking_id', v_booking_id
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_mark_empty_leg_sold(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_mark_empty_leg_sold(UUID, TEXT, TEXT)
  TO service_role;


-- ============================================================
-- 12. publish_empty_leg_event — empty stub in PR 2a
--
-- PR 2a defines this as a no-op SECURITY DEFINER function so
-- §2 publish_empty_leg + §3 update_empty_leg_price + §10
-- tick_empty_leg_dutch_auction can `PERFORM` it without
-- reaching for a function that does not exist yet. PR 2e's
-- migration `20260511000012_phase_7_empty_legs_match_event.sql`
-- replaces the body with the real outbox-write logic via
-- `CREATE OR REPLACE FUNCTION` — same signature, new body.
-- ============================================================

CREATE OR REPLACE FUNCTION publish_empty_leg_event(
  p_leg_id     UUID,
  p_event_type TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- No-op stub. PR 2e replaces the body with the real
  -- empty_leg_events_outbox INSERT logic. Signature must
  -- stay (UUID, TEXT) RETURNS VOID across the rewrite so
  -- the three callers above continue to compile.
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION publish_empty_leg_event(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION publish_empty_leg_event(UUID, TEXT)
  TO service_role;


-- ============================================================
-- END OF PR 2a MIGRATION
--
-- Post-migration shape (Founder Probes 5, 6, 7 verify):
--   - 11 public functions exist with SECURITY DEFINER +
--     `search_path = public, pg_temp`; service-role-only
--     EXECUTE; structured-error contract on every validation
--     failure (no raises). Names + signatures:
--       1. publish_empty_leg(...)
--       2. update_empty_leg_price(UUID, DECIMAL)
--       3. reserve_empty_leg(UUID, VARCHAR, TIMESTAMPTZ, VARCHAR, VARCHAR)
--       4. confirm_empty_leg_reservation(UUID, VARCHAR)
--       5. release_empty_leg_reservation(UUID, VARCHAR)
--       6. admin_release_empty_leg_reservation(UUID)
--       7. cancel_empty_leg(UUID, TEXT)
--       8. expire_empty_leg_reservation(UUID)
--       9. tick_empty_leg_dutch_auction(UUID)
--       10. admin_mark_empty_leg_sold(UUID, TEXT, TEXT)
--       11. publish_empty_leg_event(UUID, TEXT) — no-op stub
--   - 1 internal helper `_recompute_empty_leg_price(UUID)`
--     REVOKEd from PUBLIC + anon + authenticated +
--     service_role.
--   - All mutation publics call _recompute_empty_leg_price
--     under the leg row lock (defense-in-depth uniformity).
--   - confirm_empty_leg_reservation + admin_mark_empty_leg_sold
--     INSERT bookings rows with `source_offer_table =
--     'phase7_empty_leg'` + `payment_status =
--     'pending_offline'`, mirroring the column shape of
--     accept_offer's step 9. Both stay in lockstep.
--   - PR 2e adds the 12th public `expire_empty_leg_window`
--     in its own migration alongside the real
--     publish_empty_leg_event body.
-- ============================================================
