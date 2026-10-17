-- ============================================================
-- DB security hardening (2026-10-17 review)
-- ============================================================
--
-- Six independent fixes in one forward-only, idempotent file
-- (safe to run twice). Applied via the session-pooler runner
-- as role `postgres` — never `supabase db push`.
--
--   §1  Drop the 8 legacy Supabase-Auth RLS policies.
--   §2  Strip every privilege anon + authenticated hold on
--       relations in schema public (airports SELECT kept) and
--       stop postgres's default privileges from re-granting
--       them to future tables / sequences / functions.
--   §3  accept_offer + backfill_booking_from_offer: stop
--       linking a booking to ANY operators row whose
--       (self-editable, non-UNIQUE) contact_phone matches.
--   §4  Normalise operators.contact_phone (Saudi formats →
--       E.164) where collision-free, then re-run the charter
--       operator-link backfill with the §3 rule.
--   §5  REVOKE on the 4 SECURITY DEFINER trigger functions
--       that never got one.
--   §6  Missing FK / list-query indexes; drop 3 legacy
--       single-column indexes only when the catalog proves
--       each is a strict left prefix of another index.
--
-- WHY §1/§2. The app never uses Supabase Auth or the anon key:
-- the only Supabase client is the service-role admin client
-- (lib/supabase/admin.ts — every other supabase-js import is
-- `import type`), identity comes from our own cookie sessions,
-- and every read/write goes through service_role. anon and
-- authenticated therefore need nothing in public except the
-- intentionally public airports read. Anything else they hold
-- is attack surface for whoever has the (public) anon key —
-- e.g. empty_legs_public_available let any anon-key holder
-- read every 'available' empty leg over PostgREST, including
-- operator_phone_snapshot / operator_email_snapshot and
-- prices. Only ~10 tables ever got an explicit
-- `REVOKE ALL ... FROM anon, authenticated`.
--
-- service_role is never touched: every REVOKE / ALTER DEFAULT
-- PRIVILEGES below names only anon + authenticated (plus
-- PUBLIC for the §5 functions). service_role keeps its own
-- direct grants and default-privilege entries, and is not a
-- member of anon or authenticated, so nothing it can do today
-- changes.
--
-- WHY §3/§4. 20260719000001 resolves bookings.operator_id via
-- `operators.contact_phone = offer operator_phone ORDER BY
-- created_at LIMIT 1` with no status filter. contact_phone has
-- no UNIQUE constraint and the operator edits it freely
-- (operatorUpdateProfile), so a pending / rejected / suspended
-- or impostor account could capture a charter booking and,
-- once able to log in, read the client's PII on it. §3 makes
-- the auto-dispatch identity authoritative when it exists and
-- restricts the phone fallback to approved operators. §4
-- fixes the data side: the signup / profile validators only
-- length-check the phone (6..20 chars), so stored values mix
-- 05XXXXXXXX / 9665XXXXXXXX / +9665XXXXXXXX and never matched
-- the strict-E.164 offer phones. A companion app change (a
-- separate PR, another agent) normalises NEW operator phone
-- input to E.164 in app code; this migration only normalises
-- the rows that already exist.
--
-- Out of scope (deliberately): accept_offer's signature (the
-- admin path has no client; the app-level ownership check
-- stays), secret encryption, append-only triggers, and all
-- bookings payment / flight-status logic (20261017000002).
-- ============================================================


-- ============================================================
-- §1. Legacy Supabase-Auth RLS policies
--
-- Every CREATE POLICY in supabase/migrations/ (enumerated
-- 2026-10-17; no migration creates a policy dynamically):
--   20260422000001  airports_public_read               KEEP (intended public read)
--   20260422000001  users_select_own                   DROP
--   20260422000001  users_update_own                   DROP
--   20260422000001  bookings_select_client             DROP
--   20260422000001  bookings_select_operator           DROP
--   20260422000001  trip_requests_select_own           DROP
--   20260422000001  trip_requests_insert_own           DROP
--   20260422000001  empty_legs_public_available        DROP
--   20260422000001  notifications_select_own           DROP
--   20260617000001  device_tokens_deny_all             KEEP (USING (false))
--   20260617000002  client_push_deliveries_deny_all    KEEP (USING (false))
--   20260617000002  client_push_alert_status_deny_all  KEEP (USING (false))
-- The 8 dropped policies are auth.uid() leftovers of the
-- pre-cutover Supabase-Auth design (is_admin() was already
-- dropped in 20260603000003). auth.uid() is NULL for the anon
-- key so most matched nothing — but the `status = 'available'`
-- branch of empty_legs_public_available did not depend on it.
-- DROP POLICY IF EXISTS is a no-op on re-run and on a missing
-- table.
-- ============================================================

DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;
DROP POLICY IF EXISTS "bookings_select_client" ON bookings;
DROP POLICY IF EXISTS "bookings_select_operator" ON bookings;
DROP POLICY IF EXISTS "trip_requests_select_own" ON trip_requests;
DROP POLICY IF EXISTS "trip_requests_insert_own" ON trip_requests;
DROP POLICY IF EXISTS "empty_legs_public_available" ON empty_legs;
DROP POLICY IF EXISTS "notifications_select_own" ON notifications;


-- ============================================================
-- §2. anon / authenticated privileges in schema public
--
-- §2a Default privileges. Supabase's platform setup runs
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON
--     TABLES | SEQUENCES | FUNCTIONS
--     TO postgres, anon, authenticated, service_role;
-- for the roles that create objects (the mechanism
-- 20260513000022 documents for functions), so every object a
-- migration creates is born with anon + authenticated grants.
-- Migrations run as `postgres` (the session-pooler login is
-- postgres.<project-ref>), so FOR ROLE postgres targets the
-- creator role whose defaults matter. Only anon +
-- authenticated are removed; the postgres and service_role
-- entries stay, so future service-role access is unchanged.
-- Scoped to schema public on purpose: no other schema's
-- defaults change. Not covered: supabase_admin's defaults
-- (postgres is not a member of supabase_admin, so it cannot
-- alter them) — only objects created outside our migrations
-- (dashboard / platform) use those. The built-in PUBLIC
-- EXECUTE default on functions is global and cannot be removed
-- per schema; it stays, which is why every function keeps its
-- explicit REVOKE ... FROM PUBLIC, anon, authenticated.
-- ============================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;


-- ------------------------------------------------------------
-- §2b Existing relations (tables, partitioned tables, views,
-- materialized views, foreign tables, sequences). Relations we
-- own — everything our migrations created — are revoked
-- directly, so a failure there aborts the migration. A
-- relation we do not own (e.g. PostGIS's spatial_ref_sys when
-- the extension was installed by supabase_admin) can refuse
-- the REVOKE; that one is wrapped so it can only WARN, never
-- abort the migration.
-- ------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel,
           c.relkind,
           pg_has_role(c.relowner, 'USAGE') AS owned
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     ORDER BY c.oid
  LOOP
    IF r.owned THEN
      IF r.relkind = 'S' THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon, authenticated', r.rel);
      ELSE
        EXECUTE format('REVOKE ALL ON TABLE %s FROM anon, authenticated', r.rel);
      END IF;
    ELSE
      BEGIN
        IF r.relkind = 'S' THEN
          EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon, authenticated', r.rel);
        ELSE
          EXECUTE format('REVOKE ALL ON TABLE %s FROM anon, authenticated', r.rel);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'db_security_hardening: could not revoke anon/authenticated on % (not owned by %): % [%]',
          r.rel, current_user, SQLERRM, SQLSTATE;
      END;
    END IF;
  END LOOP;
END $$;

-- The one intended public read (matches airports_public_read).
GRANT SELECT ON airports TO anon, authenticated;

-- Post-condition: no relation we own still grants anything to
-- anon / authenticated except airports SELECT.
DO $$
DECLARE
  v_leaks TEXT;
