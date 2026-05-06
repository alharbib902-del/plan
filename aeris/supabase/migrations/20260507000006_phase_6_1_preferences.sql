-- ============================================================
-- Phase 6.1 — Customer Preferences (PR 1)
--
-- Three additive changes, all idempotent (safe to re-run):
--
--   1. lead_inquiries.preferences JSONB NOT NULL DEFAULT '{}'
--      ADD COLUMN IF NOT EXISTS. Captures customer-provided
--      structured preferences submitted on /request, so they
--      round-trip into the admin promote panel pre-filled.
--      Existing rows get '{}' automatically.
--
--   2. promote_lead_to_trip_request — NEW 6-arg canonical
--      signature with `p_preferences JSONB` parameter, plus
--      the existing 5-arg signature rewritten as a
--      compatibility wrapper that delegates to the 6-arg
--      function with `'{}'::jsonb` for the missing
--      preferences. Per Phase 6.1 spec iteration 4 S6.2
--      (Codex iteration-2 P1 fix): the 5-arg signature MUST
--      stay alive across the PR 1 → founder-probe → PR 2
--      deploy window because the running production admin
--      code still calls 5-arg until PR 2 ships.
--
--      The 6-arg body merges p_preferences with the legacy
--      `lead_trip_type` injection that admin/operator UI has
--      depended on since Phase 4. The merge expression
--      `COALESCE(p_preferences, '{}'::jsonb) ||
--       jsonb_build_object('lead_trip_type', p_lead_trip_type)`
--      ensures the legacy key is preserved verbatim AND any
--      caller-supplied preference keys land alongside it.
--
--   3. The 5-arg signature is NOT dropped in PR 1. It stays
--      as a documented compatibility wrapper. An optional
--      future PR 3 cleanup can drop it after PR 2 ships and
--      grep confirms zero callers — see the Phase 6.1 spec
--      Implementation order section "Optional PR 3 — drop
--      the 5-arg compatibility wrapper".
--
-- Carried forward unchanged from Phase 6.0 PR 1 in the 6-arg
-- canonical body:
--   - Lead-row FOR UPDATE lock.
--   - Status whitelist ('new' / 'contacted' / 'quoted').
--   - Defensive JSONB array handling for p_legs (nested
--     `IF jsonb_typeof = 'array'` so jsonb_array_length never
--     runs on a non-array — Codex P2 fix on Phase 6.0 PR #15).
--   - IATA derivation for departure_airport / arrival_airport.
--   - lead_inquiries.status flip + converted_at stamp.
--   - SECURITY DEFINER + SET search_path = public, pg_temp on
--     both signatures.
--   - REVOKE ALL ... FROM PUBLIC, anon, authenticated +
--     GRANT EXECUTE ... TO service_role on both signatures.
-- ============================================================

-- ------------------------------------------------------------
-- 1. lead_inquiries: add preferences column.
-- ------------------------------------------------------------

ALTER TABLE lead_inquiries
  ADD COLUMN IF NOT EXISTS preferences JSONB
    NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN lead_inquiries.preferences IS
  'Phase 6.1: structured customer preferences submitted on /request. JSONB shape governed by lib/validators/trip-preferences.ts (TripPreferences type). NOT NULL DEFAULT ''{}''::jsonb so existing rows get empty object automatically and new code never has to null-check. The canonical storage rule (per spec): no preference expressed = key OMITTED from this object. null is never stored by app writers.';

-- ------------------------------------------------------------
-- 2. promote_lead_to_trip_request — NEW 6-arg canonical.
--
-- Body merges p_preferences with the legacy lead_trip_type
-- injection. CREATE OR REPLACE is safe to re-run on the same
-- body. The REVOKE/GRANT block on this signature is fresh
-- (the 6-arg signature did not exist before this migration).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION promote_lead_to_trip_request(
  p_lead_id              UUID,
  p_legs                 JSONB,
  p_aircraft_category    aircraft_category,
  p_special_requests     TEXT,
  p_lead_trip_type       TEXT,
  p_preferences          JSONB
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead                 RECORD;
  v_now                  TIMESTAMPTZ := NOW();
  v_trip_id              UUID;
  v_legs_len             INTEGER := 0;
  v_departure_iata       TEXT;
  v_arrival_iata         TEXT;
  -- Phase 6.1: merged preferences = caller-supplied object
  -- || legacy lead_trip_type key. Built once, used once in
  -- the INSERT column list below.
  v_merged_preferences   JSONB;
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

  -- Phase 6.0: derive trip_requests.departure_airport /
  -- arrival_airport from p_legs. Nested IF so
  -- jsonb_array_length never runs on a non-array payload.
  IF jsonb_typeof(p_legs) = 'array' THEN
    v_legs_len := jsonb_array_length(p_legs);
    IF v_legs_len > 0 THEN
      SELECT iata_code INTO v_departure_iata
        FROM airports
        WHERE iata_code = upper(NULLIF(p_legs->0->>'from', ''));

      SELECT iata_code INTO v_arrival_iata
        FROM airports
        WHERE iata_code = upper(NULLIF(
          p_legs->(v_legs_len - 1)->>'to', ''));
    END IF;
  END IF;

  -- Phase 6.1: merge p_preferences with legacy lead_trip_type
  -- injection. COALESCE handles a NULL p_preferences gracefully
  -- (treats it as an empty object). The || operator on JSONB
  -- merges right-to-left when keys collide, so a caller who
  -- (incorrectly) supplies a `lead_trip_type` key in
  -- p_preferences gets it overwritten by the canonical value
  -- derived from p_lead_trip_type.
  v_merged_preferences := COALESCE(p_preferences, '{}'::jsonb)
    || jsonb_build_object('lead_trip_type', p_lead_trip_type);

  INSERT INTO trip_requests (
    client_id, customer_name, customer_phone, customer_source,
    trip_type, legs,
    departure_airport, arrival_airport,
    departure_date, return_date, passengers_count,
    aircraft_category_preference, special_requests,
    preferences, status
  ) VALUES (
    NULL,
    v_lead.customer_name, v_lead.customer_phone, 'lead',
    'charter', p_legs,
    v_departure_iata, v_arrival_iata,
    v_lead.departure_date::timestamptz,
    v_lead.return_date::timestamptz,
    v_lead.passengers,
    p_aircraft_category, p_special_requests,
    v_merged_preferences,
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
  UUID, JSONB, aircraft_category, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION promote_lead_to_trip_request(
  UUID, JSONB, aircraft_category, TEXT, TEXT, JSONB
) TO service_role;

-- ------------------------------------------------------------
-- 3. promote_lead_to_trip_request — 5-arg compatibility wrapper.
--
-- The 5-arg signature existed since Phase 4 PR #6 (with the
-- original Phase 4 body) and was last updated in Phase 6.0 PR 1
-- (the IATA-aware body). This migration REPLACES the 5-arg
-- body with a thin delegation to the new 6-arg function with
-- '{}'::jsonb for the missing p_preferences. The running
-- production admin code (which still calls this 5-arg
-- signature until PR 2 deploys) continues to work — its
-- behavior is unchanged because the merged preferences with
-- empty p_preferences resolves to the same
-- `{ lead_trip_type: ... }` shape Phase 6.0 PR 1 produced.
--
-- CREATE OR REPLACE preserves existing privileges; the
-- REVOKE/GRANT block below is restated for `git blame`
-- clarity (same posture as Phase 4 PR #6 + Phase 6.0 PR 1).
--
-- An optional future PR 3 cleanup can DROP this signature
-- after PR 2 ships and grep confirms zero callers — see the
-- Phase 6.1 spec Implementation order section "Optional PR 3
-- — drop the 5-arg compatibility wrapper".
-- ------------------------------------------------------------

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
BEGIN
  -- Phase 6.1 compatibility wrapper. Delegates to the 6-arg
  -- canonical signature with empty preferences. Kept alive so
  -- the running production admin code continues to work
  -- between PR 1 merge and PR 2 deploy.
  RETURN promote_lead_to_trip_request(
    p_lead_id,
    p_legs,
    p_aircraft_category,
    p_special_requests,
    p_lead_trip_type,
    '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION promote_lead_to_trip_request(
  UUID, JSONB, aircraft_category, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION promote_lead_to_trip_request(
  UUID, JSONB, aircraft_category, TEXT, TEXT
) TO service_role;

-- ============================================================
-- END OF MIGRATION
--
-- Post-migration shape (founder probe #2 verifies):
--   TWO overloads of promote_lead_to_trip_request, both named
--   identically:
--     - 5-arg (compatibility wrapper, delegates with '{}')
--     - 6-arg (canonical, accepts p_preferences)
--   Both SECURITY DEFINER + search_path pinned + service_role-
--   only EXECUTE.
-- ============================================================
