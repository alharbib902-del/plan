-- ============================================================
-- P0 fix — link charter bookings to the operator's portal
-- account (bookings.operator_id) via phone match
-- ============================================================
--
-- PROBLEM. Charter bookings were invisible in the operator
-- portal (/operator/bookings). Two causes stacked:
--   1. accept_offer (and its Case-C sibling
--      backfill_booking_from_offer) always INSERTed
--      bookings.operator_id = NULL, keeping the operator
--      identity only as free-text snapshot columns
--      (operator_name/phone/email_snapshot).
--   2. The portal's listOperatorBookings filters
--      bookings.operator_id = <session operator id>, so every
--      charter booking was filtered out. (The app-layer query
--      is intentionally NOT changed here; the companion app
--      fix only makes its error logging observable. This
--      migration fixes the data.)
--
-- FIX. After the chosen offer is locked + validated (both the
-- phase4 and phase5 branches), resolve operators.id where
-- operators.contact_phone = the offer's operator_phone and
-- INSERT that id into bookings.operator_id. When no operators
-- row matches, operator_id stays NULL — a free-text operator
-- identity with no portal account is a valid state. Per the
-- lockstep note in 20260509000008_phase_6_2_accept_offer.sql
-- ("Both functions stay in lockstep; if one changes, the
-- other changes in the same migration file"), BOTH
-- booking-INSERT functions are replaced here with the
-- identical change. Every other aspect of both bodies — lock
-- order, sibling-reject logic, round close, snapshot columns,
-- return shapes — is preserved byte-for-byte.
--
-- PHONE-FORMAT ASSUMPTION. Offer operator_phone is validated
-- as strict E.164 at the form layer
-- (lib/validators/operator-offer.ts, E164 = /^\+[1-9]\d{6,14}$/,
-- wired into components/operator/offer-form.tsx) and
-- operators.contact_phone is stored in the same E.164 shape by
-- signup convention (length-validated 6..20 at the RPC layer),
-- so an exact equality match is correct and NO normalization
-- is applied. contact_phone carries no UNIQUE constraint; the
-- ORDER BY created_at, id + LIMIT 1 keeps a (not expected)
-- multi-match deterministic — oldest account wins.
--
-- BACKFILL. The UPDATE at the end links EXISTING charter
-- bookings (source_offer_table IN ('phase4','phase5') — the
-- two values accept_offer writes for charter) to their
-- operator via the same phone match against the booking's
-- source offer row, guarded by WHERE operator_id IS NULL so
-- re-runs are no-ops.
--
-- Forward-only + idempotent: CREATE OR REPLACE for both
-- functions; the backfill UPDATE is safe to re-run. Applied
-- via the external runner (never `supabase db push`).
-- SECURITY DEFINER + search_path = public, pg_temp +
-- service-role-only EXECUTE preserved from the original
-- grants.
-- ============================================================


-- ============================================================
-- 1. accept_offer — CREATE OR REPLACE (adds operator link)
--
-- Body copied verbatim from
-- 20260509000008_phase_6_2_accept_offer.sql with exactly two
-- additions, marked "(20260719000001)" inline:
--   - new DECLARE v_operator_id + step 4.5 phone→account
--     resolution (after the offer lock + validation, before
--     the sibling rejects — a plain SELECT taking no row lock,
--     so the Phase 5 lock order is preserved);
--   - step 9 VALUES passes v_operator_id instead of a
--     hardcoded NULL for bookings.operator_id.
-- Signature, lock order, sibling-reject logic, round close,
-- snapshot columns and return shape are unchanged.
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
  -- 20260719000001: operators.id resolved from the offer's
  -- operator phone; stays NULL when no portal account matches.
  v_operator_id          UUID;
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

  -- Step 4.5 (20260719000001): resolve the operator's portal
  -- account for the bookings INSERT. Exact equality on
  -- E.164-stored phones (see the header's PHONE-FORMAT
  -- ASSUMPTION); ORDER BY + LIMIT 1 keeps an unexpected
  -- duplicate-phone match deterministic (oldest account wins);
  -- no matching row leaves v_operator_id NULL, which step 9
  -- stores as-is. Plain SELECT: no row lock, so the Phase 5
  -- lock order is untouched.
  SELECT id INTO v_operator_id
    FROM operators
    WHERE contact_phone = v_offer_operator_phone
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

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
    -- Operator: resolved FK (20260719000001; NULL when no
    -- portal account matches) + 3-field snapshot (PR 1 File A
    -- step 2).
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
    v_operator_id,                                     -- operator_id (NULL when no account matches)
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
-- 2. backfill_booking_from_offer — CREATE OR REPLACE (same
--    operator link, lockstep with accept_offer)
--
-- The original file pins the invariant "Both functions stay
-- in lockstep; if one changes, the other changes in the same
-- migration file" — so the identical two additions marked
-- "(20260719000001)" are applied here: v_operator_id DECLARE +
-- step 4.5 phone→account resolution, and the step 5 INSERT
-- passing v_operator_id instead of a hardcoded NULL.
-- Everything else (validation, ambiguous/no-accepted-offer
-- errors, column list, return shape) is unchanged.
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
  -- 20260719000001: operators.id resolved from the offer's
  -- operator phone; stays NULL when no portal account matches.
  v_operator_id          UUID;
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

  -- Step 4.5 (20260719000001): same operators.contact_phone
  -- resolution as accept_offer's step 4.5 — see the rationale
  -- comment there (exact E.164 equality, deterministic
  -- tie-break, NULL when no portal account matches).
  SELECT id INTO v_operator_id
    FROM operators
    WHERE contact_phone = v_offer_operator_phone
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

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
    v_operator_id,                                     -- operator_id (NULL when no account matches)
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
-- 3. Backfill EXISTING charter bookings
--
-- Charter bookings created before this migration carry
-- operator_id = NULL, so they are invisible to
-- listOperatorBookings. Re-derive the link from the booking's
-- source offer row using the same phone match the new
-- function bodies use (exact E.164 equality on
-- operators.contact_phone, deterministic tie-break, see the
-- header's PHONE-FORMAT ASSUMPTION). Charter bookings are the
-- rows whose source_offer_table is 'phase4' or 'phase5' — the
-- two discriminator values accept_offer writes.
--
-- Idempotent: the b.operator_id IS NULL guard means a re-run
-- matches zero already-linked rows, and the
-- picked.operator_id IS NOT NULL guard skips offers whose
-- phone has no operators match (those bookings keep
-- operator_id = NULL — a valid state, see header).
-- ============================================================

UPDATE bookings AS b
  SET operator_id = picked.operator_id
  FROM (
    SELECT src.source_offer_table,
           src.source_offer_id,
           (SELECT o.id
              FROM operators AS o
             WHERE o.contact_phone = src.operator_phone
             ORDER BY o.created_at ASC, o.id ASC
             LIMIT 1) AS operator_id
      FROM (
        SELECT 'phase4'::TEXT AS source_offer_table,
               id AS source_offer_id,
               operator_phone
          FROM phase4_operator_offers
        UNION ALL
        SELECT 'phase5'::TEXT,
               id,
               operator_phone
          FROM phase5_operator_offers
      ) AS src
  ) AS picked
  WHERE b.source_offer_table = picked.source_offer_table
    AND b.source_offer_id = picked.source_offer_id
    AND b.operator_id IS NULL
    AND picked.operator_id IS NOT NULL;


-- ============================================================
-- END OF MIGRATION
--
-- Post-migration shape:
--   - accept_offer(p_source TEXT, p_offer_id UUID) — signature
--     + return shape unchanged; step 9 now stores the resolved
--     bookings.operator_id (NULL when no account matches).
--   - backfill_booking_from_offer(p_trip_id UUID) — identical
--     operator-link change, in lockstep.
--   - Existing charter bookings with a phone-matching
--     operators row are linked by the backfill UPDATE above.
--   - Both functions remain SECURITY DEFINER +
--     search_path = public, pg_temp + service-role-only
--     EXECUTE.
-- ============================================================
