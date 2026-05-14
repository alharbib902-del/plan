-- ============================================================
-- Phase 9 PR 2 — Authenticated charter form
--
-- Wires the new `clients` table (Phase 9 PR 1 §3.1.b) into the
-- existing `trip_requests` flow + adds the §4.2 RPC the
-- /(client)/me/charter Server Action wraps.
--
-- Scope of this migration:
--   §1   trip_requests.client_id FK retarget (users → clients)
--   §2   bookings.client_id    FK retarget (users → clients)
--                              [Codex round 1 PR #56 P1 #1 fix]
--   §3   create_authenticated_trip_request(...)  RPC
--
-- Validation discipline (Codex round 2 PR #56 P1 #1 fix):
-- Both retargeted FKs are added with `NOT VALID` AND ARE NOT
-- VALIDATED in this migration. PostgreSQL still enforces the
-- new FK against every forward INSERT/UPDATE; only pre-existing
-- rows are skipped. A follow-up cleanup migration (post-Phase 9
-- activation) is responsible for:
--   1. NULLing any trip_requests.client_id and
--      bookings.client_id whose UUID points at the legacy
--      users(id) instead of the new clients(id).
--   2. `ALTER TABLE … VALIDATE CONSTRAINT
--      <name>_client_id_clients_fkey;`
-- Eager validation here would block production activation / DR
-- replay if any legacy users-backed pointer survived.
--
-- Dependencies:
--   - Phase 1   trip_requests, bookings, trip_type,
--               aircraft_category, trip_request_status,
--               generate_request_number(), airports(iata_code)
--   - Phase 4   trip_requests.client_id DROP NOT NULL +
--               customer_name / customer_phone / customer_source
--               snapshot columns + trip_requests_identity_check
--   - Phase 6   bookings now sets `customer_name` /
--               `customer_phone` snapshots in accept_offer,
--               so dropping NOT NULL on bookings.client_id is
--               safe (the row stays readable post-FK clear).
--   - Phase 9 PR 1   clients table (id, full_name, contact_phone,
--                    signup_status), client_status enum
--
-- Lessons applied (carry-forward from earlier PR rounds):
--   #1  NO Functions map entry for the new RPC (Phase 8 PR 2e
--       #48 collapse pattern). Server Action uses looseClient()
--       cast.
--   #3  REVOKE/GRANT explicit after every CREATE OR REPLACE
--       FUNCTION even if the prior migration already set them
--       (Phase 8 PR #53 round 2 hardening).
--   #4  Reuse Phase 8 / Phase 9 PR 1 helpers — no shadow
--       definitions.
--   #6  Opaque error contracts: never leak which guard tripped.
--   #8  Mirror existing patterns (promote_lead_to_trip_request
--       for the INSERT shape).
--   #9  Field-shape validation per parameter — structured
--       contracts (`invalid_iata`, `invalid_passengers`, …)
--       not a single blanket `validation_failed`.
-- ============================================================


-- ============================================================
-- §1 — Retarget trip_requests.client_id FK
-- ============================================================
--
-- Phase 1 created the column with `REFERENCES users(id) ON
-- DELETE CASCADE`, back when the buying side lived in
-- `users.role='client'`. Phase 9 PR 1 introduced a separate
-- `clients` table (Decision #1 in the spec) parallel to
-- `operators`, NOT a `users.role='client'` extension. The FK
-- target is now stale: the RPC below stores `clients.id` into
-- this column and the old constraint would reject the INSERT.
--
-- Plan:
--   1. Drop the legacy FK to `users(id)`.
--   2. Re-add the FK to `clients(id)` with ON DELETE SET NULL
--      (NOT CASCADE): if a client deletes their account in a
--      future privacy flow, their historic trip_requests must
--      remain on file for audit + ZATCA invoicing — only the
--      pointer is cleared. The customer_name / customer_phone
--      snapshot columns (Phase 4) preserve the readable identity
--      after the FK clears, and the trip_requests_identity_check
--      constraint (Phase 4) keeps the row valid post-clearance.
--   3. Add the constraint as `NOT VALID` and DO NOT validate it
--      in this migration (Codex round 2 PR #56 P1 #1 fix). All
--      forward INSERT/UPDATE traffic IS still gated by the new
--      FK — Postgres applies a NOT VALID FK to every new row;
--      only pre-existing rows are skipped. A separate cleanup +
--      backfill migration (post-Phase 9 activation) will:
--        a. NULL out any trip_requests.client_id whose UUID does
--           not exist in clients (legacy Phase 1 user pointers).
--        b. `ALTER TABLE … VALIDATE CONSTRAINT
--           trip_requests_client_id_clients_fkey;`
--      Validating eagerly here would block production activation
--      / DR replay if any legacy users-backed pointer survived
--      to this point.
--
-- DR/replay safety: each step uses IF EXISTS / DO blocks so a
-- partial replay (e.g. dropped FK already, retried migration)
-- does not error out.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'trip_requests_client_id_fkey'
       AND conrelid = 'public.trip_requests'::regclass
  ) THEN
    ALTER TABLE trip_requests
      DROP CONSTRAINT trip_requests_client_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'trip_requests_client_id_clients_fkey'
       AND conrelid = 'public.trip_requests'::regclass
  ) THEN
    ALTER TABLE trip_requests
      ADD CONSTRAINT trip_requests_client_id_clients_fkey
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE SET NULL
        NOT VALID;
  END IF;
END $$;

-- Intentionally NO `VALIDATE CONSTRAINT` here. See plan step
-- 3 above. Forward writes are still enforced; legacy rows
-- are deferred to a follow-up cleanup migration.


-- ============================================================
-- §2 — Retarget bookings.client_id FK
-- ============================================================
--
-- Codex round 1 PR #56 P1 #1 fix. Phase 1 created the column
-- with `NOT NULL REFERENCES users(id) ON DELETE RESTRICT`,
-- back when the buying side lived in `users.role='client'`.
-- Phase 6's `accept_offer` body copies `v_trip.client_id`
-- straight into `bookings.client_id`. After §1 retargets
-- trip_requests to clients(id), accept_offer would attempt
-- to write a clients.id into a users(id)-bound FK and raise
-- 23503 foreign_key_violation — every PR 9 charter booking
-- would die at the booking-creation step.
--
-- Plan:
--   1. Drop NOT NULL: required for ON DELETE SET NULL to
--      work, AND aligns the column with the trip_requests
--      side which dropped NOT NULL in Phase 4 (a guest-trip
--      that gets booked needs a NULL pointer too).
--   2. Drop the legacy FK to users(id).
--   3. Re-add the FK to clients(id) with ON DELETE SET NULL
--      and `NOT VALID`. **Do NOT validate eagerly here**
--      (Codex round 2 PR #56 P1 #1 fix). Forward writes are
--      gated by the new FK; legacy rows from Phase 1 (any
--      bookings.client_id pointing at users(id)) are deferred
--      to a follow-up cleanup migration (post-Phase 9
--      activation) that NULLs the orphaned pointers and then
--      runs `ALTER TABLE … VALIDATE CONSTRAINT
--      bookings_client_id_clients_fkey;`. Validating here
--      would block production activation / DR replay if any
--      legacy users-backed booking pointer survived.
--
-- Snapshot survival: Phase 6 PR 2a's accept_offer extension
-- writes `customer_name` / `customer_phone` snapshots on
-- every booking INSERT (the migration header comment in
-- 20260508000007_phase_6_2_addons.sql §340-345 documents the
-- contract). So a bookings row whose client_id eventually
-- clears (privacy delete, FK retarget mismatch) stays
-- readable for ZATCA / audit.
--
-- DR/replay safety: each step uses IF EXISTS / DO blocks so
-- a partial replay does not error out.

ALTER TABLE bookings ALTER COLUMN client_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bookings_client_id_fkey'
       AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      DROP CONSTRAINT bookings_client_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bookings_client_id_clients_fkey'
       AND conrelid = 'public.bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_client_id_clients_fkey
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE SET NULL
        NOT VALID;
  END IF;
END $$;

-- Intentionally NO `VALIDATE CONSTRAINT` here. See plan step
-- 3 above. Forward writes are still enforced; legacy rows
-- are deferred to a follow-up cleanup migration.


-- ============================================================
-- §3 — create_authenticated_trip_request
-- ============================================================
--
-- INSERTs into trip_requests with `client_id` set + a frozen
-- customer snapshot copied from the clients row. The Server
-- Action calls this once per submitted charter form. The
-- snapshot is intentionally written even though `client_id` is
-- present so trip history survives a future client deletion
-- (FK ON DELETE SET NULL above).
--
-- Auto-dispatch is NOT done here. PR 4 ships
-- `auto_dispatch_trip_request`; this RPC just lands the row in
-- `pending` and returns. The Server Action layer optionally
-- triggers dispatch behind the `ENABLE_TRIP_AUTO_DISTRIBUTION`
-- flag (Phase 9 spec §5 PR 2) — keeps the RPC pure + lets
-- PR 4 wire dispatch on without touching this migration.
--
-- Contract:
--   IN  p_client_id          UUID   (clients.id, must be active)
--       p_trip_type          TEXT   (must be 'charter' for now;
--                                    other trip_type values are
--                                    served by Phase 7/medevac/
--                                    cargo flows, not this RPC)
--       p_legs               JSONB  (array of {from,to,date,time}
--                                    objects; non-empty)
--       p_departure_iata     TEXT   (3 uppercase letters)
--       p_arrival_iata       TEXT   (3 uppercase letters)
--       p_departure_date     TIMESTAMPTZ (must be in the future)
--       p_return_date        TIMESTAMPTZ (nullable; if present
--                                         must be > departure)
--       p_passengers         INT    (1..19, matches the column
--                                    CHECK constraint from
--                                    Phase 1)
--       p_aircraft_pref      TEXT   (nullable; if present must
--                                    be a valid aircraft_category
--                                    enum value)
--       p_special_requests   TEXT   (nullable; max 2000 chars
--                                    defence-in-depth — column
--                                    is unbounded TEXT but UI
--                                    caps at 2000 via Zod)
--   OUT JSON:
--       { ok: true, trip_request_id, request_number }     on success
--       { ok: false, error: 'client_not_found' }          missing FK
--       { ok: false, error: 'client_not_active' }         suspended/deleted
--       { ok: false, error: 'invalid_trip_type' }         not 'charter'
--       { ok: false, error: 'invalid_legs' }              not array / empty
--       { ok: false, error: 'invalid_iata' }              departure or arrival shape (3-letter regex)
--       { ok: false, error: 'departure_airport_unknown' }  IATA shape OK, not in airports table (Codex round 1 PR #56 P1 #2)
--       { ok: false, error: 'arrival_airport_unknown' }    IATA shape OK, not in airports table (Codex round 1 PR #56 P1 #2)
--       { ok: false, error: 'invalid_departure_date' }    NULL or past
--       { ok: false, error: 'invalid_return_date' }       <= departure
--       { ok: false, error: 'invalid_passengers' }        out of 1..19
--       { ok: false, error: 'invalid_aircraft_pref' }     unknown enum value
--       { ok: false, error: 'special_requests_too_long' } > 2000 chars

CREATE OR REPLACE FUNCTION create_authenticated_trip_request(
  p_client_id        UUID,
  p_trip_type        TEXT,
  p_legs             JSONB,
  p_departure_iata   TEXT,
  p_arrival_iata     TEXT,
  p_departure_date   TIMESTAMPTZ,
  p_return_date      TIMESTAMPTZ,
  p_passengers       INT,
  p_aircraft_pref    TEXT,
  p_special_requests TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_row     RECORD;
  v_aircraft_pref  aircraft_category;
  v_trip_id        UUID;
  v_request_number TEXT;
BEGIN
  -- Resolve + status-gate the client. SELECT FOR UPDATE serializes
  -- against a concurrent profile delete (future Phase 10 surface)
  -- and gives the row lock the dispatch trigger can rely on.
  SELECT id, full_name, contact_phone, signup_status
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

  -- trip_type: PR 2 only handles charter. Empty-leg / medevac /
  -- cargo have their own dedicated flows.
  IF p_trip_type IS NULL OR p_trip_type <> 'charter' THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_trip_type');
  END IF;

  -- legs: must be a non-empty JSONB array. Per-leg shape is
  -- the UI's contract (Zod in the form); the RPC enforces only
  -- the structural minimum so a bad caller doesn't store an
  -- empty array that breaks downstream summary rendering.
  IF p_legs IS NULL
     OR jsonb_typeof(p_legs) <> 'array'
     OR jsonb_array_length(p_legs) = 0
  THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_legs');
  END IF;

  -- IATA shape: 3 uppercase letters. Cheap regex first so the
  -- airports lookup below never gets a malformed code.
  IF p_departure_iata IS NULL
     OR p_arrival_iata IS NULL
     OR p_departure_iata !~ '^[A-Z]{3}$'
     OR p_arrival_iata   !~ '^[A-Z]{3}$'
  THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_iata');
  END IF;

  -- Codex round 1 PR #56 P1 #2 fix — IATA existence check
  -- against the airports reference table BEFORE the INSERT.
  -- The previous shape-only check let `ZZZ`-style payloads
  -- pass the regex, then the INSERT into FK-backed
  -- departure_airport / arrival_airport surfaced as a raw
  -- 23503 foreign_key_violation reaching the Server Action.
  -- Two structured contracts (departure / arrival) so the
  -- form can highlight the offending field directly. The
  -- form does free-text IATA entry, so this is the most
  -- likely user error path.
  IF NOT EXISTS (
    SELECT 1 FROM airports WHERE iata_code = p_departure_iata
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'departure_airport_unknown');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM airports WHERE iata_code = p_arrival_iata
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'arrival_airport_unknown');
  END IF;

  -- departure_date: required + must be in the future. The Zod
  -- layer already caps "no earlier than tomorrow"; this is
  -- defence in depth so the DB never accepts a back-dated
  -- request from a buggy caller.
  IF p_departure_date IS NULL OR p_departure_date <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_departure_date');
  END IF;

  -- return_date: optional. If present, must strictly exceed
  -- departure_date (a same-day return on a charter is
  -- meaningful only when the return time strictly follows the
  -- outbound time, which is encoded in the timestamps).
  IF p_return_date IS NOT NULL AND p_return_date <= p_departure_date THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_return_date');
  END IF;

  -- passengers: 1..19 — matches the existing trip_requests
  -- CHECK constraint exactly (Phase 1 §241). Pre-validating
  -- here gives a structured error instead of the raw
  -- check_violation that would otherwise surface.
  IF p_passengers IS NULL OR p_passengers < 1 OR p_passengers > 19 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_passengers');
  END IF;

  -- aircraft_pref: optional. If present, must cast to the
  -- aircraft_category enum. We try the cast inside an
  -- exception handler so a stray value doesn't surface as a
  -- raw 22P02 invalid_text_representation.
  IF p_aircraft_pref IS NOT NULL THEN
    BEGIN
      v_aircraft_pref := p_aircraft_pref::aircraft_category;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN json_build_object('ok', false, 'error', 'invalid_aircraft_pref');
    END;
  ELSE
    v_aircraft_pref := NULL;
  END IF;

  -- special_requests: optional, capped at 2000 chars. Column
  -- is unbounded TEXT; the cap is a soft DoS guard so a
  -- bot-driven Server Action bypass cannot fill the table
  -- with novella-length payloads.
  IF p_special_requests IS NOT NULL
     AND length(p_special_requests) > 2000
  THEN
    RETURN json_build_object('ok', false, 'error', 'special_requests_too_long');
  END IF;

  -- INSERT. customer_source = 'client_portal' lets downstream
  -- queries distinguish PR 2 trips from Phase 4 lead-promoted
  -- ones. customer_name + customer_phone are frozen snapshots
  -- so the row stays readable after a future client deletion
  -- (FK ON DELETE SET NULL above).
  INSERT INTO trip_requests (
    client_id, customer_name, customer_phone, customer_source,
    trip_type, legs,
    departure_airport, arrival_airport,
    departure_date, return_date,
    passengers_count, aircraft_category_preference,
    special_requests, status
  ) VALUES (
    v_client_row.id,
    v_client_row.full_name,
    v_client_row.contact_phone,
    'client_portal',
    p_trip_type::trip_type,
    p_legs,
    p_departure_iata,
    p_arrival_iata,
    p_departure_date,
    p_return_date,
    p_passengers,
    v_aircraft_pref,
    NULLIF(TRIM(COALESCE(p_special_requests, '')), ''),
    'pending'
  )
  RETURNING id, request_number
       INTO v_trip_id, v_request_number;

  RETURN json_build_object(
    'ok', true,
    'trip_request_id', v_trip_id,
    'request_number', v_request_number
  );
END;
$$;

REVOKE ALL ON FUNCTION create_authenticated_trip_request(
  UUID, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_authenticated_trip_request(
  UUID, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, TEXT, TEXT
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION create_authenticated_trip_request(
  UUID, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION create_authenticated_trip_request(
  UUID, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, TEXT, TEXT
) IS
  'Phase 9 PR 2 §4.2: INSERT a charter trip request on behalf of an authenticated client. Snapshots full_name/contact_phone for FK-on-delete-survival. service_role only.';