BEGIN
  SELECT string_agg(DISTINCT format('%s:%s->%s', c.oid::regclass, a.privilege_type, g.rolname), ', ')
    INTO v_leaks
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) AS a
    JOIN pg_roles AS g ON g.oid = a.grantee
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     AND pg_has_role(c.relowner, 'USAGE')
     AND g.rolname IN ('anon', 'authenticated')
     AND NOT (c.relname = 'airports' AND c.relkind = 'r' AND a.privilege_type = 'SELECT');

  IF v_leaks IS NOT NULL THEN
    RAISE EXCEPTION 'db_security_hardening: anon/authenticated privileges survived on owned relations: %', v_leaks;
  END IF;
END $$;


-- ============================================================
-- §3. Operator-link resolution in accept_offer +
--     backfill_booking_from_offer
--
-- Both bodies are copied byte-for-byte from
-- 20260719000001_accept_offer_link_operator_by_phone.sql
-- except for exactly two edits per function, marked
-- "(20261017000001)" inline:
--   - one new DECLARE, v_dispatch_operator_id;
--   - step 4.5 (the operators.id resolution) is replaced:
--       (a) a Phase 5 offer whose dispatch target was minted by
--           auto_dispatch_trip_request has an authoritative
--           operator identity in trip_distribution_log
--           (operator_id NOT NULL, UNIQUE dispatch_target_id —
--           trip_dispatch_targets itself carries only
--           target_phone). That identity wins, and only while
--           the operator is approved — no phone fallback, so a
--           phone clash can never redirect an auto-dispatched
--           booking.
--       (b) otherwise (phase4, or a manual Phase 5 dispatch):
--           the exact E.164 phone match, restricted to
--           signup_status = 'approved'. 'suspended' is a
--           distinct operator_status value (admin_suspend_operator
--           flips approved → suspended), so 'approved' already
--           excludes pending / rejected / suspended accounts —
--           the same eligibility gate score_operators_for_trip
--           uses. ORDER BY created_at, id + LIMIT 1 keeps a
--           duplicate-phone match deterministic.
-- Lockstep rule (20260509000008) kept: both functions get the
-- identical resolution. Signatures, lock order (the new reads
-- are plain SELECTs taking no row lock), sibling rejects,
-- round close, snapshot columns, return shapes,
-- SECURITY DEFINER + search_path and the service-role-only
-- grants are unchanged.
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
  -- 20261017000001: operator identity from the Phase 5
  -- auto-dispatch log; NULL for phase4 / manual dispatch.
  v_dispatch_operator_id UUID;
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

  -- Step 4.5 (20261017000001, replaces the 20260719000001
  -- phone-only lookup): resolve the operator's portal account
  -- for the bookings INSERT. (a) An auto-dispatched Phase 5
  -- target has an authoritative operator in
  -- trip_distribution_log: use it, only while approved, with no
  -- phone fallback. (b) Otherwise exact E.164 phone match
  -- restricted to signup_status = 'approved' (excludes pending /
  -- rejected / suspended), oldest account first. No match leaves
  -- v_operator_id NULL. Plain SELECTs: no row lock, so the
  -- Phase 5 lock order is untouched.
  IF p_source = 'phase5' THEN
    SELECT l.operator_id INTO v_dispatch_operator_id
      FROM phase5_operator_offers AS f
      JOIN trip_distribution_log AS l
        ON l.dispatch_target_id = f.dispatch_target_id
      WHERE f.id = p_offer_id;
  END IF;

  IF v_dispatch_operator_id IS NOT NULL THEN
    SELECT id INTO v_operator_id
      FROM operators
      WHERE id = v_dispatch_operator_id
        AND signup_status = 'approved';
  ELSE
    SELECT id INTO v_operator_id
      FROM operators
      WHERE contact_phone = v_offer_operator_phone
        AND signup_status = 'approved'
      ORDER BY created_at ASC, id ASC
      LIMIT 1;
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
  -- 20261017000001: operator identity from the Phase 5
  -- auto-dispatch log; NULL for phase4 / manual dispatch.
  v_dispatch_operator_id UUID;
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

  -- Step 4.5 (20261017000001): same resolution as accept_offer's
  -- step 4.5 — auto-dispatch identity (approved only, no phone
  -- fallback), else the approved-only phone match. Lockstep.
  IF v_offer_source = 'phase5' THEN
    SELECT l.operator_id INTO v_dispatch_operator_id
      FROM phase5_operator_offers AS f
      JOIN trip_distribution_log AS l
        ON l.dispatch_target_id = f.dispatch_target_id
      WHERE f.id = v_offer_id;
  END IF;

  IF v_dispatch_operator_id IS NOT NULL THEN
    SELECT id INTO v_operator_id
      FROM operators
      WHERE id = v_dispatch_operator_id
        AND signup_status = 'approved';
  ELSE
    SELECT id INTO v_operator_id
      FROM operators
      WHERE contact_phone = v_offer_operator_phone
        AND signup_status = 'approved'
      ORDER BY created_at ASC, id ASC
      LIMIT 1;
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
-- §4. Existing data: phone normalisation + link backfill
--
-- §4a operators.contact_phone → E.164. Strip everything but
-- digits and '+' (after mapping Arabic-Indic digits to ASCII),
-- then accept the Saudi mobile shapes 05XXXXXXXX, 5XXXXXXXX,
-- 9665XXXXXXXX, +9665XXXXXXXX, 009665XXXXXXXX (and the common
-- +966 05… slip) and rewrite them to +9665XXXXXXXX. A row is
-- only rewritten when no OTHER operator's phone — as stored or
-- as normalised — equals the result, so this can never create
-- a new duplicate phone (two rows that would collide both stay
-- as they are for an admin to resolve). Anything else (non-
-- Saudi numbers, landlines, junk) is left untouched. Each
-- rewrite is logged to audit_logs. Idempotent: a re-run finds
-- every rewritten row already canonical.
-- ============================================================

