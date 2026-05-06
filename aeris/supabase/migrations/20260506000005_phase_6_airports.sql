-- ============================================================
-- Phase 6.0 — Airports Foundation (PR 1)
--
-- Three additive changes, each safe to re-run via IF NOT EXISTS
-- and ON CONFLICT clauses:
--
--   1. lead_inquiries: two new nullable VARCHAR(3) columns
--      `origin_iata` / `destination_iata` referencing the
--      already-seeded `airports(iata_code)`. The pre-existing
--      `origin` / `destination` VARCHAR(120) columns stay
--      untouched (back-compat with rows created before this
--      iteration). Phase 6.0 PR 2 wires the request form to
--      populate the new columns; this PR only opens the slot.
--
--   2. airports seed extension: +4 KSA operational airports
--      (Yanbu / Hail / Qassim / Jizan). Najran (EAM, ICAO OENG)
--      was a tempting fifth but is OMITTED in PR 1 because the
--      currently-seeded NUM (NEOM Bay) row carries the same
--      ICAO `OENG` and the airports table has a UNIQUE
--      constraint on `icao_code` — adding Najran would either
--      collide or require fixing the pre-existing NUM data
--      (out of scope for PR 1). Total airports after this
--      migration: 12 + 4 = 16. Within the +4..+6 range per
--      Phase 6.0 spec Resolved decision #1.
--
--   3. promote_lead_to_trip_request: BODY-ONLY update per
--      Phase 6.0 spec Resolved decision #4. Same signature,
--      same SECURITY DEFINER + search_path pin, same REVOKE +
--      GRANT block. The body now derives
--      `trip_requests.departure_airport` from the FIRST leg's
--      `from` field and `trip_requests.arrival_airport` from
--      the LAST leg's `to` field, matching them against the
--      airports table — values that don't match a known IATA
--      (legacy freeform Arabic strings, empty values, NULL
--      payloads) fall through to NULL. Existing callers — the
--      admin promote panel — see no signature change and
--      require no Server Action edit. PR 2 will start writing
--      IATA codes into `legs[].from` / `legs[].to`; rows
--      promoted before that day continue to land cleanly with
--      NULL airport columns and freeform `legs[]` strings.
--
-- No new tables, no new RLS policies, no new columns on the
-- `airports` table. PR 1 is intentionally schema-only — UI,
-- Server Actions, and operator-portal display land in PR 2
-- after the founder applies this migration to production
-- Supabase and runs the 5 verification probes documented in
-- the spec's Quality gates section.
-- ============================================================

-- ------------------------------------------------------------
-- 1. lead_inquiries: add IATA reference columns (nullable FKs)
-- ------------------------------------------------------------

ALTER TABLE lead_inquiries
  ADD COLUMN IF NOT EXISTS origin_iata VARCHAR(3)
    REFERENCES airports(iata_code);

ALTER TABLE lead_inquiries
  ADD COLUMN IF NOT EXISTS destination_iata VARCHAR(3)
    REFERENCES airports(iata_code);

COMMENT ON COLUMN lead_inquiries.origin_iata IS
  'Phase 6.0: IATA code of departure airport when the customer picked from the airports table. NULL when the customer typed a freeform city/airport name (carried in the existing origin column).';

COMMENT ON COLUMN lead_inquiries.destination_iata IS
  'Phase 6.0: IATA code of arrival airport when the customer picked from the airports table. NULL when the customer typed a freeform city/airport name (carried in the existing destination column).';

-- ------------------------------------------------------------
-- 2. airports seed extension: +4 KSA operational airports
--
-- Final list per Phase 6.0 Resolved decision #1. Codes verified
-- against IATA/ICAO public references:
--   YNB / OEYN — Prince Abdulmohsin Bin Abdulaziz, Yanbu
--   HAS / OEHL — Hail Regional/International, Hail
--   ELQ / OEGS — Prince Naif bin Abdulaziz Regional, Qassim/Buraidah
--   GIZ / OEGN — King Abdullah bin Abdulaziz, Jizan
--
-- ON CONFLICT (iata_code) DO NOTHING — re-runnable even if any
-- of these are added by a parallel hotfix.
-- ------------------------------------------------------------

