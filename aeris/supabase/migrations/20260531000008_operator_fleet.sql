-- ============================================
-- AERIS — Operator fleet management (PR1: aircraft CRUD)
-- Migration: 20260531000008  (forward-only)
-- ============================================
-- Lets an operator manage THEIR OWN aircraft: list / create / update /
-- retire (soft delete via status='retired'). PR2 will add crew.
--
-- SAFETY: the `aircraft` table is shared (read by cargo/medevac/empty-leg
-- RPCs). It already has RLS ENABLED with NO policies (deny-all) and no
-- table grants — every existing access is via SECURITY DEFINER RPCs that
-- run as the owner and bypass RLS. This migration follows that exact
-- pattern and **does NOT touch the table, its RLS, or its grants** — it
-- only ADDS four operator-scoped SECURITY DEFINER RPCs (service_role-only).
-- No schema change is needed: aircraft_status already includes 'retired'.
--
-- Ownership: every RPC takes p_operator_id (derived from the operator
-- SESSION in the Server Action, never client input) and scopes by
-- `operator_id = p_operator_id`. The aircraft.operator_id FK guarantees
-- inserts attach to a real operator.

-- ---- §1 RPC: list_operator_aircraft -----------------------------------------
CREATE OR REPLACE FUNCTION list_operator_aircraft(p_operator_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'registration', registration,
      'manufacturer', manufacturer,
      'model', model,
      'category', category,
      'year', year,
      'max_passengers', max_passengers,
      'max_range_km', max_range_km,
      'base_hourly_rate', base_hourly_rate,
      'is_cargo_capable', is_cargo_capable,
      'is_medevac_capable', is_medevac_capable,
      'status', status,
      'created_at', created_at
    )
    -- Active/maintenance first, retired last; then stable by registration.
    ORDER BY (status = 'retired'), registration
  ), '[]'::jsonb)
  FROM aircraft
  WHERE operator_id = p_operator_id;
$$;

-- ---- §2 RPC: create_operator_aircraft ---------------------------------------
CREATE OR REPLACE FUNCTION create_operator_aircraft(
  p_operator_id UUID,
  p_payload     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registration TEXT;
  v_manufacturer TEXT;
  v_model        TEXT;
  v_category     TEXT;
  v_year         INT;
  v_max_pax      INT;
  v_max_range    INT;
  v_rate         NUMERIC;
  v_aircraft_id  UUID;
BEGIN
  v_registration := upper(trim(COALESCE(p_payload->>'registration', '')));
  v_manufacturer := trim(COALESCE(p_payload->>'manufacturer', ''));
  v_model        := trim(COALESCE(p_payload->>'model', ''));
  v_category     := p_payload->>'category';

  IF v_registration = '' OR length(v_registration) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'registration_invalid');
  END IF;
  IF v_manufacturer = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manufacturer_required');
  END IF;
  IF v_model = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'model_required');
  END IF;
  IF v_category IS NULL
     OR v_category NOT IN ('light', 'mid', 'super_mid', 'heavy', 'long_range') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'category_invalid');
  END IF;

  v_max_pax := NULLIF(p_payload->>'max_passengers', '')::INT;
  IF v_max_pax IS NULL OR v_max_pax <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_passengers_invalid');
  END IF;

  v_rate := NULLIF(p_payload->>'base_hourly_rate', '')::NUMERIC;
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'base_hourly_rate_invalid');
  END IF;

  v_year := NULLIF(p_payload->>'year', '')::INT;
  IF v_year IS NOT NULL
     AND (v_year < 1960 OR v_year > EXTRACT(YEAR FROM NOW())::INT + 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'year_invalid');
  END IF;

  v_max_range := NULLIF(p_payload->>'max_range_km', '')::INT;
  IF v_max_range IS NOT NULL AND v_max_range <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_range_invalid');
  END IF;

  BEGIN
    INSERT INTO aircraft (
      operator_id, registration, manufacturer, model, category, year,
      max_passengers, max_range_km, base_hourly_rate,
      is_cargo_capable, is_medevac_capable, status
    ) VALUES (
      p_operator_id, v_registration, v_manufacturer, v_model,
      v_category::aircraft_category, v_year,
      v_max_pax, v_max_range, v_rate,
      COALESCE((p_payload->>'is_cargo_capable')::boolean, false),
      COALESCE((p_payload->>'is_medevac_capable')::boolean, false),
      'active'
    ) RETURNING id INTO v_aircraft_id;
  EXCEPTION WHEN unique_violation THEN
    -- registration is UNIQUE across ALL operators.
    RETURN jsonb_build_object('ok', false, 'error', 'registration_taken');
  END;

  RETURN jsonb_build_object('ok', true, 'aircraft_id', v_aircraft_id);