WITH norm AS (
  SELECT o.id,
         o.contact_phone,
         COALESCE(
           '+966' || (regexp_match(
             regexp_replace(
               translate(o.contact_phone,
                         '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
                         '01234567890123456789'),
               '[^0-9+]', '', 'g'),
             '^(?:(?:[+]|00)?966)?0?(5[0-9]{8})$'))[1],
           o.contact_phone
         ) AS canonical
    FROM operators AS o
),
changed AS (
  UPDATE operators AS o
     SET contact_phone = n.canonical
    FROM norm AS n
   WHERE o.id = n.id
     AND n.canonical IS DISTINCT FROM n.contact_phone
     AND NOT EXISTS (
       SELECT 1
         FROM norm AS other
        WHERE other.id <> n.id
          AND other.canonical = n.canonical
     )
  RETURNING o.id, n.contact_phone AS old_phone, n.canonical AS new_phone
)
INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
SELECT 'operator',
       changed.id,
       'contact_phone_normalized',
       jsonb_build_object('contact_phone', changed.old_phone),
       jsonb_build_object('contact_phone', changed.new_phone)
  FROM changed;


-- ------------------------------------------------------------
-- §4b Re-run the charter operator-link backfill with the §3
-- rule: auto-dispatch identity first (approved only, no phone
-- fallback), else the approved-only phone match. Same
-- idempotency guards as 20260719000001 (only operator_id IS
-- NULL rows, only real matches). Bookings already linked by
-- the earlier rule are deliberately NOT re-pointed or
-- unlinked: an existing link to a non-approved account is
-- inert while that account cannot log in (login + session
-- validation require 'approved'), and silently moving a
-- booking between operators needs a founder decision.
-- ------------------------------------------------------------

