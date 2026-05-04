-- ============================================
-- AERIS — Phase 4: Minimal Operator Portal
-- Migration: 20260504000003
-- ============================================
--
-- Adds the schema and atomic SQL functions required by Phase 4
-- (Minimal Operator Portal). See aeris/docs/CLAUDE-TASK.md
-- "Phase 4: Minimal Operator Portal" iteration 4 for the design
-- rationale.
--
-- Sub-sections:
--   1a. trip_requests changes for guest-originated requests +
--       dispatch tracking columns.
--   1b. lead_inquiries.converted_at column.
--   1c. phase4_operator_offers snapshot table (deny-all RLS).
--   1e-1. promote_lead_to_trip_request(...) atomic function.
--   1e-2. accept_phase4_offer(...) atomic function with expiry guard.
--   1e-3. submit_phase4_operator_offer(...) atomic function with
--         re-dispatch race guard.
--
-- All three SECURITY DEFINER functions pin
-- search_path = public, pg_temp.
-- ============================================


-- ============================================
-- 1a. trip_requests: guest customers + dispatch tracking
-- ============================================

ALTER TABLE trip_requests
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS customer_name          VARCHAR(120),
  ADD COLUMN IF NOT EXISTS customer_phone         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS customer_source        VARCHAR(40) DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS dispatch_nonce         TEXT,
  ADD COLUMN IF NOT EXISTS dispatch_expires_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_target_phone  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS dispatched_at          TIMESTAMPTZ;

ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_identity_check
  CHECK (
    client_id IS NOT NULL
    OR (customer_name IS NOT NULL AND customer_phone IS NOT NULL)
  );


-- ============================================
-- 1b. lead_inquiries.converted_at
-- ============================================

ALTER TABLE lead_inquiries
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;


-- ============================================
-- 1c. phase4_operator_offers (snapshot table, deny-all RLS)
-- ============================================
--
-- Mirrors the lead_inquiries pattern: RLS enabled with no policies
-- so anon and authenticated cannot reach the table at all. All
-- access goes through the service role from validated Server
-- Actions. Snapshot columns because no operators / aircraft rows
-- exist in Phase 4.