END;
$$;

-- ---- §3 RPC: update_operator_aircraft ---------------------------------------
-- Edits an owned, non-retired aircraft. registration is immutable here.
-- status may move between active/maintenance only; 'retired' is set via the
-- dedicated retire RPC. amenities/cabin_config are left untouched in PR1.
CREATE OR REPLACE FUNCTION update_operator_aircraft(
  p_operator_id UUID,
  p_aircraft_id UUID,
  p_payload     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manufacturer TEXT;
  v_model        TEXT;
  v_category     TEXT;
  v_status       TEXT;
  v_year         INT;
  v_max_pax      INT;
  v_max_range    INT;
  v_rate         NUMERIC;
  v_rows         INT;
BEGIN
  v_manufacturer := trim(COALESCE(p_payload->>'manufacturer', ''));
  v_model        := trim(COALESCE(p_payload->>'model', ''));
  v_category     := p_payload->>'category';
  v_status       := COALESCE(p_payload->>'status', 'active');

  IF v_manufacturer = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manufacturer_required');
  END IF;
  IF v_model = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'model_required');
  END IF;
  IF v_category IS NULL
     OR v_category NOT IN ('light', 'mid', 'super_mid', 'heavy', 'long_range') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'category_invalid');
  END IF;
  IF v_status NOT IN ('active', 'maintenance') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'status_invalid');
  END IF;

  v_max_pax := NULLIF(p_payload->>'max_passengers', '')::INT;
  IF v_max_pax IS NULL OR v_max_pax <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_passengers_invalid');
  END IF;

  v_rate := NULLIF(p_payload->>'base_hourly_rate', '')::NUMERIC;
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'base_hourly_rate_invalid');
  END IF;

  v_year := NULLIF(p_payload->>'year', '')::INT;
  IF v_year IS NOT NULL
     AND (v_year < 1960 OR v_year > EXTRACT(YEAR FROM NOW())::INT + 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'year_invalid');
  END IF;

  v_max_range := NULLIF(p_payload->>'max_range_km', '')::INT;
  IF v_max_range IS NOT NULL AND v_max_range <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_range_invalid');
  END IF;

  UPDATE aircraft SET
    manufacturer       = v_manufacturer,
    model              = v_model,
    category           = v_category::aircraft_category,
    year               = v_year,
    max_passengers     = v_max_pax,
    max_range_km       = v_max_range,
    base_hourly_rate   = v_rate,
    is_cargo_capable   = COALESCE((p_payload->>'is_cargo_capable')::boolean, false),
    is_medevac_capable = COALESCE((p_payload->>'is_medevac_capable')::boolean, false),
    status             = v_status::aircraft_status
  WHERE id = p_aircraft_id
    AND operator_id = p_operator_id
    AND status <> 'retired';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_not_owned');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---- §4 RPC: retire_operator_aircraft (soft delete) -------------------------
CREATE OR REPLACE FUNCTION retire_operator_aircraft(
  p_operator_id UUID,
  p_aircraft_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE aircraft SET status = 'retired'
  WHERE id = p_aircraft_id
    AND operator_id = p_operator_id
    AND status <> 'retired';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found_or_not_owned');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---- §5 Grants — service_role ONLY ------------------------------------------
REVOKE ALL ON FUNCTION list_operator_aircraft(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION list_operator_aircraft(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION create_operator_aircraft(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_operator_aircraft(UUID, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION update_operator_aircraft(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_operator_aircraft(UUID, UUID, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION retire_operator_aircraft(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION retire_operator_aircraft(UUID, UUID)
  TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
