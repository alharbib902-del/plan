-- ============================================================
-- Phase 6.2 — Priced Add-ons + Booking-shaped Checkout-prep
-- PR 2a: accept_offer body extension + backfill + 5 mutation
-- RPCs + 1 internal helper (single migration file)
-- ============================================================
--
-- Codex iteration-1 P1 #2 originally split this PR off the
-- schema reshape (PR 1) so production Supabase has the new
-- columns before the body that depends on them ships.
-- Iteration-5 P1 expanded this PR to host the four add-on
-- mutation RPCs (consolidating mutation atomicity at the DB
-- layer; PR 2b's Server Actions become thin wrappers).
-- Iteration-6 P1 split the cancel function into
-- customer + admin variants (the customer path rejects
-- 'confirmed' rows; the admin path allows the founder to
-- cancel a customer-confirmed row after a follow-up
-- WhatsApp call).
--
-- All seven public functions:
--   1. accept_offer(p_source, p_offer_id) — body extension
--      per spec S7.3; UNCHANGED signature, CREATE OR REPLACE.
--      Captures offer snapshots inside step 4's lock; INSERTs
--      bookings row at step 9; returns `booking_id` alongside
--      the existing `trip_request_id` + `ok`.
--   2. backfill_booking_from_offer(p_trip_id) — Case C
--      escape valve per S4.1. Counts accepted offers across
--      both Phase 4 + Phase 5 tables (Codex iteration-3 P2
--      #1: fail with `ambiguous_accepted_offer` if > 1; with
--      `no_accepted_offer` if 0). Same INSERT shape as
--      accept_offer.
--   3. attach_booking_addon — admin attach. Catalog read
--      from `addon_catalog` table (no hardcoded CASE; Codex
--      iteration-6 P2 #2 fix). NULL-safe quantity normalize
--      (Codex iteration-7 P1 #1 fix). per_passenger derives
--      quantity from the booking's snapshot (Codex
--      iteration-6 P2 #1 fix). JSONB note normalizes NULL +
--      whitespace-only to `'{}'::jsonb` (Codex iteration-7
--      P2 #1 fix). commission_rate loaded from catalog
--      (Codex iteration-7 P1 #2 fix). Returns the inserted
--      addon row.
--   4. customer_cancel_booking_addon — customer remove path
--      ONLY. Allows ONLY 'pending' → 'cancelled'; rejects
--      'confirmed' / 'cancelled' / 'delivered' with
--      `addon_not_cancellable`. A crafted request reusing a
--      valid token AFTER `confirm_checkout_prep` flipped
--      rows to 'confirmed' cannot cancel a confirmed row.
--   5. admin_cancel_booking_addon — admin path ONLY.
--      Allows BOTH 'pending' AND 'confirmed' →
--      'cancelled'; rejects 'cancelled' / 'delivered' with
--      `addon_already_cancelled` / `addon_terminal`.
--   6. update_booking_addon_quantity — admin quantity
--      adjustment. Rejects per_passenger subtypes with
--      `quantity_locked_by_passenger_count` (the only way
--      to change catering quantity is to cancel + re-attach
--      after the booking's passengers_count_snapshot
--      changes).
--   7. confirm_checkout_prep — customer-side confirm. Flips
--      every 'pending' addon on the booking to 'confirmed'.
--      Idempotent. Does NOT touch payment_status.
--
-- Plus one internal helper (NOT granted to service_role —
-- callable only from inside the seven SECURITY DEFINER
-- functions above):
--
--   8. _recompute_booking_totals(p_booking_id) — canonical
--      recompute body shared by all seven public RPCs.
--      Caller MUST hold a row lock on bookings(p_booking_id)
--      before calling. Sums booking_addons.total_price for
--      rows in ('pending', 'confirmed', 'delivered') →
--      bookings.addons_amount; total_amount = base_amount +
--      addons_amount. Cancelled rows drop OUT of the sum.
--
-- All seven public functions are SECURITY DEFINER +
-- search_path = public, pg_temp + service-role-only EXECUTE.
-- _recompute_booking_totals is REVOKEd from EVERY role
-- including service_role — it is callable only inside the
-- seven public functions, which run as the function-owner
-- role. Service-role-issued direct rpc() returns a
-- permission-denied error (verified by Probe 8c).
-- ============================================================


-- ============================================================
-- 1. _recompute_booking_totals — internal helper
--
-- Defined first so the seven public functions can PERFORM it.
-- ============================================================

CREATE OR REPLACE FUNCTION _recompute_booking_totals(
  p_booking_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE bookings
    SET addons_amount = (
          SELECT COALESCE(SUM(total_price), 0)
            FROM booking_addons
            WHERE booking_id = p_booking_id
              AND status IN ('pending', 'confirmed', 'delivered')
        ),
        total_amount = base_amount + (
          SELECT COALESCE(SUM(total_price), 0)
            FROM booking_addons
            WHERE booking_id = p_booking_id
              AND status IN ('pending', 'confirmed', 'delivered')
        )
    WHERE id = p_booking_id;
END;
$$;

-- REVOKE from EVERY role including service_role. Only the
-- seven SECURITY DEFINER public functions below can call it
-- (they run as the function-owner role, which has implicit
-- access). Direct service-role rpc('_recompute_booking_totals')
-- returns a permission-denied error — Probe 8c verifies.
REVOKE ALL ON FUNCTION _recompute_booking_totals(UUID)
  FROM PUBLIC, anon, authenticated, service_role;


-- ============================================================
-- 2. accept_offer — body extension (spec S7.3)
--
-- UNCHANGED signature: (p_source TEXT, p_offer_id UUID)
-- RETURNS JSON. CREATE OR REPLACE replaces the Phase 5 body
-- in place. The lock order from Phase 5 is preserved
-- exactly: parent trip → chosen offer (in source table) →
-- sibling offers (across both tables) → still-pending Phase 5
-- targets → open dispatch rounds → trip status flip → NEW:
-- bookings INSERT.
--
-- Net additions over Phase 5:
--   - Step 4 captures offer snapshot fields (total_price,
--     aircraft text, operator name/phone/email).
--   - Step 8.5 (NEW) reads the trip row for snapshot fields.
--   - Step 9 (extended) INSERTs the bookings row with
--     payment_status = 'pending_offline' (the default from
--     PR 1 File B), flight_status = 'confirmed', snapshot
--     columns populated from offer + trip, NULL FKs (operator_id,
--     aircraft_id), source-offer discriminator + UUID,
--     addons_amount = 0, total_amount = base_amount, NULL
--     vat/commission/payout (Phase 11 territory), NULL
--     checkout_token_* (founder issues separately). Calls
--     _recompute_booking_totals as defense-in-depth uniformity
--     (the fresh INSERT has zero addons; the recompute is a
--     no-op).
--   - Return shape gains `booking_id` alongside the existing
--     `ok` + `trip_request_id`. Existing callers that only
--     read `ok` / `trip_request_id` continue to work.
-- ============================================================

CREATE OR REPLACE FUNCTION accept_offer(
  p_source TEXT,
  p_offer_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now                  TIMESTAMPTZ := NOW();
  v_trip_id              UUID;
  v_offer_status         offer_status;
  v_offer_expires_at     TIMESTAMPTZ;
  -- Phase 6.2 PR 2a additions: offer + trip snapshots for
  -- the bookings INSERT.
  v_offer_total          DECIMAL(12,2);
  v_offer_aircraft       TEXT;
  v_offer_operator_name  VARCHAR(120);
  v_offer_operator_phone VARCHAR(20);
  v_offer_operator_email VARCHAR(120);
  v_trip                 trip_requests%ROWTYPE;
  v_booking_id           UUID;
BEGIN
  -- Step 1: validate source.
  IF p_source NOT IN ('phase4', 'phase5') THEN
    RETURN json_build_object('ok', false, 'error', 'unknown_source');
  END IF;

  -- Step 2: discover trip_id from the chosen offer (no lock).
  -- trip_request_id on both offer tables is set on INSERT and
  -- never updated, so reading it before the lock is safe.
  IF p_source = 'phase4' THEN
    SELECT trip_request_id INTO v_trip_id
      FROM phase4_operator_offers
      WHERE id = p_offer_id;
  ELSE -- 'phase5'
    SELECT trip_request_id INTO v_trip_id
      FROM phase5_operator_offers
      WHERE id = p_offer_id;
  END IF;

  IF v_trip_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_pending');
  END IF;

  -- Step 3: lock the parent trip first. Spec: trip status MUST
  -- be 'offered'. Anything else (pending, distributed, booked,
  -- cancelled) returns trip_not_open.
  PERFORM 1 FROM trip_requests
    WHERE id = v_trip_id
      AND status = 'offered'
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_open');
  END IF;

  -- Step 4: lock + validate the chosen offer AND capture the
  -- snapshot fields needed for the bookings INSERT below.
  -- Phase 6.2 PR 2a addition: SELECT now reads
  -- total_price_sar + aircraft text + operator contact
  -- alongside status + expires_at. Same source-aware branch
  -- structure as before; one additional column list.
  IF p_source = 'phase4' THEN
    SELECT status, expires_at,
           total_price_sar,
           COALESCE(NULLIF(TRIM(aircraft_type), ''), '')
             || CASE
                  WHEN NULLIF(TRIM(aircraft_registration), '') IS NOT NULL
                  THEN ' (' || aircraft_registration || ')'
                  ELSE ''
                END,
           operator_name, operator_phone, operator_email
      INTO v_offer_status, v_offer_expires_at,
           v_offer_total, v_offer_aircraft,
           v_offer_operator_name,
           v_offer_operator_phone,
           v_offer_operator_email
      FROM phase4_operator_offers
      WHERE id = p_offer_id
      FOR UPDATE;
  ELSE
    SELECT status, expires_at,
           total_price_sar,
           COALESCE(NULLIF(TRIM(aircraft_type), ''), '')
             || CASE
                  WHEN NULLIF(TRIM(aircraft_registration), '') IS NOT NULL
                  THEN ' (' || aircraft_registration || ')'
                  ELSE ''
                END,
           operator_name, operator_phone, operator_email
      INTO v_offer_status, v_offer_expires_at,
           v_offer_total, v_offer_aircraft,
           v_offer_operator_name,
           v_offer_operator_phone,
           v_offer_operator_email
      FROM phase5_operator_offers
      WHERE id = p_offer_id
      FOR UPDATE;
  END IF;

  IF v_offer_status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_pending');
  END IF;

  IF v_offer_expires_at <= v_now THEN
    -- Auto-flip the offer to 'expired' so the UI does not keep
    -- listing it as pending. The Server Action surfaces a
    -- distinct offer_expired Arabic-RTL error.
    IF p_source = 'phase4' THEN
      UPDATE phase4_operator_offers
        SET status = 'expired', decided_at = v_now
        WHERE id = p_offer_id AND status = 'pending';
    ELSE
      UPDATE phase5_operator_offers
        SET status = 'expired', decided_at = v_now
        WHERE id = p_offer_id AND status = 'pending';
    END IF;
    RETURN json_build_object('ok', false, 'error', 'offer_expired');
  END IF;

  -- Step 5: reject every other pending sibling on this trip
  -- across BOTH tables (unchanged from Phase 5).
  UPDATE phase4_operator_offers
    SET status = 'rejected', decided_at = v_now
    WHERE trip_request_id = v_trip_id
      AND status = 'pending'
      AND NOT (p_source = 'phase4' AND id = p_offer_id);

  UPDATE phase5_operator_offers
    SET status = 'rejected', decided_at = v_now
    WHERE trip_request_id = v_trip_id
      AND status = 'pending'
      AND NOT (p_source = 'phase5' AND id = p_offer_id);

  -- Step 6: cancel still-pending Phase 5 targets (unchanged).
  UPDATE trip_dispatch_targets
    SET status = 'cancelled'
    WHERE trip_request_id = v_trip_id
      AND status = 'pending';

  -- Step 7: close open dispatch rounds (unchanged).
  UPDATE trip_dispatch_rounds
    SET status = 'closed',
        closed_at = v_now,
        closed_reason = 'offer_accepted'
    WHERE trip_request_id = v_trip_id
      AND status = 'open';

  -- Step 8: flip the chosen offer to accepted (unchanged).
  IF p_source = 'phase4' THEN
    UPDATE phase4_operator_offers
      SET status = 'accepted', decided_at = v_now
      WHERE id = p_offer_id;
  ELSE
    UPDATE phase5_operator_offers
      SET status = 'accepted', decided_at = v_now
      WHERE id = p_offer_id;
  END IF;

  -- Step 9: book the trip + create the bookings row.
  -- Phase 6.2 PR 2a extends: the UPDATE captures the trip's
  -- client_id, customer_name, customer_phone, departure_date,
  -- return_date, departure_airport, arrival_airport,
  -- passengers_count, legs into v_trip via RETURNING.
  UPDATE trip_requests
    SET status = 'booked'
    WHERE id = v_trip_id
    RETURNING * INTO v_trip;

  INSERT INTO bookings (
    -- Legacy FK → unused `offers` table; leave NULL.
    offer_id,
    -- Direct trip linkage + route/passenger snapshot
    -- (PR 1 File A step 11). BOTH iata + freeform stored
    -- per side so the customer page can render either
    -- shape (Phase 6.0 PR 2 freeform fallback persists in
    -- legs JSONB).
    trip_request_id,
    route_origin_iata,
    route_destination_iata,
    route_origin_freeform_snapshot,
    route_destination_freeform_snapshot,
    passengers_count_snapshot,
    return_scheduled,
    -- Origin discriminator + UUID (PR 1 File A step 7).
    source_offer_table,
    source_offer_id,
    -- Identity: client OR snapshot (per identity check).
    client_id,
    customer_name_snapshot,
    customer_phone_snapshot,
    -- Operator: NULL FK + 3-field snapshot (PR 1 File A step 2).
    operator_id,
    operator_name_snapshot,
    operator_phone_snapshot,
    operator_email_snapshot,
    -- Aircraft: NULL FK + freeform snapshot (PR 1 File A step 3).
    aircraft_id,
    aircraft_snapshot,
    -- Pricing.
    base_amount,
    addons_amount,
    vat_amount,
    total_amount,
    commission_amount,
    operator_payout,
    -- State.
    payment_status,
    flight_status,
    -- Schedule.
    departure_scheduled,
    -- Customer token (issued separately by founder).
    checkout_token_hash,
    checkout_token_expires_at
  ) VALUES (
    NULL,                                              -- offer_id
    v_trip_id,                                         -- trip_request_id (FK)
    v_trip.departure_airport,                          -- route_origin_iata (may be NULL for freeform)
    v_trip.arrival_airport,                            -- route_destination_iata (may be NULL for freeform)
    -- Freeform fallback from the trip's legs JSONB —
    -- always populated since the form layer requires
    -- `from` / `to`. Last leg's `to` is the destination
    -- (covers one-way + round-trip + multi-city).
    NULLIF(TRIM(v_trip.legs->0->>'from'), ''),         -- route_origin_freeform_snapshot
    NULLIF(TRIM(
      v_trip.legs->(jsonb_array_length(v_trip.legs) - 1)->>'to'
    ), ''),                                            -- route_destination_freeform_snapshot
    v_trip.passengers_count,                           -- passengers_count_snapshot
    v_trip.return_date::timestamptz,                   -- return_scheduled (NULL for one-way)
    p_source,                                          -- source_offer_table
    p_offer_id,                                        -- source_offer_id
    v_trip.client_id,                                  -- may be NULL (guest)
    v_trip.customer_name,                              -- snapshot
    v_trip.customer_phone,                             -- snapshot
    NULL,                                              -- operator_id
    v_offer_operator_name,                             -- snapshot
    v_offer_operator_phone,                            -- snapshot
    v_offer_operator_email,                            -- snapshot
    NULL,                                              -- aircraft_id
    NULLIF(TRIM(v_offer_aircraft), ''),                -- snapshot or NULL
    v_offer_total,                                     -- base_amount
    0,                                                 -- addons_amount
    NULL,                                              -- vat_amount
    v_offer_total,                                     -- total_amount
    NULL,                                              -- commission_amount
    NULL,                                              -- operator_payout
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_trip.departure_date,
    NULL,                                              -- checkout_token_hash
    NULL                                               -- checkout_token_expires_at
  )
  RETURNING id INTO v_booking_id;

  -- Defense-in-depth uniformity: every public function calls
  -- _recompute_booking_totals at the end of its mutation. The
  -- fresh INSERT has zero addons so the recompute is a no-op,
  -- but the call is preserved for symmetry with the four
  -- mutation RPCs below.
  PERFORM _recompute_booking_totals(v_booking_id);

  -- Return shape gains booking_id alongside the existing
  -- ok + trip_request_id. Existing callers that read only
  -- ok or trip_request_id continue to work unchanged.
  RETURN json_build_object(
    'ok', true,
    'trip_request_id', v_trip_id,
    'booking_id', v_booking_id
  );
END;
$$;

REVOKE ALL ON FUNCTION accept_offer(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_offer(TEXT, UUID)
  TO service_role;


-- ============================================================
-- 3. backfill_booking_from_offer — Case C escape valve
--
-- Per S4.1: founder calls this for every legacy `'booked'`
-- trip that has no bookings row (probe 5b counted them
-- between PR 1 and PR 2a; the founder runs this once per
-- legacy trip via PR 2b's admin button after PR 2b ships).
--
-- Validates the trip is in 'booked' status and has no
-- existing bookings row, then counts accepted offers across
-- both Phase 4 + Phase 5 tables (Codex iteration-3 P2 #1
-- fix: reject `ambiguous_accepted_offer` when > 1, reject
-- `no_accepted_offer` when 0). On the unique-accepted-
-- offer happy path, INSERTs the bookings row with the
-- exact same column list + value expressions as
-- accept_offer's step 9 — both functions stay in lockstep.
-- The unique partial index `bookings_trip_request_unique`
-- in PR 1 makes the concurrent accept + backfill race
-- naturally safe: one INSERT wins, the other rolls back
-- with a unique violation.
-- ============================================================

CREATE OR REPLACE FUNCTION backfill_booking_from_offer(
  p_trip_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trip                 trip_requests%ROWTYPE;
  v_offer_source         TEXT;
  v_offer_id             UUID;
  v_offer_total          DECIMAL(12,2);
  v_offer_aircraft       TEXT;
  v_offer_operator_name  VARCHAR(120);
  v_offer_operator_phone VARCHAR(20);
  v_offer_operator_email VARCHAR(120);
  v_booking_id           UUID;
  v_accepted_count       INTEGER;
BEGIN
  -- Step 1: lock + validate the trip.
  SELECT * INTO v_trip
    FROM trip_requests
    WHERE id = p_trip_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_found');
  END IF;
  IF v_trip.status <> 'booked' THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_booked');
  END IF;

  -- Step 2: reject if a bookings row already exists for any
  -- of this trip's offers (across both source tables). The
  -- partial unique index on bookings.trip_request_id is the
  -- ultimate guard; this check provides a friendlier error.
  IF EXISTS (
    SELECT 1 FROM bookings
      WHERE trip_request_id = p_trip_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'booking_already_exists');
  END IF;

  -- Step 3: count accepted offers across BOTH tables. Codex
  -- iteration-3 P2 #1 fix: a non-deterministic LIMIT 1
  -- (without ORDER BY) on legacy data with multiple accepted
  -- offers would silently pick a surprising row. Count first;
  -- if != 1, surface a clear error so the founder
  -- investigates before creating the booking.
  SELECT
    (SELECT COUNT(*)::INTEGER FROM phase4_operator_offers
      WHERE trip_request_id = p_trip_id
        AND status = 'accepted')
    +
    (SELECT COUNT(*)::INTEGER FROM phase5_operator_offers
      WHERE trip_request_id = p_trip_id
        AND status = 'accepted')
    INTO v_accepted_count;

  IF v_accepted_count = 0 THEN
    RETURN json_build_object('ok', false,
      'error', 'no_accepted_offer');
  ELSIF v_accepted_count > 1 THEN
    RETURN json_build_object('ok', false,
      'error', 'ambiguous_accepted_offer',
      'accepted_count', v_accepted_count);
  END IF;

  -- Step 4: pull the unique accepted offer. Exactly one of
  -- these SELECTs returns the row; the other is empty. No
  -- ORDER BY needed because the count above guarantees
  -- uniqueness. Composes aircraft_snapshot the same way as
  -- accept_offer's step 4.
  SELECT 'phase5', id, total_price_sar,
         COALESCE(NULLIF(TRIM(aircraft_type), ''), '')
           || CASE
                WHEN NULLIF(TRIM(aircraft_registration), '') IS NOT NULL
                THEN ' (' || aircraft_registration || ')'
                ELSE ''
              END,
         operator_name, operator_phone, operator_email
    INTO v_offer_source, v_offer_id, v_offer_total,
         v_offer_aircraft,
         v_offer_operator_name,
         v_offer_operator_phone,
         v_offer_operator_email
    FROM phase5_operator_offers
    WHERE trip_request_id = p_trip_id
      AND status = 'accepted';

  IF v_offer_source IS NULL THEN
    SELECT 'phase4', id, total_price_sar,
           COALESCE(NULLIF(TRIM(aircraft_type), ''), '')
             || CASE
                  WHEN NULLIF(TRIM(aircraft_registration), '') IS NOT NULL
                  THEN ' (' || aircraft_registration || ')'
                  ELSE ''
                END,
           operator_name, operator_phone, operator_email
      INTO v_offer_source, v_offer_id, v_offer_total,
           v_offer_aircraft,
           v_offer_operator_name,
           v_offer_operator_phone,
           v_offer_operator_email
      FROM phase4_operator_offers
      WHERE trip_request_id = p_trip_id
        AND status = 'accepted';
  END IF;

  -- Step 5: INSERT the bookings row using the EXACT same
  -- column list + value expressions as accept_offer's step 9.
  -- Both functions stay in lockstep; if one changes, the
  -- other changes in the same migration file.
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
    p_trip_id,                                         -- trip_request_id (FK)
    v_trip.departure_airport,                          -- route_origin_iata
    v_trip.arrival_airport,                            -- route_destination_iata
    NULLIF(TRIM(v_trip.legs->0->>'from'), ''),         -- route_origin_freeform_snapshot
    NULLIF(TRIM(
      v_trip.legs->(jsonb_array_length(v_trip.legs) - 1)->>'to'
    ), ''),                                            -- route_destination_freeform_snapshot
    v_trip.passengers_count,
    v_trip.return_date::timestamptz,
    v_offer_source,                                    -- source_offer_table
    v_offer_id,                                        -- source_offer_id
    v_trip.client_id,
    v_trip.customer_name,
    v_trip.customer_phone,
    NULL,                                              -- operator_id
    v_offer_operator_name,
    v_offer_operator_phone,
    v_offer_operator_email,
    NULL,                                              -- aircraft_id
    NULLIF(TRIM(v_offer_aircraft), ''),
    v_offer_total,                                     -- base_amount
    0,                                                 -- addons_amount
    NULL,                                              -- vat_amount
    v_offer_total,                                     -- total_amount
    NULL,                                              -- commission_amount
    NULL,                                              -- operator_payout
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_trip.departure_date,
    NULL,                                              -- checkout_token_hash
    NULL                                               -- checkout_token_expires_at
  )
  RETURNING id INTO v_booking_id;

  PERFORM _recompute_booking_totals(v_booking_id);

  RETURN json_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'source', v_offer_source
  );
END;
$$;

REVOKE ALL ON FUNCTION backfill_booking_from_offer(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION backfill_booking_from_offer(UUID)
  TO service_role;


-- ============================================================
-- 4. attach_booking_addon — admin attach
--
-- Locks the bookings row by trip_request_id; reads catalog
-- from `addon_catalog` (no hardcoded CASE — Codex
-- iteration-6 P2 #2 fix); commission_rate_pct included
-- (Codex iteration-7 P1 #2 fix); price-override range
-- check; per_passenger derives quantity from the booking's
-- snapshot (Codex iteration-6 P2 #1 fix); NULL-safe
-- quantity normalize via COALESCE BEFORE any IF (Codex
-- iteration-7 P1 #1 fix); JSONB note normalizes NULL +
-- whitespace-only to '{}'::jsonb (Codex iteration-7 P2 #1
-- fix). All atomic via SECURITY DEFINER transaction.
-- ============================================================

CREATE OR REPLACE FUNCTION attach_booking_addon(
  p_trip_id              UUID,
  p_addon_subtype        TEXT,
  p_quantity             INT,
  p_unit_price_override  DECIMAL(10,2),
  p_note                 TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking            bookings%ROWTYPE;
  v_addon_type         addon_type;
  v_default_price      DECIMAL(10,2);
  v_min_price          DECIMAL(10,2);
  v_max_price          DECIMAL(10,2);
  v_per_passenger      BOOLEAN;
  v_allow_quantity     BOOLEAN;
  v_free               BOOLEAN;
  v_commission_rate    DECIMAL(4,2);
  v_effective_price    DECIMAL(10,2);
  v_requested_quantity INTEGER;
  v_effective_quantity INTEGER;
  v_total_price        DECIMAL(10,2);
  v_new_addon          booking_addons%ROWTYPE;
BEGIN
  -- Lock bookings row for the trip; no row = structured
  -- "no booking yet" error (Case A pre-accept or Case C
  -- legacy — PR 2b admin UI shows these states differently).
  SELECT * INTO v_booking
    FROM bookings
    WHERE trip_request_id = p_trip_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false,
      'error', 'booking_not_found');
  END IF;

  -- Catalog lookup from the seeded table (NOT a hardcoded
  -- CASE — Codex iteration-6 P2 #2 fix). commission_rate_pct
  -- included per Codex iteration-7 P1 #2 fix.
  SELECT addon_type, unit_price_sar,
         unit_price_min_sar, unit_price_max_sar,
         per_passenger, allow_quantity, free,
         commission_rate_pct
    INTO v_addon_type, v_default_price,
         v_min_price, v_max_price,
         v_per_passenger, v_allow_quantity, v_free,
         v_commission_rate
    FROM addon_catalog
    WHERE subtype = p_addon_subtype;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false,
      'error', 'addon_subtype_unknown');
  END IF;

  -- Effective unit price: override (range-checked) or
  -- catalog default. Free entries (unit_price = 0) accept
  -- override only when the override is also 0; otherwise
  -- reject (founder cannot retroactively charge for the
  -- prayer kit).
  IF p_unit_price_override IS NOT NULL THEN
    IF v_free AND p_unit_price_override <> 0 THEN
      RETURN json_build_object('ok', false,
        'error', 'price_override_on_free_addon');
    END IF;
    IF p_unit_price_override < v_min_price
       OR p_unit_price_override > v_max_price THEN
      RETURN json_build_object('ok', false,
        'error', 'unit_price_out_of_range');
    END IF;
    v_effective_price := p_unit_price_override;
  ELSE
    v_effective_price := v_default_price;
  END IF;

  -- Quantity normalization + per-passenger derivation.
  -- Codex iteration-7 P1 #1 fix: normalize NULL → 1 BEFORE
  -- any IF check so a NULL p_quantity (UI omission or
  -- crafted payload) returns a clean structured contract
  -- instead of slipping past every NULL-typed comparison
  -- and hitting the raw quantity > 0 CHECK constraint.
  -- Codex iteration-6 P2 #1 fix: per_passenger subtypes
  -- derive quantity from the booking's snapshot regardless
  -- of input.
  v_requested_quantity := COALESCE(p_quantity, 1);

  IF v_per_passenger THEN
    v_effective_quantity := v_booking.passengers_count_snapshot;
  ELSE
    IF NOT v_allow_quantity AND v_requested_quantity <> 1 THEN
      RETURN json_build_object('ok', false,
        'error', 'quantity_not_allowed');
    END IF;
    IF v_requested_quantity < 1 OR v_requested_quantity > 50 THEN
      RETURN json_build_object('ok', false,
        'error', 'quantity_out_of_range');
    END IF;
    v_effective_quantity := v_requested_quantity;
  END IF;

  v_total_price := v_effective_quantity * v_effective_price;

  -- INSERT booking_addons row + recompute booking totals
  -- atomically. The `details` JSONB is normalized per Codex
  -- iteration-7 P2 #1 fix: NULL or whitespace-only p_note
  -- stores `{}` (key omission, matches Phase 6.1 canonical
  -- JSONB rule); a real note is trimmed and stored as
  -- `{"note": "..."}`.
  INSERT INTO booking_addons (
    booking_id, addon_type, addon_subtype, details,
    quantity, unit_price, total_price,
    commission_rate, status
  ) VALUES (
    v_booking.id, v_addon_type, p_addon_subtype,
    CASE
      WHEN NULLIF(TRIM(p_note), '') IS NULL
        THEN '{}'::jsonb
      ELSE jsonb_build_object('note', TRIM(p_note))
    END,
    v_effective_quantity, v_effective_price,
    v_total_price, v_commission_rate, 'pending'
  ) RETURNING * INTO v_new_addon;

  PERFORM _recompute_booking_totals(v_booking.id);

  RETURN json_build_object('ok', true,
    'addon', row_to_json(v_new_addon));
END;
$$;

REVOKE ALL ON FUNCTION attach_booking_addon(
  UUID, TEXT, INT, DECIMAL, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION attach_booking_addon(
  UUID, TEXT, INT, DECIMAL, TEXT
) TO service_role;


-- ============================================================
-- 5. customer_cancel_booking_addon — customer remove path ONLY
--
-- Allows ONLY 'pending' → 'cancelled'. Rejects 'confirmed'
-- with `addon_not_cancellable` so a crafted request reusing
-- a valid token AFTER `confirm_checkout_prep` flipped rows
-- to 'confirmed' cannot cancel a confirmed row (Codex
-- iteration-6 P1 fix). Also rejects 'cancelled' /
-- 'delivered' with the same error code (the customer
-- cannot re-cancel an already-cancelled row, nor reverse a
-- delivered row).
-- ============================================================

CREATE OR REPLACE FUNCTION customer_cancel_booking_addon(
  p_booking_addon_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking_id      UUID;
  v_current_status  addon_status;
  v_now             TIMESTAMPTZ := NOW();
  v_updated_addon   booking_addons%ROWTYPE;
BEGIN
  -- Pre-read the addon's booking_id so we can lock the
  -- parent booking before mutating the addon row. Avoids
  -- holding the booking_addons row lock while contending
  -- on the bookings row lock.
  SELECT booking_id INTO v_booking_id
    FROM booking_addons
    WHERE id = p_booking_addon_id;
  IF v_booking_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'addon_not_found');
  END IF;

  -- Lock the parent booking.
  PERFORM 1 FROM bookings WHERE id = v_booking_id FOR UPDATE;

  -- Re-read the addon's status under the parent's lock.
  SELECT status INTO v_current_status
    FROM booking_addons
    WHERE id = p_booking_addon_id;

  -- Customer path: ONLY 'pending' is reversible.
  IF v_current_status <> 'pending' THEN
    RETURN json_build_object('ok', false,
      'error', 'addon_not_cancellable');
  END IF;

  UPDATE booking_addons
    SET status = 'cancelled', cancelled_at = v_now
    WHERE id = p_booking_addon_id
    RETURNING * INTO v_updated_addon;

  PERFORM _recompute_booking_totals(v_booking_id);

  RETURN json_build_object('ok', true,
    'addon', row_to_json(v_updated_addon));
END;
$$;

REVOKE ALL ON FUNCTION customer_cancel_booking_addon(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION customer_cancel_booking_addon(UUID)
  TO service_role;


-- ============================================================
-- 6. admin_cancel_booking_addon — admin path ONLY
--
-- Allows BOTH 'pending' AND 'confirmed' → 'cancelled'. The
-- founder can cancel a confirmed addon (e.g. customer
-- changed mind on a follow-up WhatsApp call). Rejects
-- 'cancelled' with `addon_already_cancelled` (idempotent
-- double-click is a no-op-style error) and 'delivered'
-- with `addon_terminal` (true terminal state; founder
-- cannot un-deliver). Codex iteration-6 P1 fix.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_cancel_booking_addon(
  p_booking_addon_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking_id      UUID;
  v_current_status  addon_status;
  v_now             TIMESTAMPTZ := NOW();
  v_updated_addon   booking_addons%ROWTYPE;
BEGIN
  SELECT booking_id INTO v_booking_id
    FROM booking_addons
    WHERE id = p_booking_addon_id;
  IF v_booking_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'addon_not_found');
  END IF;

  PERFORM 1 FROM bookings WHERE id = v_booking_id FOR UPDATE;

  SELECT status INTO v_current_status
    FROM booking_addons
    WHERE id = p_booking_addon_id;

  IF v_current_status NOT IN ('pending', 'confirmed') THEN
    RETURN json_build_object('ok', false,
      'error', CASE v_current_status
                 WHEN 'cancelled' THEN 'addon_already_cancelled'
                 WHEN 'delivered' THEN 'addon_terminal'
                 ELSE 'addon_not_cancellable'
               END);
  END IF;

  UPDATE booking_addons
    SET status = 'cancelled', cancelled_at = v_now
    WHERE id = p_booking_addon_id
    RETURNING * INTO v_updated_addon;

  PERFORM _recompute_booking_totals(v_booking_id);

  RETURN json_build_object('ok', true,
    'addon', row_to_json(v_updated_addon));
END;
$$;

REVOKE ALL ON FUNCTION admin_cancel_booking_addon(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_cancel_booking_addon(UUID)
  TO service_role;


-- ============================================================
-- 7. update_booking_addon_quantity — admin quantity adjustment
--
-- Rejects per_passenger subtypes (catering rows) with
-- `quantity_locked_by_passenger_count` — the only way to
-- change catering quantity is to cancel + re-attach after
-- the booking's passengers_count_snapshot changes (a
-- future trip-edit flow, out of Phase 6.2 scope).
--
-- For non-per_passenger subtypes: validates allow_quantity
-- (false → reject any p_quantity != 1 with
-- `quantity_not_allowed`), validates p_quantity in [1, 50]
-- with NULL-safe COALESCE normalize (consistent with
-- attach_booking_addon's iteration-7 P1 #1 fix), UPDATEs
-- booking_addons.quantity + recomputes
-- booking_addons.total_price = quantity * unit_price, then
-- recomputes booking totals.
-- ============================================================

CREATE OR REPLACE FUNCTION update_booking_addon_quantity(
  p_booking_addon_id UUID,
  p_quantity         INT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking_id          UUID;
  v_subtype             TEXT;
  v_unit_price          DECIMAL(10,2);
  v_per_passenger       BOOLEAN;
  v_allow_quantity      BOOLEAN;
  v_requested_quantity  INTEGER;
  v_new_total_price     DECIMAL(10,2);
  v_updated_addon       booking_addons%ROWTYPE;
BEGIN
  -- Read the addon's booking_id + subtype + unit_price.
  SELECT booking_id, addon_subtype, unit_price
    INTO v_booking_id, v_subtype, v_unit_price
    FROM booking_addons
    WHERE id = p_booking_addon_id;
  IF v_booking_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'addon_not_found');
  END IF;

  -- Lock the parent booking.
  PERFORM 1 FROM bookings WHERE id = v_booking_id FOR UPDATE;

  -- Look up the catalog flags for this subtype.
  SELECT per_passenger, allow_quantity
    INTO v_per_passenger, v_allow_quantity
    FROM addon_catalog
    WHERE subtype = v_subtype;
  IF NOT FOUND THEN
    -- Should be impossible if booking_addons_subtype_check
    -- is active. Defensive surface.
    RETURN json_build_object('ok', false,
      'error', 'addon_subtype_unknown');
  END IF;

  -- Per-passenger subtypes: quantity is locked to the
  -- booking's passengers_count_snapshot. Any update attempt
  -- is rejected.
  IF v_per_passenger THEN
    RETURN json_build_object('ok', false,
      'error', 'quantity_locked_by_passenger_count');
  END IF;

  -- NULL-safe normalize then range check (consistent with
  -- attach_booking_addon's iteration-7 P1 #1 fix).
  v_requested_quantity := COALESCE(p_quantity, 1);

  IF NOT v_allow_quantity AND v_requested_quantity <> 1 THEN
    RETURN json_build_object('ok', false,
      'error', 'quantity_not_allowed');
  END IF;
  IF v_requested_quantity < 1 OR v_requested_quantity > 50 THEN
    RETURN json_build_object('ok', false,
      'error', 'quantity_out_of_range');
  END IF;

  v_new_total_price := v_requested_quantity * v_unit_price;

  UPDATE booking_addons
    SET quantity    = v_requested_quantity,
        total_price = v_new_total_price
    WHERE id = p_booking_addon_id
    RETURNING * INTO v_updated_addon;

  PERFORM _recompute_booking_totals(v_booking_id);

  RETURN json_build_object('ok', true,
    'addon', row_to_json(v_updated_addon));
END;
$$;

REVOKE ALL ON FUNCTION update_booking_addon_quantity(UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_booking_addon_quantity(UUID, INT)
  TO service_role;


-- ============================================================
-- 8. confirm_checkout_prep — customer-side confirm
--
-- Locks the bookings row, UPDATEs every addon whose
-- booking_id = p_booking_id and status = 'pending' to
-- status = 'confirmed'. Idempotent (already-confirmed rows
-- are not touched). Does NOT touch payment_status (stays
-- 'pending_offline'). The recompute call is a no-op for
-- totals (the recompute includes 'confirmed' in the sum
-- already), but is preserved for symmetry with the other
-- mutation RPCs.
-- ============================================================

CREATE OR REPLACE FUNCTION confirm_checkout_prep(
  p_booking_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now              TIMESTAMPTZ := NOW();
  v_confirmed_count  INTEGER;
  v_confirmed_ids    UUID[];
BEGIN
  -- Lock the parent booking. Returns booking_not_found if
  -- the caller passed a bogus UUID.
  PERFORM 1 FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'booking_not_found');
  END IF;

  -- Flip every 'pending' addon to 'confirmed'. Idempotent:
  -- already-confirmed rows are not in the WHERE clause, so
  -- a second call returns confirmed_count = 0.
  WITH flipped AS (
    UPDATE booking_addons
      SET status = 'confirmed'
      WHERE booking_id = p_booking_id
        AND status = 'pending'
      RETURNING id
  )
  SELECT COUNT(*)::INTEGER, COALESCE(array_agg(id), ARRAY[]::UUID[])
    INTO v_confirmed_count, v_confirmed_ids
    FROM flipped;

  -- Defense-in-depth uniformity: recompute totals. The
  -- recompute is a no-op because both 'pending' and
  -- 'confirmed' rows count toward addons_amount; the
  -- pending → confirmed flip changes nothing in the sum.
  PERFORM _recompute_booking_totals(p_booking_id);

  RETURN json_build_object('ok', true,
    'booking_id', p_booking_id,
    'confirmed_count', v_confirmed_count,
    'confirmed_addon_ids', v_confirmed_ids,
    'confirmed_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION confirm_checkout_prep(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_checkout_prep(UUID)
  TO service_role;


-- ============================================================
-- END OF PR 2a MIGRATION
--
-- Post-migration shape (founder probe set #2 verifies):
--   - accept_offer(p_source TEXT, p_offer_id UUID)
--     RETURNS JSON: signature unchanged; body extended;
--     return now includes booking_id alongside ok +
--     trip_request_id.
--   - 6 new public functions:
--     backfill_booking_from_offer(UUID),
--     attach_booking_addon(UUID, TEXT, INT, DECIMAL, TEXT),
--     customer_cancel_booking_addon(UUID),
--     admin_cancel_booking_addon(UUID),
--     update_booking_addon_quantity(UUID, INT),
--     confirm_checkout_prep(UUID).
--   - 1 internal helper:
--     _recompute_booking_totals(UUID), REVOKEd from
--     PUBLIC + anon + authenticated + service_role.
--   - All 7 public functions: SECURITY DEFINER +
--     search_path = public, pg_temp + service-role-only
--     EXECUTE.
-- ============================================================
