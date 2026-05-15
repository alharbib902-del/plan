-- ============================================================
-- Phase 11 PR 1 — Aeris Cargo (Special Cargo Charter) intake
--
-- Spec: aeris/docs/PHASE-11-CARGO-SPEC.md (Codex 100/100, round 10)
-- PR: #64 (spec) merged at 6f70662. This migration implements:
--
--   §3.1 — cargo_requests table + 2 ENUMs + 5 named CHECKs + 3 indexes + RLS
--   §3.2 — cargo_offers table + 1 ENUM + 4 named CHECKs + 3 indexes + RLS
--   §3.3 — cargo_requests.accepted_offer_id FK + invariant CHECK
--   §3.4.1 — bookings.source_discriminator extended to 'cargo'
--   §3.4.2 — bookings_source_offer_check extended to 'cargo_offers'
--   §3.4.3 — bookings.operator_*_snapshot widened to source schema
--   §3.5 — cargo_aircraft_capabilities table + 4 partial indexes + RLS
--   §3.6 — cargo_email_alert_status singleton + RLS
--   §4.1 — create_cargo_request_guest RPC (NEW)
--   §4.2 — create_cargo_request_authenticated RPC (NEW)
--   §4.3 — submit_cargo_offer RPC (NEW)
--
-- Conventions carried forward from Phase 9 PR 1 + Phase 10 PR 1:
--   #1  REVOKE PUBLIC + anon + authenticated; GRANT EXECUTE service_role
--   #12 ip_required guard on auth-bound RPCs
--   #15 looseClient pattern for callers (TS layer)
--
-- Replay-safety conventions (Codex rounds 1-9):
--   - All ENUM CREATE TYPE wrapped in pg_type DO block guards
--   - All CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
--   - All named CHECK + FK constraints have explicit names + DO block guards
--   - Defensive ALTER COLUMN repairs for partial-replay drift
--   - Audit-then-RAISE pattern not needed here (no existing rows
--     to violate the new constraints; cargo tables are brand new)
-- ============================================================


-- ============================================================
-- §3.1 — cargo_requests table + ENUMs + CHECKs + indexes + RLS
-- ============================================================

