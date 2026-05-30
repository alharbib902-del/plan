-- ============================================
-- AERIS — Operator crew management (#8 PR2: crew_members CRUD)
-- Migration: 20260531000009  (forward-only)
-- ============================================
-- Lets an operator manage THEIR OWN crew_members: list / create /
-- update / set-availability. There is NO delete (per scope) — crew are
-- toggled unavailable, never removed.
--
-- SAFETY: `crew_members` already has RLS ENABLED with NO policies
-- (deny-all) and no table grants, and is currently DORMANT (no app/RPC
-- reads or writes; `offers.crew_ids` is an unused placeholder, medevac
-- uses a freeform medical_team_snapshot — neither touches this table).
-- This migration **does NOT change the table, its RLS, or its grants** —
-- it only ADDS four operator-scoped SECURITY DEFINER RPCs
-- (service_role-only). No schema change needed (is_available already
-- exists as the availability flag).
--
-- Ownership: every RPC takes p_operator_id (from the operator SESSION in
-- the Server Action, never client input) and scopes by
-- `operator_id = p_operator_id`.

-- ---- §1 RPC: list_operator_crew ---------------------------------------------
CREATE OR REPLACE FUNCTION list_operator_crew(p_operator_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'full_name', full_name,
      'role', role,
      'nationality', nationality,
      'languages', to_jsonb(languages),
      'specializations', to_jsonb(specializations),
      'experience_hours', experience_hours,
      'license_number', license_number,
      'license_expiry', license_expiry,
      'extra_fee', extra_fee,
      'is_available', is_available,
      'created_at', created_at
    )
    -- Available first, then newest.
    ORDER BY (NOT is_available), created_at DESC
  ), '[]'::jsonb)
  FROM crew_members
  WHERE operator_id = p_operator_id;
$$;

-- ---- §2 shared validation helper (returns error code or NULL) ---------------
-- Validates the editable crew fields in p_payload. Returns a text error
-- code on failure, or NULL when valid. Used by create + update so the
-- rules never drift between them.
CREATE OR REPLACE FUNCTION _validate_crew_payload(p_payload JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_role  TEXT := p_payload->>'role';
  v_fee   NUMERIC;
  v_hours INT;
BEGIN
  IF trim(COALESCE(p_payload->>'full_name', '')) = '' THEN
    RETURN 'full_name_required';
  END IF;
  IF length(trim(p_payload->>'full_name')) > 200 THEN
    RETURN 'full_name_too_long';
  END IF;
  IF v_role IS NULL
     OR v_role NOT IN ('captain', 'first_officer', 'flight_attendant') THEN
    RETURN 'role_invalid';
  END IF;

  v_fee := NULLIF(p_payload->>'extra_fee', '')::NUMERIC;
  IF v_fee IS NOT NULL AND (v_fee < 0 OR v_fee > 1000000) THEN
    RETURN 'extra_fee_invalid';
  END IF;

  v_hours := NULLIF(p_payload->>'experience_hours', '')::INT;
  IF v_hours IS NOT NULL AND (v_hours < 0 OR v_hours > 100000) THEN
    RETURN 'experience_hours_invalid';
  END IF;

  -- license_expiry: cast probes validity (caught by the caller's handler).
  PERFORM NULLIF(p_payload->>'license_expiry', '')::DATE;

  RETURN NULL;
END;
$$;

-- Converts a jsonb array (or absent/non-array) into a clean text[].
CREATE OR REPLACE FUNCTION _crew_text_array(p_value JSONB)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_value) = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_value))
    ELSE ARRAY[]::TEXT[]
  END;
$$;

-- ---- §3 RPC: create_operator_crew -------------------------------------------
CREATE OR REPLACE FUNCTION create_operator_crew(
  p_operator_id UUID,
  p_payload     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_err     TEXT;
  v_crew_id UUID;
BEGIN
  v_err := _validate_crew_payload(p_payload);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_err);
  END IF;

  INSERT INTO crew_members (
    operator_id, full_name, role, nationality, languages, specializations,
    experience_hours, license_number, license_expiry, extra_fee, is_available
  ) VALUES (
    p_operator_id,
    trim(p_payload->>'full_name'),
    (p_payload->>'role')::crew_role,
    NULLIF(trim(COALESCE(p_payload->>'nationality', '')), ''),
    _crew_text_array(p_payload->'languages'),
    _crew_text_array(p_payload->'specializations'),
    COALESCE(NULLIF(p_payload->>'experience_hours', '')::INT, 0),
    NULLIF(trim(COALESCE(p_payload->>'license_number', '')), ''),
    NULLIF(p_payload->>'license_expiry', '')::DATE,
    COALESCE(NULLIF(p_payload->>'extra_fee', '')::NUMERIC, 0),
    true
  ) RETURNING id INTO v_crew_id;

  RETURN jsonb_build_object('ok', true, 'crew_id', v_crew_id);
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range
       OR datetime_field_overflow OR invalid_datetime_format THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_field_format');
END;
$$;

-- ---- §4 RPC: update_operator_crew -------------------------------------------
-- Edits an owned crew member's descriptive fields. Availability is a
-- separate RPC (set_operator_crew_availability).
CREATE OR REPLACE FUNCTION update_operator_crew(
  p_operator_id UUID,
  p_crew_id     UUID,
  p_payload     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_err  TEXT;
  v_rows INT;
BEGIN
  v_err := _validate_crew_payload(p_payload);
  IF v_err IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_err);
  END IF;

  UPDATE crew_members SET
    full_name        = trim(p_payload->>'full_name'),
    role             = (p_payload->>'role')::crew_role,
    nationality      = NULLIF(trim(COALESCE(p_payload->>'nationality', '')), ''),
    languages        = _crew_text_array(p_payload->'languages'),
    specializations  = _crew_text_array(p_payload->'specializations'),
    experience_hours = COALESCE(NULLIF(p_payload->>'experience_hours', '')::INT, 0),
    license_number   = NULLIF(trim(COALESCE(p_payload->>'license_number', '')), ''),
    license_expiry   = NULLIF(p_payload->>'license_expiry', '')::DATE,
    extra_fee        = COALESCE(NULLIF(p_payload->>'extra_fee', '')::NUMERIC, 0)
  WHERE id = p_crew_id AND operator_id = p_operator_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crew_not_found_or_not_owned');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range
       OR datetime_field_overflow OR invalid_datetime_format THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_field_format');
END;
$$;

-- ---- §5 RPC: set_operator_crew_availability ---------------------------------
CREATE OR REPLACE FUNCTION set_operator_crew_availability(
  p_operator_id  UUID,
  p_crew_id      UUID,
  p_is_available BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  IF p_is_available IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'availability_invalid');
  END IF;

  UPDATE crew_members SET is_available = p_is_available
  WHERE id = p_crew_id AND operator_id = p_operator_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crew_not_found_or_not_owned');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ---- §6 Grants — service_role ONLY ------------------------------------------
REVOKE ALL ON FUNCTION list_operator_crew(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION list_operator_crew(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION _validate_crew_payload(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION _validate_crew_payload(JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION _crew_text_array(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION _crew_text_array(JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION create_operator_crew(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_operator_crew(UUID, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION update_operator_crew(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_operator_crew(UUID, UUID, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION set_operator_crew_availability(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_operator_crew_availability(UUID, UUID, BOOLEAN)
  TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