UPDATE bookings AS b
  SET operator_id = picked.operator_id
  FROM (
    SELECT src.source_offer_table,
           src.source_offer_id,
           CASE
             WHEN src.dispatch_operator_id IS NOT NULL THEN
               (SELECT o.id
                  FROM operators AS o
                 WHERE o.id = src.dispatch_operator_id
                   AND o.signup_status = 'approved')
             ELSE
               (SELECT o.id
                  FROM operators AS o
                 WHERE o.contact_phone = src.operator_phone
                   AND o.signup_status = 'approved'
                 ORDER BY o.created_at ASC, o.id ASC
                 LIMIT 1)
           END AS operator_id
      FROM (
        SELECT 'phase4'::TEXT AS source_offer_table,
               p4.id AS source_offer_id,
               p4.operator_phone,
               NULL::UUID AS dispatch_operator_id
          FROM phase4_operator_offers AS p4
        UNION ALL
        SELECT 'phase5'::TEXT,
               p5.id,
               p5.operator_phone,
               l.operator_id
          FROM phase5_operator_offers AS p5
          LEFT JOIN trip_distribution_log AS l
            ON l.dispatch_target_id = p5.dispatch_target_id
      ) AS src
  ) AS picked
  WHERE b.source_offer_table = picked.source_offer_table
    AND b.source_offer_id = picked.source_offer_id
    AND b.operator_id IS NULL
    AND picked.operator_id IS NOT NULL;


-- ============================================================
-- §5. SECURITY DEFINER trigger functions without a REVOKE
--
-- An enumeration of every SECURITY DEFINER function across the
-- migrations finds exactly these four with no REVOKE from
-- anon (all zero-arg trigger functions). Firing a trigger does
-- not check EXECUTE on its function (precedent:
-- _audit_empty_legs_change() is revoked even from service_role
-- in 20260509000010 and its trigger keeps firing), so the
-- REVOKE only removes them from the anon / authenticated
-- surface. No GRANT: nothing calls them directly.
-- ============================================================

-- 20260520000032_phase_11_pr_3_cargo_distribution.sql
REVOKE ALL ON FUNCTION cargo_requests_dispatch_trigger()
  FROM PUBLIC, anon, authenticated;
-- 20260520000040_phase_12_pr_1_medevac_intake.sql
REVOKE ALL ON FUNCTION enforce_aircraft_medical_certifications()
  FROM PUBLIC, anon, authenticated;
-- 20260527000042_phase_12_pr_3_medevac_distribution.sql
REVOKE ALL ON FUNCTION medevac_requests_dispatch_trigger()
  FROM PUBLIC, anon, authenticated;
-- 20260531000008_operator_fleet.sql
REVOKE ALL ON FUNCTION reject_retired_aircraft_offer()
  FROM PUBLIC, anon, authenticated;