INSERT INTO airports (
  iata_code, icao_code, name, name_ar, city, city_ar,
  country, country_ar, latitude, longitude, timezone
) VALUES
  ('YNB', 'OEYN', 'Prince Abdulmohsin Bin Abdulaziz Airport',
   'مطار الأمير عبد المحسن بن عبد العزيز', 'Yanbu', 'ينبع',
   'Saudi Arabia', 'المملكة العربية السعودية',
   24.1442, 38.0633, 'Asia/Riyadh'),
  ('HAS', 'OEHL', 'Hail Regional Airport',
   'مطار حائل الإقليمي', 'Hail', 'حائل',
   'Saudi Arabia', 'المملكة العربية السعودية',
   27.4376, 41.6863, 'Asia/Riyadh'),
  ('ELQ', 'OEGS', 'Prince Naif bin Abdulaziz Regional Airport',
   'مطار الأمير نايف بن عبد العزيز الإقليمي', 'Buraidah', 'بريدة',
   'Saudi Arabia', 'المملكة العربية السعودية',
   26.3035, 43.7744, 'Asia/Riyadh'),
  ('GIZ', 'OEGN', 'King Abdullah bin Abdulaziz Airport',
   'مطار الملك عبد الله بن عبد العزيز', 'Jizan', 'جازان',
   'Saudi Arabia', 'المملكة العربية السعودية',
   16.9011, 42.5858, 'Asia/Riyadh')
ON CONFLICT (iata_code) DO NOTHING;

-- ------------------------------------------------------------
-- 3. promote_lead_to_trip_request: BODY update (same signature)
--
-- Signature, SECURITY DEFINER, search_path pin, REVOKE/GRANT
-- block all preserved byte-for-byte from the Phase 4 PR #6
-- version. Only the INSERT column list and the body's local-
-- variable derivation change, to populate
-- `departure_airport` / `arrival_airport` from `p_legs` when
-- the values match a known IATA.
--
-- Defensive shape (Codex P2 patch on PR #15):
--   - The body uses LOCAL variables `v_legs_len`,
--     `v_departure_iata`, `v_arrival_iata` and a NESTED
--     `IF jsonb_typeof(p_legs) = 'array' THEN ...` block.
--     SQL standard does not guarantee short-circuit
--     evaluation of `AND` in CASE WHEN, so an inline
--     `WHEN jsonb_typeof = 'array' AND jsonb_array_length > 0`
--     could let `jsonb_array_length` execute on a non-array
--     payload and raise. The nested form removes that
--     ambiguity.
--   - Returns NULL when p_legs is missing, not an array, or
--     empty (defensive against future caller shape drift).
--   - upper(NULLIF(..., '')) normalizes case and treats empty
--     strings as NULL so the subquery returns no rows cleanly.
--   - The SELECT against airports returns the matched
--     iata_code or NULL — naturally honouring the FK on
--     `trip_requests.departure_airport` /
--     `trip_requests.arrival_airport` (both VARCHAR(10)
--     REFERENCES airports(iata_code), nullable).
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
DECLARE
  v_lead             RECORD;
  v_now              TIMESTAMPTZ := NOW();
  v_trip_id          UUID;
  -- Phase 6.0 P2 patch (Codex review of PR #15): SQL standard
  -- does NOT guarantee short-circuit evaluation of `AND` in a
  -- CASE WHEN, so the previous inline form
  --   `WHEN jsonb_typeof(p_legs) = 'array'
  --         AND jsonb_array_length(p_legs) > 0`
  -- could let `jsonb_array_length` execute on a non-array
  -- payload (object, scalar, NULL) and raise. Computing the
  -- length once into a variable, GUARDED by `jsonb_typeof`,
  -- guarantees the order and lets the IATA derivation read
  -- the variable instead of recomputing it for arrival.
  v_legs_len         INTEGER := 0;
  v_departure_iata   TEXT;
  v_arrival_iata     TEXT;
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
  -- arrival_airport from p_legs[0].from / p_legs[last].to when
  -- they match a known IATA. The two IF blocks are nested so
  -- jsonb_array_length and the JSONB index lookups never run
  -- on a non-array payload.
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

-- Re-apply the same REVOKE / GRANT block from Phase 4 PR #6.
-- CREATE OR REPLACE preserves existing privileges, but we
-- restate them explicitly so a future `git blame` shows the
-- full security posture in one place.
REVOKE ALL ON FUNCTION promote_lead_to_trip_request(
  UUID, JSONB, aircraft_category, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION promote_lead_to_trip_request(
  UUID, JSONB, aircraft_category, TEXT, TEXT
) TO service_role;

-- ============================================================
-- END OF MIGRATION
-- ============================================================