-- Replay-safe ENUM creation (Codex round 1 P2 #5)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'cargo_type'
       AND n.nspname = 'public'
  ) THEN
    CREATE TYPE cargo_type AS ENUM (
      'horse', 'luxury_car', 'valuables', 'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'cargo_request_status'
       AND n.nspname = 'public'
  ) THEN
    CREATE TYPE cargo_request_status AS ENUM (
      'pending',           -- waiting for offers
      'offers_received',   -- ≥1 offer in
      'accepted',          -- offer accepted → booking created
      'cancelled',         -- client/admin cancelled before acceptance
      'expired'            -- 14-day TTL hit without acceptance
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cargo_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_request_number VARCHAR(20) NOT NULL UNIQUE
    DEFAULT ('CGO-' || SUBSTR(MD5(uuid_generate_v4()::TEXT), 1, 8)),

  -- Identity (Phase 9 PR 2 immutable-snapshot pattern)
  client_id UUID REFERENCES clients(id) ON DELETE RESTRICT,
  customer_name_snapshot VARCHAR(120) NOT NULL,
  customer_phone_snapshot VARCHAR(20) NOT NULL,
  customer_email_snapshot VARCHAR(120),

  -- Cargo classification
  cargo_type cargo_type NOT NULL,

  -- Shared shipment fields
  origin_iata VARCHAR(4),
  origin_freeform TEXT,
  destination_iata VARCHAR(4),
  destination_freeform TEXT,
  pickup_date DATE NOT NULL,
  delivery_date_target DATE,
  flexibility_days INT NOT NULL DEFAULT 0
    CHECK (flexibility_days >= 0 AND flexibility_days <= 7),

  -- Value + insurance (round 3 P2 #4 + round 6 P2 #4 named CHECK)
  estimated_value_sar DECIMAL(14, 2) NOT NULL
    CONSTRAINT cargo_requests_value_positive_check
      CHECK (estimated_value_sar > 0),
  insurance_required BOOLEAN NOT NULL DEFAULT false,

  -- Free text
  handling_notes TEXT,

  -- Per-category fields (NULLable; strict exclusivity via
  -- cargo_requests_category_required_check below)
  -- horses
  horse_count INT
    CHECK (horse_count IS NULL OR (horse_count > 0 AND horse_count <= 30)),
  horse_groom_required BOOLEAN,
  horse_cites_status TEXT
    CHECK (horse_cites_status IS NULL
      OR horse_cites_status IN ('ready', 'in_progress', 'help_needed')),
  horse_stall_requirements TEXT,

  -- luxury cars
  car_make TEXT,
  car_model TEXT,
  car_year INT
    CHECK (car_year IS NULL OR (car_year >= 1900 AND car_year <= 2100)),
  car_running_condition BOOLEAN,
  car_enclosed_required BOOLEAN,

  -- valuables
  valuables_declared_value_sar DECIMAL(14, 2),
  valuables_security_level TEXT
    CHECK (valuables_security_level IS NULL
      OR valuables_security_level IN ('standard', 'high', 'armed_escort')),
  valuables_climate_controlled BOOLEAN,
  valuables_item_description TEXT,

  -- other (freeform)
  other_description TEXT,
  other_dimensions_lwh_cm TEXT,
  other_weight_kg DECIMAL(10, 2),
  other_special_handling TEXT,

  -- Status + audit
  status cargo_request_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  accepted_offer_id UUID,  -- FK added in §3.3 after cargo_offers exists

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Identity check: snapshots ALWAYS populated even when client_id
  -- is set (immutable audit per Phase 9 PR 2 Decision #4).
  CONSTRAINT cargo_requests_identity_check CHECK (
    customer_name_snapshot IS NOT NULL
    AND customer_phone_snapshot IS NOT NULL
  ),

  -- Round 3 P2 #3 + round 7 P2 #2 — strict per-category check.
  -- Each cargo_type branch requires its min field AND requires
  -- the OTHER 3 categories' fields to be NULL (no cross-category
  -- mixing). Pre-round-3 lax form lacked the cross-category NULL
  -- requirements; Probe 28 verifies via pg_get_constraintdef
  -- ILIKE '%horse_count IS NULL%' (only the strict form has this).
  CONSTRAINT cargo_requests_category_required_check CHECK (
    (cargo_type = 'horse'
      AND horse_count IS NOT NULL
      -- forbid luxury_car
      AND car_make IS NULL AND car_model IS NULL AND car_year IS NULL
      AND car_running_condition IS NULL AND car_enclosed_required IS NULL
      -- forbid valuables
      AND valuables_declared_value_sar IS NULL
      AND valuables_security_level IS NULL
      AND valuables_climate_controlled IS NULL
      AND valuables_item_description IS NULL
      -- forbid other
      AND other_description IS NULL AND other_dimensions_lwh_cm IS NULL
      AND other_weight_kg IS NULL AND other_special_handling IS NULL)
    OR (cargo_type = 'luxury_car'
      AND car_make IS NOT NULL AND car_model IS NOT NULL
      -- forbid horse
      AND horse_count IS NULL AND horse_groom_required IS NULL
      AND horse_cites_status IS NULL AND horse_stall_requirements IS NULL
      -- forbid valuables
      AND valuables_declared_value_sar IS NULL
      AND valuables_security_level IS NULL
      AND valuables_climate_controlled IS NULL
      AND valuables_item_description IS NULL
      -- forbid other
      AND other_description IS NULL AND other_dimensions_lwh_cm IS NULL
      AND other_weight_kg IS NULL AND other_special_handling IS NULL)
    OR (cargo_type = 'valuables'
      AND valuables_declared_value_sar IS NOT NULL
      -- forbid horse
      AND horse_count IS NULL AND horse_groom_required IS NULL
      AND horse_cites_status IS NULL AND horse_stall_requirements IS NULL
      -- forbid luxury_car
      AND car_make IS NULL AND car_model IS NULL AND car_year IS NULL
      AND car_running_condition IS NULL AND car_enclosed_required IS NULL
      -- forbid other
      AND other_description IS NULL AND other_dimensions_lwh_cm IS NULL
      AND other_weight_kg IS NULL AND other_special_handling IS NULL)
    OR (cargo_type = 'other'
      AND other_description IS NOT NULL
      -- forbid horse
      AND horse_count IS NULL AND horse_groom_required IS NULL
      AND horse_cites_status IS NULL AND horse_stall_requirements IS NULL
      -- forbid luxury_car
      AND car_make IS NULL AND car_model IS NULL AND car_year IS NULL
      AND car_running_condition IS NULL AND car_enclosed_required IS NULL
      -- forbid valuables
      AND valuables_declared_value_sar IS NULL
      AND valuables_security_level IS NULL
      AND valuables_climate_controlled IS NULL
      AND valuables_item_description IS NULL)
  ),

  -- Route presence (Phase 6.2 + empty_legs *_present_check pattern)
  CONSTRAINT cargo_requests_origin_present_check CHECK (
    origin_iata IS NOT NULL OR origin_freeform IS NOT NULL
  ),
  CONSTRAINT cargo_requests_destination_present_check CHECK (
    destination_iata IS NOT NULL OR destination_freeform IS NOT NULL
  ),

  -- Round 3 P2 #4 — date order CHECK on intake.
  CONSTRAINT cargo_requests_date_order_check CHECK (
    delivery_date_target IS NULL
    OR delivery_date_target >= pickup_date
  )
);

CREATE INDEX IF NOT EXISTS idx_cargo_requests_client
  ON cargo_requests (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_requests_status
  ON cargo_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_requests_pickup
  ON cargo_requests (pickup_date)
  WHERE status IN ('pending', 'offers_received');

-- Round 6 P1 #3 — RLS on cargo_requests (PII).
ALTER TABLE cargo_requests ENABLE ROW LEVEL SECURITY;

-- Round 6 P2 #4 — defensive named-CHECK re-add via DO blocks.
-- Closes partial-replay drift cases CREATE TABLE IF NOT EXISTS skips.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_requests_value_positive_check'
       AND conrelid = 'cargo_requests'::regclass
  ) THEN
    ALTER TABLE cargo_requests
      ADD CONSTRAINT cargo_requests_value_positive_check
      CHECK (estimated_value_sar > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_requests_date_order_check'
       AND conrelid = 'cargo_requests'::regclass
  ) THEN
    ALTER TABLE cargo_requests
      ADD CONSTRAINT cargo_requests_date_order_check
      CHECK (
        delivery_date_target IS NULL
        OR delivery_date_target >= pickup_date
      );
  END IF;
END $$;


-- ============================================================
-- §3.2 — cargo_offers table + ENUM + CHECKs + indexes + RLS
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'cargo_offer_status'
       AND n.nspname = 'public'
  ) THEN
    CREATE TYPE cargo_offer_status AS ENUM (
      'pending',     -- operator submitted, awaiting client/admin decision
      'accepted',    -- client/admin accepted → booking created
      'declined',    -- client/admin explicitly declined
      'withdrawn',   -- operator pulled the offer
      'expired'      -- offer's TTL hit before accept/decline
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cargo_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_request_id UUID NOT NULL
    REFERENCES cargo_requests(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL
    REFERENCES operators(id) ON DELETE RESTRICT,
  -- Round 1 P1 #4 — aircraft_id NOT NULL (forces every cargo
  -- offer to declare which specific aircraft will fly it; §4.3
  -- capability check verifies against §3.5 matrix).
  aircraft_id UUID NOT NULL
    REFERENCES aircraft(id) ON DELETE RESTRICT,

  -- Snapshots (Phase 9 PR 2 immutability + round 3 P1 #1 +
  -- round 6 P1 #2 widened to source operators schema)
  operator_name_snapshot VARCHAR(200) NOT NULL,
  operator_phone_snapshot VARCHAR(20) NOT NULL,
  operator_email_snapshot VARCHAR(255) NOT NULL,
  aircraft_snapshot TEXT,

  -- Round 2 P1 #2 — 3 named price CHECKs.
  base_price_sar DECIMAL(14, 2) NOT NULL
    CONSTRAINT cargo_offers_base_price_positive_check
      CHECK (base_price_sar > 0),
  insurance_price_sar DECIMAL(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT cargo_offers_insurance_price_nonneg_check
      CHECK (insurance_price_sar >= 0),
  customs_handling_price_sar DECIMAL(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT cargo_offers_customs_handling_nonneg_check
      CHECK (customs_handling_price_sar >= 0),
  total_price_sar DECIMAL(14, 2) GENERATED ALWAYS AS (
    base_price_sar + insurance_price_sar + customs_handling_price_sar
  ) STORED,

  proposed_pickup_date DATE NOT NULL,
  proposed_delivery_date DATE NOT NULL,

  operator_notes TEXT,

  status cargo_offer_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  decided_at TIMESTAMPTZ,
  decided_by_user_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cargo_offers_date_order_check CHECK (
    proposed_delivery_date >= proposed_pickup_date
  )
);

CREATE INDEX IF NOT EXISTS idx_cargo_offers_request
  ON cargo_offers (cargo_request_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_offers_operator
  ON cargo_offers (operator_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_offers_pending
  ON cargo_offers (cargo_request_id, status)
  WHERE status = 'pending';

-- Round 5 P2 #3 — defensive width repair (in case of partial replay).
ALTER TABLE cargo_offers
  ALTER COLUMN operator_name_snapshot TYPE VARCHAR(200),
  ALTER COLUMN operator_email_snapshot TYPE VARCHAR(255);

-- Round 6 P1 #3 — RLS on cargo_offers (operator pricing).
ALTER TABLE cargo_offers ENABLE ROW LEVEL SECURITY;

-- Round 6 P2 #4 — defensive aircraft_id NOT NULL repair.
ALTER TABLE cargo_offers
  ALTER COLUMN aircraft_id SET NOT NULL;

-- Round 6 P2 #4 — defensive named-CHECK re-add via DO blocks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_offers_base_price_positive_check'
       AND conrelid = 'cargo_offers'::regclass
  ) THEN
    ALTER TABLE cargo_offers
      ADD CONSTRAINT cargo_offers_base_price_positive_check
      CHECK (base_price_sar > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_offers_insurance_price_nonneg_check'
       AND conrelid = 'cargo_offers'::regclass
  ) THEN
    ALTER TABLE cargo_offers
      ADD CONSTRAINT cargo_offers_insurance_price_nonneg_check
      CHECK (insurance_price_sar >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_offers_customs_handling_nonneg_check'
       AND conrelid = 'cargo_offers'::regclass
  ) THEN
    ALTER TABLE cargo_offers
      ADD CONSTRAINT cargo_offers_customs_handling_nonneg_check
      CHECK (customs_handling_price_sar >= 0);
  END IF;
END $$;


-- ============================================================
-- §3.3 — cargo_requests.accepted_offer_id FK + invariant CHECK
--
-- Deferred-add to break circular dependency (FK target =
-- cargo_offers, declared after cargo_requests in §3.1).
-- Round 2 P2 #3 — ON DELETE RESTRICT + invariant CHECK.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_requests_accepted_offer_fkey'
       AND conrelid = 'cargo_requests'::regclass
  ) THEN
    ALTER TABLE cargo_requests
      ADD CONSTRAINT cargo_requests_accepted_offer_fkey
      FOREIGN KEY (accepted_offer_id)
      REFERENCES cargo_offers(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_requests_accepted_has_offer_check'
       AND conrelid = 'cargo_requests'::regclass
  ) THEN
    ALTER TABLE cargo_requests
      ADD CONSTRAINT cargo_requests_accepted_has_offer_check
      CHECK (
        status <> 'accepted' OR accepted_offer_id IS NOT NULL
      );
  END IF;
END $$;


-- ============================================================
-- §3.4 — bookings constraint extensions for cargo
-- ============================================================

-- §3.4.1 — extended source_discriminator CHECK
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_source_discriminator_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bookings_source_discriminator_check'
       AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_source_discriminator_check
      CHECK (source_discriminator IN ('charter', 'empty_leg', 'cargo'));
  END IF;
END $$;

-- §3.4.2 — extended source_offer_check (round 1 P1 #1)
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_source_offer_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bookings_source_offer_check'
       AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_source_offer_check CHECK (
        source_offer_table IN ('phase4', 'phase5', 'phase7_empty_leg', 'cargo_offers')
        OR source_offer_table IS NULL
      );
  END IF;
END $$;

-- §3.4.3 — widen bookings.operator_*_snapshot to source schema
-- (round 6 P1 #2). Non-breaking; affects Phase 6/9/10 + Phase 11.
ALTER TABLE bookings
  ALTER COLUMN operator_name_snapshot TYPE VARCHAR(200),
  ALTER COLUMN operator_email_snapshot TYPE VARCHAR(255);


-- ============================================================
-- §3.5 — cargo_aircraft_capabilities table + indexes + RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS cargo_aircraft_capabilities (
  aircraft_id UUID PRIMARY KEY
    REFERENCES aircraft(id) ON DELETE CASCADE,
  supports_horse BOOLEAN NOT NULL DEFAULT false,
  supports_luxury_car BOOLEAN NOT NULL DEFAULT false,
  supports_valuables BOOLEAN NOT NULL DEFAULT false,
  supports_other BOOLEAN NOT NULL DEFAULT false,

  -- Capacity hints (advisory; not enforced)
  max_horse_count INT,
  max_car_count INT,
  max_payload_kg DECIMAL(10, 2),

  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cargo_aircraft_capabilities_at_least_one_check CHECK (
    supports_horse OR supports_luxury_car OR supports_valuables OR supports_other
  )
);

CREATE INDEX IF NOT EXISTS idx_cargo_aircraft_caps_horse
  ON cargo_aircraft_capabilities (aircraft_id) WHERE supports_horse;
CREATE INDEX IF NOT EXISTS idx_cargo_aircraft_caps_car
  ON cargo_aircraft_capabilities (aircraft_id) WHERE supports_luxury_car;
CREATE INDEX IF NOT EXISTS idx_cargo_aircraft_caps_valuables
  ON cargo_aircraft_capabilities (aircraft_id) WHERE supports_valuables;
CREATE INDEX IF NOT EXISTS idx_cargo_aircraft_caps_other
  ON cargo_aircraft_capabilities (aircraft_id) WHERE supports_other;

-- Round 6 P1 #3 — RLS on cargo_aircraft_capabilities.
ALTER TABLE cargo_aircraft_capabilities ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.6 — cargo_email_alert_status singleton + RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS cargo_email_alert_status (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'config_missing', 'send_failed')),
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cargo_email_alert_status (id, status)
  VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE cargo_email_alert_status ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §4.1 — create_cargo_request_guest RPC (NEW)
-- ============================================================

CREATE OR REPLACE FUNCTION create_cargo_request_guest(
  p_payload JSONB,
  p_ip      INET
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_request_id UUID;
  v_request_number TEXT;
  v_cargo_type cargo_type;
BEGIN
  -- ip_required guard (Phase 9 convention #12)
  IF p_ip IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ip_required');
  END IF;

  -- Round 1 P1 #3 — text allowlist before ENUM cast.
  IF p_payload->>'cargo_type' IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'cargo_type_required');
  END IF;
  IF (p_payload->>'cargo_type') NOT IN ('horse', 'luxury_car', 'valuables', 'other') THEN
    RETURN json_build_object('ok', false, 'error', 'cargo_type_invalid');
  END IF;
  v_cargo_type := (p_payload->>'cargo_type')::cargo_type;

  -- Round 4 P1 #2 — required-field guards.
  IF NULLIF(TRIM(p_payload->>'customer_name'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_name_required');
  END IF;
  IF NULLIF(TRIM(p_payload->>'customer_phone'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_phone_required');
  END IF;
  IF NULLIF(p_payload->>'pickup_date', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'pickup_date_required');
  END IF;
  IF NULLIF(p_payload->>'estimated_value_sar', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'estimated_value_required');
  END IF;

  -- Round 5 P1 #2 — origin/destination required guards.
  IF NULLIF(TRIM(p_payload->>'origin_iata'), '') IS NULL
     AND NULLIF(TRIM(p_payload->>'origin_freeform'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'origin_required');
  END IF;
  IF NULLIF(TRIM(p_payload->>'destination_iata'), '') IS NULL
     AND NULLIF(TRIM(p_payload->>'destination_freeform'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'destination_required');
  END IF;

  -- Round 8 P1 #1 — DB-boundary length guards.
  IF length(p_payload->>'customer_name') > 120 THEN
    RETURN json_build_object('ok', false, 'error', 'customer_name_invalid');
  END IF;
  IF length(p_payload->>'customer_phone') > 20 THEN
    RETURN json_build_object('ok', false, 'error', 'customer_phone_invalid');
  END IF;
  IF p_payload->>'customer_email' IS NOT NULL
     AND length(p_payload->>'customer_email') > 120 THEN
    RETURN json_build_object('ok', false, 'error', 'customer_email_invalid');
  END IF;
  IF NULLIF(p_payload->>'origin_iata', '') IS NOT NULL
     AND length(p_payload->>'origin_iata') > 4 THEN
    RETURN json_build_object('ok', false, 'error', 'origin_invalid');
  END IF;
  IF NULLIF(p_payload->>'destination_iata', '') IS NOT NULL
     AND length(p_payload->>'destination_iata') > 4 THEN
    RETURN json_build_object('ok', false, 'error', 'destination_invalid');
  END IF;

  BEGIN
    INSERT INTO cargo_requests (
      client_id,
      customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
      cargo_type,
      origin_iata, origin_freeform,
      destination_iata, destination_freeform,
      pickup_date, delivery_date_target, flexibility_days,
      estimated_value_sar, insurance_required,
      handling_notes,
      horse_count, horse_groom_required,
      horse_cites_status, horse_stall_requirements,
      car_make, car_model, car_year,
      car_running_condition, car_enclosed_required,
      valuables_declared_value_sar, valuables_security_level,
      valuables_climate_controlled, valuables_item_description,
      other_description, other_dimensions_lwh_cm,
      other_weight_kg, other_special_handling
    ) VALUES (
      NULL,  -- guest path
      p_payload->>'customer_name',
      p_payload->>'customer_phone',
      NULLIF(p_payload->>'customer_email', ''),
      v_cargo_type,
      NULLIF(p_payload->>'origin_iata', ''),
      NULLIF(p_payload->>'origin_freeform', ''),
      NULLIF(p_payload->>'destination_iata', ''),
      NULLIF(p_payload->>'destination_freeform', ''),
      (p_payload->>'pickup_date')::DATE,
      NULLIF(p_payload->>'delivery_date_target', '')::DATE,
      -- Round 8 P2 #2 — NULLIF before cast for optional fields.
      COALESCE(NULLIF(p_payload->>'flexibility_days', '')::INT, 0),
      (p_payload->>'estimated_value_sar')::DECIMAL,
      COALESCE(NULLIF(p_payload->>'insurance_required', '')::BOOLEAN, false),
      NULLIF(p_payload->>'handling_notes', ''),
      -- horse
      NULLIF(p_payload->>'horse_count', '')::INT,
      NULLIF(p_payload->>'horse_groom_required', '')::BOOLEAN,
      NULLIF(p_payload->>'horse_cites_status', ''),
      NULLIF(p_payload->>'horse_stall_requirements', ''),
      -- luxury_car
      NULLIF(p_payload->>'car_make', ''),
      NULLIF(p_payload->>'car_model', ''),
      NULLIF(p_payload->>'car_year', '')::INT,
      NULLIF(p_payload->>'car_running_condition', '')::BOOLEAN,
      NULLIF(p_payload->>'car_enclosed_required', '')::BOOLEAN,
      -- valuables
      NULLIF(p_payload->>'valuables_declared_value_sar', '')::DECIMAL,
      NULLIF(p_payload->>'valuables_security_level', ''),
      NULLIF(p_payload->>'valuables_climate_controlled', '')::BOOLEAN,
      NULLIF(p_payload->>'valuables_item_description', ''),
      -- other
      NULLIF(p_payload->>'other_description', ''),
      NULLIF(p_payload->>'other_dimensions_lwh_cm', ''),
      NULLIF(p_payload->>'other_weight_kg', '')::DECIMAL,
      NULLIF(p_payload->>'other_special_handling', '')
    )
    RETURNING id, cargo_request_number INTO v_request_id, v_request_number;
  EXCEPTION
    WHEN check_violation THEN
      -- Round 3 P2 #4 — disambiguate value/date CHECKs from generic.
      DECLARE
        v_constraint_name TEXT;
      BEGIN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name = 'cargo_requests_value_positive_check' THEN
          RETURN json_build_object('ok', false, 'error', 'value_invalid');
        ELSIF v_constraint_name = 'cargo_requests_date_order_check' THEN
          RETURN json_build_object('ok', false, 'error', 'date_invalid');
        END IF;
        RETURN json_build_object('ok', false, 'error', 'validation_failed');
      END;
    WHEN invalid_text_representation THEN
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
    WHEN invalid_datetime_format THEN
      -- Round 7 P1 #1 — sqlstate 22007.
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
    WHEN numeric_value_out_of_range THEN
      -- Round 9 P2 #1 — sqlstate 22003.
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
  END;

  RETURN json_build_object(
    'ok', true,
    'cargo_request_id', v_request_id,
    'cargo_request_number', v_request_number,
    'created_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION create_cargo_request_guest(JSONB, INET)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_cargo_request_guest(JSONB, INET)
  TO service_role;


-- ============================================================
-- §4.2 — create_cargo_request_authenticated RPC (NEW)
-- ============================================================

CREATE OR REPLACE FUNCTION create_cargo_request_authenticated(
  p_client_id UUID,
  p_payload   JSONB,
  p_ip        INET
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_row RECORD;
  v_request_id UUID;
  v_request_number TEXT;
  v_cargo_type cargo_type;
BEGIN
  IF p_ip IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ip_required');
  END IF;

  SELECT id, full_name, contact_phone, auth_email, signup_status
    INTO v_client_row
    FROM clients
   WHERE id = p_client_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  IF v_client_row.signup_status <> 'active' THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_active');
  END IF;

  IF p_payload->>'cargo_type' IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'cargo_type_required');
  END IF;
  IF (p_payload->>'cargo_type') NOT IN ('horse', 'luxury_car', 'valuables', 'other') THEN
    RETURN json_build_object('ok', false, 'error', 'cargo_type_invalid');
  END IF;
  v_cargo_type := (p_payload->>'cargo_type')::cargo_type;

  -- Required-field guards (customer fields from clients; only
  -- pickup_date + estimated_value_sar from payload).
  IF NULLIF(p_payload->>'pickup_date', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'pickup_date_required');
  END IF;
  IF NULLIF(p_payload->>'estimated_value_sar', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'estimated_value_required');
  END IF;
  IF NULLIF(TRIM(p_payload->>'origin_iata'), '') IS NULL
     AND NULLIF(TRIM(p_payload->>'origin_freeform'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'origin_required');
  END IF;
  IF NULLIF(TRIM(p_payload->>'destination_iata'), '') IS NULL
     AND NULLIF(TRIM(p_payload->>'destination_freeform'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'destination_required');
  END IF;

  -- Round 8 P1 #1 — IATA length guards (customer fields from clients
  -- already enforce VARCHAR(120/20/120)).
  IF NULLIF(p_payload->>'origin_iata', '') IS NOT NULL
     AND length(p_payload->>'origin_iata') > 4 THEN
    RETURN json_build_object('ok', false, 'error', 'origin_invalid');
  END IF;
  IF NULLIF(p_payload->>'destination_iata', '') IS NOT NULL
     AND length(p_payload->>'destination_iata') > 4 THEN
    RETURN json_build_object('ok', false, 'error', 'destination_invalid');
  END IF;

  BEGIN
    INSERT INTO cargo_requests (
      client_id,
      customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
      cargo_type,
      origin_iata, origin_freeform,
      destination_iata, destination_freeform,
      pickup_date, delivery_date_target, flexibility_days,
      estimated_value_sar, insurance_required,
      handling_notes,
      horse_count, horse_groom_required,
      horse_cites_status, horse_stall_requirements,
      car_make, car_model, car_year,
      car_running_condition, car_enclosed_required,
      valuables_declared_value_sar, valuables_security_level,
      valuables_climate_controlled, valuables_item_description,
      other_description, other_dimensions_lwh_cm,
      other_weight_kg, other_special_handling
    ) VALUES (
      v_client_row.id,
      v_client_row.full_name,
      v_client_row.contact_phone,
      v_client_row.auth_email,
      v_cargo_type,
      NULLIF(p_payload->>'origin_iata', ''),
      NULLIF(p_payload->>'origin_freeform', ''),
      NULLIF(p_payload->>'destination_iata', ''),
      NULLIF(p_payload->>'destination_freeform', ''),
      (p_payload->>'pickup_date')::DATE,
      NULLIF(p_payload->>'delivery_date_target', '')::DATE,
      COALESCE(NULLIF(p_payload->>'flexibility_days', '')::INT, 0),
      (p_payload->>'estimated_value_sar')::DECIMAL,
      COALESCE(NULLIF(p_payload->>'insurance_required', '')::BOOLEAN, false),
      NULLIF(p_payload->>'handling_notes', ''),
      NULLIF(p_payload->>'horse_count', '')::INT,
      NULLIF(p_payload->>'horse_groom_required', '')::BOOLEAN,
      NULLIF(p_payload->>'horse_cites_status', ''),
      NULLIF(p_payload->>'horse_stall_requirements', ''),
      NULLIF(p_payload->>'car_make', ''),
      NULLIF(p_payload->>'car_model', ''),
      NULLIF(p_payload->>'car_year', '')::INT,
      NULLIF(p_payload->>'car_running_condition', '')::BOOLEAN,
      NULLIF(p_payload->>'car_enclosed_required', '')::BOOLEAN,
      NULLIF(p_payload->>'valuables_declared_value_sar', '')::DECIMAL,
      NULLIF(p_payload->>'valuables_security_level', ''),
      NULLIF(p_payload->>'valuables_climate_controlled', '')::BOOLEAN,
      NULLIF(p_payload->>'valuables_item_description', ''),
      NULLIF(p_payload->>'other_description', ''),
      NULLIF(p_payload->>'other_dimensions_lwh_cm', ''),
      NULLIF(p_payload->>'other_weight_kg', '')::DECIMAL,
      NULLIF(p_payload->>'other_special_handling', '')
    )
    RETURNING id, cargo_request_number INTO v_request_id, v_request_number;
  EXCEPTION
    WHEN check_violation THEN
      DECLARE
        v_constraint_name TEXT;
      BEGIN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name = 'cargo_requests_value_positive_check' THEN
          RETURN json_build_object('ok', false, 'error', 'value_invalid');
        ELSIF v_constraint_name = 'cargo_requests_date_order_check' THEN
          RETURN json_build_object('ok', false, 'error', 'date_invalid');
        END IF;
        RETURN json_build_object('ok', false, 'error', 'validation_failed');
      END;
    WHEN invalid_text_representation THEN
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
    WHEN invalid_datetime_format THEN
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
    WHEN numeric_value_out_of_range THEN
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
  END;

  RETURN json_build_object(
    'ok', true,
    'cargo_request_id', v_request_id,
    'cargo_request_number', v_request_number,
    'client_id', v_client_row.id,
    'created_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION create_cargo_request_authenticated(UUID, JSONB, INET)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_cargo_request_authenticated(UUID, JSONB, INET)
  TO service_role;


-- ============================================================
-- §4.3 — submit_cargo_offer RPC (NEW)
-- ============================================================

CREATE OR REPLACE FUNCTION submit_cargo_offer(
  p_operator_id      UUID,
  p_cargo_request_id UUID,
  p_payload          JSONB
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_op_row RECORD;
  v_req_row RECORD;
  v_offer_id UUID;
  v_aircraft_id UUID;
BEGIN
  -- Round 1 P1 #2 — operators.company_name (NOT business_name).
  SELECT id, company_name, contact_phone, contact_email, signup_status
    INTO v_op_row
    FROM operators
   WHERE id = p_operator_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;
  IF v_op_row.signup_status <> 'approved' THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_approved');
  END IF;

  SELECT id, status, cargo_type, expires_at
    INTO v_req_row
    FROM cargo_requests
   WHERE id = p_cargo_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;
  IF v_req_row.status NOT IN ('pending', 'offers_received') THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_open');
  END IF;
  IF v_req_row.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'request_expired');
  END IF;

  -- Round 1 P1 #4 + round 2 P1 #1 — aircraft_id required + UUID safety.
  IF p_payload->>'aircraft_id' IS NULL
     OR p_payload->>'aircraft_id' = '' THEN
    RETURN json_build_object('ok', false, 'error', 'aircraft_id_required');
  END IF;

  BEGIN
    v_aircraft_id := (p_payload->>'aircraft_id')::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN json_build_object('ok', false, 'error', 'aircraft_id_invalid');
  END;

  -- Aircraft capability check (Decision #7 + round 1 P1 #4).
  PERFORM 1 FROM cargo_aircraft_capabilities cac
    JOIN aircraft a ON a.id = cac.aircraft_id
   WHERE cac.aircraft_id = v_aircraft_id
     AND a.operator_id = p_operator_id
     AND CASE v_req_row.cargo_type
           WHEN 'horse'       THEN cac.supports_horse
           WHEN 'luxury_car'  THEN cac.supports_luxury_car
           WHEN 'valuables'   THEN cac.supports_valuables
           WHEN 'other'       THEN cac.supports_other
         END;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'aircraft_not_capable');
  END IF;

  -- Round 4 P1 #3 — required offer fields guards.
  IF NULLIF(p_payload->>'base_price_sar', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'base_price_required');
  END IF;
  IF NULLIF(p_payload->>'proposed_pickup_date', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'proposed_pickup_date_required');
  END IF;
  IF NULLIF(p_payload->>'proposed_delivery_date', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'proposed_delivery_date_required');
  END IF;

  BEGIN
    INSERT INTO cargo_offers (
      cargo_request_id, operator_id, aircraft_id,
      operator_name_snapshot, operator_phone_snapshot,
      operator_email_snapshot, aircraft_snapshot,
      base_price_sar, insurance_price_sar, customs_handling_price_sar,
      proposed_pickup_date, proposed_delivery_date,
      operator_notes
    ) VALUES (
      p_cargo_request_id, p_operator_id, v_aircraft_id,
      v_op_row.company_name, v_op_row.contact_phone, v_op_row.contact_email,
      NULLIF(p_payload->>'aircraft_snapshot', ''),
      (p_payload->>'base_price_sar')::DECIMAL,
      COALESCE(NULLIF(p_payload->>'insurance_price_sar', '')::DECIMAL, 0),
      COALESCE(NULLIF(p_payload->>'customs_handling_price_sar', '')::DECIMAL, 0),
      (p_payload->>'proposed_pickup_date')::DATE,
      (p_payload->>'proposed_delivery_date')::DATE,
      NULLIF(p_payload->>'operator_notes', '')
    )
    RETURNING id INTO v_offer_id;
  EXCEPTION
    WHEN check_violation THEN
      -- Round 2 P1 #2 — disambiguate price CHECKs from date-order.
      DECLARE
        v_constraint_name TEXT;
      BEGIN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name IN (
          'cargo_offers_base_price_positive_check',
          'cargo_offers_insurance_price_nonneg_check',
          'cargo_offers_customs_handling_nonneg_check'
        ) THEN
          RETURN json_build_object('ok', false, 'error', 'price_invalid');
        END IF;
        RETURN json_build_object('ok', false, 'error', 'validation_failed');
      END;
    WHEN invalid_text_representation THEN
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
    WHEN invalid_datetime_format THEN
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
    WHEN numeric_value_out_of_range THEN
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
  END;

  -- Flip request status to 'offers_received' if it was 'pending'
  UPDATE cargo_requests
     SET status = 'offers_received',
         updated_at = NOW()
   WHERE id = p_cargo_request_id
     AND status = 'pending';

  RETURN json_build_object(
    'ok', true,
    'offer_id', v_offer_id,
    'cargo_request_id', p_cargo_request_id,
    'operator_id', p_operator_id
  );
END;
$$;

REVOKE ALL ON FUNCTION submit_cargo_offer(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_cargo_offer(UUID, UUID, JSONB)
  TO service_role;


-- ============================================================
-- END OF PR 1 MIGRATION
--
-- Post-migration shape (Probe 28 verifies all 30 checks):
--   - 4 new tables: cargo_requests, cargo_offers,
--     cargo_aircraft_capabilities, cargo_email_alert_status
--   - 3 new ENUMs: cargo_type, cargo_request_status, cargo_offer_status
--   - 3 new RPCs: create_cargo_request_guest,
--     create_cargo_request_authenticated, submit_cargo_offer
--   - bookings constraints extended (source_discriminator +
--     source_offer_check) + bookings.operator_*_snapshot widened
--   - RLS enabled on all 4 new cargo tables
--   - 11 named CHECK constraints + 1 named FK + 1 invariant CHECK
--   - 11 indexes (3 cargo_requests + 3 cargo_offers + 4 capabilities + 1 implicit)
-- ============================================================