-- ============================================================
-- §6. Indexes
--
-- §6a Missing indexes (no equivalent exists in any migration).
-- Plain CREATE INDEX (not CONCURRENTLY): the runner applies
-- the file as one transaction and these tables are small.
--   support_tickets (client_id, updated_at DESC)
--       lib/support/queries.ts lists a client's tickets with
--       .eq('client_id').order('updated_at', desc); the only
--       client index (idx_support_user, renamed column) is on
--       created_at.
--   payment_events (booking_id)
--       FK bookings ON DELETE SET NULL; partial like its
--       sibling idx_payment_events_payment.
--   client_password_reset_tokens (client_id)
--   operator_password_reset_tokens (operator_id)
--       FK ON DELETE CASCADE columns; only token_hash indexed.
--   reviews (client_id, created_at DESC)
--       lib/reviews/queries.ts: .eq('client_id')
--       .order('created_at', desc); no client_id index.
-- Skipped: empty_leg_alert_deliveries (alert_id) — the
-- empty_leg_alert_deliveries_unique UNIQUE (alert_id,
-- empty_leg_id) index (20260531000004) already leads with
-- alert_id, so a separate index would be redundant.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_support_tickets_client_updated
  ON support_tickets (client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_booking
  ON payment_events (booking_id) WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_reset_tokens_client
  ON client_password_reset_tokens (client_id);

CREATE INDEX IF NOT EXISTS idx_operator_password_reset_operator
  ON operator_password_reset_tokens (operator_id);

CREATE INDEX IF NOT EXISTS idx_reviews_client
  ON reviews (client_id, created_at DESC);


-- ------------------------------------------------------------
-- §6b Redundant legacy single-column indexes. Proof from the
-- migrations:
--   idx_medevac_status ON medevac_requests (status)
--       (20260422000001 l.531). 20260520000040 DROP TABLE ...
--       CASCADEs the legacy table (it RAISEs if non-empty), so
--       the index normally no longer exists; the rebuilt table
--       has idx_medevac_requests_status (status, created_at
--       DESC), non-partial.
--   idx_subscriptions_client ON medevac_subscriptions
--       (client_id) (20260422000001 l.559). Same legacy-table
--       DROP; the rebuilt table has
--       idx_medevac_subscriptions_client (client_id, created_at
--       DESC), non-partial.
--   idx_cargo_status ON cargo_requests (status)
--       (20260422000001 l.601). No migration drops it;
--       20260518000030 adds idx_cargo_requests_status (status,
--       created_at DESC), non-partial.
-- (status) / (client_id) are strict left prefixes of those
-- two-column btrees, so any query the single-column index can
-- serve, the wider one serves too. Because the legacy tables
-- may or may not still exist, each DROP is gated on the live
-- catalog re-proving it: the candidate is a plain,
-- non-unique, non-partial, column-only index, and another
-- valid, non-partial, column-only index on the same table
-- with the same access method has strictly more key columns
-- whose leading ones match the candidate's columns, opclasses,
-- collations and sort options. Otherwise the index is kept.
-- ------------------------------------------------------------

DO $$
DECLARE
  v_name  TEXT;
  v_cover TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'idx_medevac_status',
    'idx_cargo_status',
    'idx_subscriptions_client'
  ]
  LOOP
    v_cover := NULL;

    SELECT other.indexrelid::regclass::TEXT
      INTO v_cover
      FROM pg_index AS cand
      JOIN pg_class AS cand_rel ON cand_rel.oid = cand.indexrelid
      JOIN pg_index AS other
        ON other.indrelid = cand.indrelid
       AND other.indexrelid <> cand.indexrelid
      JOIN pg_class AS other_rel ON other_rel.oid = other.indexrelid
     WHERE cand.indexrelid = to_regclass('public.' || v_name)
       AND NOT cand.indisunique
       AND NOT cand.indisprimary
       AND NOT cand.indisexclusion
       AND cand.indpred IS NULL
       AND cand.indexprs IS NULL
       AND other.indisvalid
       AND other.indisready
       AND other.indpred IS NULL
       AND other.indexprs IS NULL
       AND other_rel.relam = cand_rel.relam
       AND other.indnkeyatts > cand.indnkeyatts
       AND NOT EXISTS (
         SELECT 1
           FROM generate_series(0, cand.indnkeyatts - 1) AS k
          WHERE other.indkey[k]       IS DISTINCT FROM cand.indkey[k]
             OR other.indclass[k]     IS DISTINCT FROM cand.indclass[k]
             OR other.indcollation[k] IS DISTINCT FROM cand.indcollation[k]
             OR other.indoption[k]    IS DISTINCT FROM cand.indoption[k]
       )
     ORDER BY other.indexrelid
     LIMIT 1;

    IF v_cover IS NOT NULL THEN
      EXECUTE format('DROP INDEX IF EXISTS public.%I', v_name);
      RAISE NOTICE 'db_security_hardening: dropped % (strict left prefix of %)', v_name, v_cover;
    END IF;
  END LOOP;
END $$;


-- ============================================================
-- END OF MIGRATION
--
-- Post-migration shape:
--   - Only airports_public_read + the 3 USING (false) push
--     policies remain in public.
--   - anon / authenticated: SELECT on airports, nothing else on
--     any owned relation in public; postgres's default
--     privileges no longer hand them new tables / sequences /
--     functions. service_role grants untouched.
--   - accept_offer(TEXT, UUID) / backfill_booking_from_offer(UUID):
--     same signatures + return shapes; operator link = auto-
--     dispatch identity (approved) else approved-only phone
--     match. Still SECURITY DEFINER + search_path = public,
--     pg_temp + service-role-only EXECUTE.
--   - operators.contact_phone Saudi mobiles in E.164 where
--     collision-free (audit_logs 'contact_phone_normalized').
--   - 4 trigger functions revoked from PUBLIC/anon/authenticated.
--   - 5 new indexes; 0-3 provably redundant legacy indexes gone.
-- ============================================================