CREATE TABLE IF NOT EXISTS phase4_operator_offers (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_request_id          UUID NOT NULL REFERENCES trip_requests(id) ON DELETE CASCADE,

  -- Operator snapshot (free text)
  operator_name            VARCHAR(120) NOT NULL,
  operator_phone           VARCHAR(20),
  operator_email           VARCHAR(120),

  -- Aircraft snapshot
  aircraft_category        aircraft_category,
  aircraft_type            VARCHAR(80),
  aircraft_registration    VARCHAR(20),

  -- Pricing
  total_price_sar          DECIMAL(12,2) NOT NULL CHECK (total_price_sar >= 1000),

  -- Schedule
  departure_eta            TIMESTAMPTZ NOT NULL,
  validity_hours           INTEGER NOT NULL DEFAULT 24
                             CHECK (validity_hours BETWEEN 1 AND 168),
  expires_at               TIMESTAMPTZ NOT NULL,

  -- Notes
  notes                    TEXT,

  -- State
  status                   offer_status NOT NULL DEFAULT 'pending',
  decided_at               TIMESTAMPTZ,

  -- Provenance
  source_dispatch_nonce    TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phase4_offers_trip
  ON phase4_operator_offers (trip_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_phase4_offers_status
  ON phase4_operator_offers (status, created_at DESC);

DROP TRIGGER IF EXISTS phase4_operator_offers_updated_at
  ON phase4_operator_offers;
CREATE TRIGGER phase4_operator_offers_updated_at
  BEFORE UPDATE ON phase4_operator_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE phase4_operator_offers ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies — anon + authenticated cannot
-- SELECT/INSERT/UPDATE/DELETE. Service role only.

COMMENT ON TABLE phase4_operator_offers IS
  'Phase 4: free-text operator submissions via signed token URL. Server-only access.';


-- ============================================
-- 1e-1. promote_lead_to_trip_request — guest lead → trip_request
-- ============================================

CREATE OR REPLACE FUNCTION promote_lead_to_trip_request(
  p_lead_id              UUID,
  p_legs                 JSONB,
  p_aircraft_category    aircraft_category,
  p_special_requests     TEXT,
  p_lead_trip_type       TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead    RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_trip_id UUID;
BEGIN
  -- Lock the lead row to serialize concurrent promote attempts.
  SELECT * INTO v_lead
    FROM lead_inquiries
    WHERE id = p_lead_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  IF v_lead.status NOT IN ('new', 'contacted', 'quoted') THEN
    RETURN json_build_object('ok', false, 'error', 'lead_not_promotable');
  END IF;

  INSERT INTO trip_requests (
    client_id, customer_name, customer_phone, customer_source,
    trip_type, legs,
    departure_date, return_date, passengers_count,
    aircraft_category_preference, special_requests,
    preferences, status
  ) VALUES (
    NULL,
    v_lead.customer_name, v_lead.customer_phone, 'lead',
    'charter', p_legs,
    v_lead.departure_date::timestamptz,
    v_lead.return_date::timestamptz,
    v_lead.passengers,
    p_aircraft_category, p_special_requests,
    jsonb_build_object('lead_trip_type', p_lead_trip_type),
    'pending'
  )
  RETURNING id INTO v_trip_id;

  UPDATE lead_inquiries
    SET status = 'converted', converted_at = v_now
    WHERE id = p_lead_id;

  RETURN json_build_object('ok', true, 'trip_request_id', v_trip_id);
END;
$$;

REVOKE ALL ON FUNCTION promote_lead_to_trip_request(
  UUID, JSONB, aircraft_category, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION promote_lead_to_trip_request(
  UUID, JSONB, aircraft_category, TEXT, TEXT
) TO service_role;


-- ============================================
-- 1e-2. accept_phase4_offer — accept with expiry guard
-- ============================================

CREATE OR REPLACE FUNCTION accept_phase4_offer(
  p_offer_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trip_id UUID;
  v_now     TIMESTAMPTZ := NOW();
BEGIN
  -- Lock the offer row AND require it still be valid.
  -- Phase 4 has no background job that flips expired offers to
  -- 'expired' on a schedule, so the guard MUST live here.
  SELECT trip_request_id INTO v_trip_id
    FROM phase4_operator_offers
    WHERE id = p_offer_id
      AND status = 'pending'
      AND expires_at > v_now
    FOR UPDATE;

  IF v_trip_id IS NULL THEN
    PERFORM 1
      FROM phase4_operator_offers
      WHERE id = p_offer_id
        AND status = 'pending'
        AND expires_at <= v_now
      FOR UPDATE;
    IF FOUND THEN
      UPDATE phase4_operator_offers
        SET status = 'expired', decided_at = v_now
        WHERE id = p_offer_id AND status = 'pending';
      RETURN json_build_object('ok', false, 'error', 'offer_expired');
    END IF;
    RETURN json_build_object('ok', false, 'error', 'offer_not_pending');
  END IF;

  PERFORM 1 FROM trip_requests
    WHERE id = v_trip_id
      AND status IN ('pending', 'distributed', 'offered')
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_open');
  END IF;

  UPDATE phase4_operator_offers
    SET status = 'accepted', decided_at = v_now
    WHERE id = p_offer_id;

  UPDATE phase4_operator_offers
    SET status = 'rejected', decided_at = v_now
    WHERE trip_request_id = v_trip_id
      AND id <> p_offer_id
      AND status = 'pending';

  UPDATE trip_requests
    SET status = 'booked'
    WHERE id = v_trip_id;

  RETURN json_build_object('ok', true, 'trip_request_id', v_trip_id);
END;
$$;

REVOKE ALL ON FUNCTION accept_phase4_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_phase4_offer(UUID) TO service_role;


-- ============================================
-- 1e-3. submit_phase4_operator_offer — operator submission with race guard
-- ============================================

CREATE OR REPLACE FUNCTION submit_phase4_operator_offer(
  p_token_trip_id          UUID,
  p_token_nonce            TEXT,
  p_operator_name          TEXT,
  p_operator_phone         TEXT,
  p_operator_email         TEXT,
  p_aircraft_category      aircraft_category,
  p_aircraft_type          TEXT,
  p_aircraft_registration  TEXT,
  p_total_price_sar        DECIMAL,
  p_departure_eta          TIMESTAMPTZ,
  p_validity_hours         INTEGER,
  p_notes                  TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trip      RECORD;
  v_now       TIMESTAMPTZ := NOW();
  v_offer_id  UUID;
BEGIN
  -- Lock the trip and atomically re-verify dispatch state.
  -- Closes the window between the Server Action's token
  -- validation and the offer insert.
  SELECT id, dispatch_nonce, dispatch_expires_at, status
    INTO v_trip
    FROM trip_requests
    WHERE id = p_token_trip_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_found');
  END IF;

  IF v_trip.status IN ('booked', 'cancelled') THEN
    RETURN json_build_object('ok', false, 'error', 'trip_closed');
  END IF;

  IF v_trip.dispatch_nonce IS DISTINCT FROM p_token_nonce
     OR v_trip.dispatch_expires_at IS NULL
     OR v_trip.dispatch_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'token_stale');
  END IF;

  INSERT INTO phase4_operator_offers (
    trip_request_id,
    operator_name, operator_phone, operator_email,
    aircraft_category, aircraft_type, aircraft_registration,
    total_price_sar,
    departure_eta, validity_hours, expires_at,
    notes,
    status, source_dispatch_nonce
  ) VALUES (
    p_token_trip_id,
    p_operator_name, p_operator_phone, p_operator_email,
    p_aircraft_category, p_aircraft_type, p_aircraft_registration,
    p_total_price_sar,
    p_departure_eta, p_validity_hours,
    v_now + (p_validity_hours * INTERVAL '1 hour'),
    p_notes,
    'pending', p_token_nonce
  )
  RETURNING id INTO v_offer_id;

  IF v_trip.status IN ('pending', 'distributed') THEN
    UPDATE trip_requests
      SET status = 'offered'
      WHERE id = p_token_trip_id;
  END IF;

  RETURN json_build_object('ok', true, 'offer_id', v_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION submit_phase4_operator_offer(
  UUID, TEXT, TEXT, TEXT, TEXT,
  aircraft_category, TEXT, TEXT,
  DECIMAL, TIMESTAMPTZ, INTEGER, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION submit_phase4_operator_offer(
  UUID, TEXT, TEXT, TEXT, TEXT,
  aircraft_category, TEXT, TEXT,
  DECIMAL, TIMESTAMPTZ, INTEGER, TEXT
) TO service_role;
