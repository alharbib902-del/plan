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
-- Validation discipline (Codex round 2 PR #56 P1 #1 + round 3
-- P1 #1 fixes):
--   * Both retargeted FKs are added with `NOT VALID`. Forward
--     INSERT/UPDATE traffic IS still gated by the new FK
--     (Postgres enforces NOT VALID FKs against new rows);
--     pre-existing rows are skipped.
--   * Round 3 fix — we ALSO inline-backfill orphaned client_id
--     pointers (trip_requests + bookings) BEFORE adding the new
--     FKs. Without this, accept_offer / backfill_booking_from_offer
--     would copy a legacy users(id) pointer from a still-orphaned
--     trip into bookings.client_id, then fail the NOT VALID FK on
--     the booking insert (NOT VALID still applies to forward
--     writes). Snapshots are seeded from `users` first so the
--     identity-check + ZATCA/audit readability survive the NULL.
--   * `VALIDATE CONSTRAINT` is INTENTIONALLY NOT issued here.
--     A follow-up cleanup migration can `VALIDATE` once we are
--     confident no concurrent backfill is in flight; eager
--     validation in this same statement could still block
--     activation if a row sneaks in between the backfill and
--     the VALIDATE.
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
--   2. Inline-backfill orphaned client_id pointers — defensively
--      copy `users.full_name`/`phone` into the trip's
--      `customer_name`/`customer_phone` snapshot first (so the
--      Phase-4 trip_requests_identity_check stays satisfied and
--      ZATCA/audit identity stays readable), then NULL the
--      client_id. Done HERE rather than deferred (Codex round 3
--      PR #56 P1 #1 fix) because the bookings FK below is also
--      NOT VALID, which still rejects forward writes — and
--      `accept_offer`/`backfill_booking_from_offer` copy
--      `v_trip.client_id` straight into `bookings.client_id`,
--      so any legacy trip with a users(id) pointer would fail
--      the booking insert until the orphan is cleared. Cleaning
--      it now keeps every accept_offer call valid from the
--      moment this migration commits.
--   3. Re-add the FK to `clients(id)` with ON DELETE SET NULL
--      (NOT CASCADE): if a client deletes their account in a
--      future privacy flow, their historic trip_requests must
--      remain on file for audit + ZATCA invoicing — only the
--      pointer is cleared.
--   4. Add the constraint as `NOT VALID` and DO NOT validate it
--      in this migration (Codex round 2 PR #56 P1 #1 fix). The
--      backfill in step 2 already cleared every legacy orphan;
--      `NOT VALID` is kept only as a defence-in-depth lever in
--      case any concurrent process slipped a stray pointer in
--      between the backfill and the FK swap. A follow-up
--      cleanup migration can `VALIDATE` once activation is
--      cold-quiet.
--
-- DR/replay safety: each step uses IF EXISTS / DO blocks so a
-- partial replay (e.g. dropped FK already, retried migration)
-- does not error out. The backfill UPDATEs are idempotent —
-- running them twice is a no-op (the orphan filter no longer
-- matches once `client_id` is NULL).

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

-- Step 2a: backfill snapshots from `users` for any orphaned
-- pointer that still has a matching legacy users row.
UPDATE trip_requests AS tr
   SET customer_name  = COALESCE(NULLIF(BTRIM(tr.customer_name),  ''), u.full_name, 'Legacy customer'),
       customer_phone = COALESCE(NULLIF(BTRIM(tr.customer_phone), ''), u.phone,     'unknown')
  FROM users u
 WHERE tr.client_id IS NOT NULL
   AND tr.client_id = u.id
   AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = tr.client_id);

-- Step 2b: for orphans whose users row is also gone, seed
-- placeholder snapshots so the Phase-4 identity_check passes
-- after the NULL.
UPDATE trip_requests
   SET customer_name  = COALESCE(NULLIF(BTRIM(customer_name),  ''), 'Legacy customer'),
       customer_phone = COALESCE(NULLIF(BTRIM(customer_phone), ''), 'unknown')
 WHERE client_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = trip_requests.client_id);

-- Step 2c: NULL the orphaned pointers. The defensive
-- snapshots seeded above keep the rows readable + valid.
UPDATE trip_requests
   SET client_id = NULL
 WHERE client_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = trip_requests.client_id);

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

-- Intentionally NO `VALIDATE CONSTRAINT` here. The backfill
-- above cleared every orphan; the deferred VALIDATE is just a
-- belt-and-braces safety net against concurrent writes during
-- activation.


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
--   3. Inline-backfill orphaned client_id pointers — defensively
--      copy users.full_name / users.phone into the booking's
--      customer_name_snapshot / customer_phone_snapshot first
--      (Phase 6 PR 2a snapshot columns), then NULL the
--      client_id. Same Codex round 3 PR #56 P1 #1 fix that
--      §1 applies to trip_requests; bookings tend to be
--      shorter-lived (post-accept), but we backfill here
--      defensively so any legacy bookings row that survived
--      from Phase 1 testing doesn't permanently violate the
--      new NOT VALID FK either.
--   4. Re-add the FK to clients(id) with ON DELETE SET NULL
--      and `NOT VALID`. Same deferred-VALIDATE rationale
--      as §1.
--
-- Snapshot survival: Phase 6 PR 2a's accept_offer extension
-- writes `customer_name_snapshot` / `customer_phone_snapshot`
-- on every booking INSERT (Phase 6 PR 2a §66-67). So a
-- bookings row whose client_id eventually clears (privacy
-- delete, FK retarget mismatch) stays readable for ZATCA /
-- audit.
--
-- DR/replay safety: each step uses IF EXISTS / DO blocks so
-- a partial replay does not error out. The backfill UPDATEs
-- are idempotent (same rationale as §1).

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

-- Step 3a: backfill snapshots from `users` for any orphaned
-- pointer that still has a matching legacy users row.
UPDATE bookings AS b
   SET customer_name_snapshot  = COALESCE(NULLIF(BTRIM(b.customer_name_snapshot),  ''), u.full_name, 'Legacy customer'),
       customer_phone_snapshot = COALESCE(NULLIF(BTRIM(b.customer_phone_snapshot), ''), u.phone,     'unknown')
  FROM users u
 WHERE b.client_id IS NOT NULL
   AND b.client_id = u.id
   AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = b.client_id);

-- Step 3b: for orphans with no matching users row, seed
-- placeholders so the snapshots are never blank post-NULL.
UPDATE bookings
   SET customer_name_snapshot  = COALESCE(NULLIF(BTRIM(customer_name_snapshot),  ''), 'Legacy customer'),
       customer_phone_snapshot = COALESCE(NULLIF(BTRIM(customer_phone_snapshot), ''), 'unknown')
 WHERE client_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = bookings.client_id);

-- Step 3c: NULL the orphaned pointers.
UPDATE bookings
   SET client_id = NULL
 WHERE client_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = bookings.client_id);

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

-- Intentionally NO `VALIDATE CONSTRAINT` here. The backfill
-- above cleared every orphan; the deferred VALIDATE is just
-- a belt-and-braces safety net against concurrent writes
-- during activation.


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
