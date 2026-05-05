-- ============================================
-- AERIS — Phase 5: Trip Distribution Engine
-- Migration: 20260505000004
-- ============================================
--
-- Adds the schema and atomic SQL functions required by Phase 5
-- (Trip Distribution Engine — multi-operator parallel dispatch).
-- See aeris/docs/CLAUDE-TASK.md "Phase 5: Trip Distribution
-- Engine" iteration 5 (Codex-accepted 100/100) for the design
-- rationale.
--
-- Sub-sections:
--   1a. dispatch_target_status / dispatch_round_status enums.
--   1b. trip_dispatch_rounds table (deny-all RLS).
--   1c. trip_dispatch_targets table (deny-all RLS).
--   1d. trip_requests.current_dispatch_round_id column.
--   1e. phase5_operator_offers table (deny-all RLS).
--   1f. updated_at triggers for the three new tables.
--   2a. open_phase5_dispatch_round(...) atomic function.
--   2b. submit_phase5_operator_offer(...) atomic function.
--   2c. accept_offer(...) unified atomic function (covers both
--       Phase 4 and Phase 5 offers — replaces the admin UI's
--       direct call into accept_phase4_offer; the legacy RPC
--       stays in the DB for the deprecation window).
--
-- All three new SECURITY DEFINER functions pin
-- search_path = public, pg_temp.
--
-- All three new tables have RLS ENABLED with **zero** policies
-- (deny-all; service-role-only access via Server Actions).
-- All three new functions REVOKE FROM PUBLIC, anon, authenticated
-- and GRANT EXECUTE only to service_role — the same defense-in-
-- depth posture established by the Phase 4 live verification
-- round 1 P1 fix.
--
-- Phase 4 surfaces (phase4_operator_offers, accept_phase4_offer,
-- submit_phase4_operator_offer, promote_lead_to_trip_request,
-- and trip_requests.dispatch_* columns) are NOT modified by this
-- migration. They remain functional for any v=1 operator token
-- that was issued before the Phase 5 deploy.
-- ============================================


-- ============================================
-- 1a. New enums
-- ============================================
--
-- CREATE TYPE has no IF NOT EXISTS form, so each enum is wrapped
-- in a DO block that swallows the duplicate_object exception.
-- Re-running the migration on a DB where these types already
-- exist is therefore safe.

DO $$ BEGIN
  CREATE TYPE dispatch_target_status AS ENUM (
    'pending',     -- awaiting operator submission or expiry
    'submitted',   -- operator submitted an offer through this target
    'expired',     -- expires_at passed before submission
    'cancelled'    -- admin accepted a sibling offer or re-dispatched
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_round_status AS ENUM (
    'open',        -- at least one target is still 'pending'
    'closed'       -- all targets terminal OR an offer accepted on this trip
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ============================================
-- 1b. trip_dispatch_rounds
-- ============================================
--
-- One row per "send-to-N-operators" admin action. Owns the
-- round-level status (open / closed) and a free-text close
-- reason ('offer_accepted' | 'redispatched' | 'admin_cancel').

CREATE TABLE IF NOT EXISTS trip_dispatch_rounds (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_request_id   UUID NOT NULL
                      REFERENCES trip_requests(id) ON DELETE CASCADE,
  status            dispatch_round_status NOT NULL DEFAULT 'open',
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at         TIMESTAMPTZ,
  closed_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_rounds_trip
  ON trip_dispatch_rounds (trip_request_id, opened_at DESC);

ALTER TABLE trip_dispatch_rounds ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies — anon + authenticated cannot
-- SELECT/INSERT/UPDATE/DELETE. Service role only.

COMMENT ON TABLE trip_dispatch_rounds IS
  'Phase 5: one row per multi-operator dispatch action. Server-only access.';


-- ============================================
-- 1c. trip_dispatch_targets
-- ============================================
--
-- One row per (round, operator-phone) tuple. Owns the per-target
-- nonce, expiry, and submission state. The Server Action
-- pre-generates id/nonce/sent_at/expires_at locally before the
-- RPC call (iteration-1 P1 fix); the RPC inserts those values
-- as-is so the persisted sent_at matches the issued_at baked
-- into the HMAC token byte-for-byte (iteration-3 P1 fix).

CREATE TABLE IF NOT EXISTS trip_dispatch_targets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispatch_round_id   UUID NOT NULL
                        REFERENCES trip_dispatch_rounds(id) ON DELETE CASCADE,
  trip_request_id     UUID NOT NULL
                        REFERENCES trip_requests(id) ON DELETE CASCADE,

  target_phone        VARCHAR(20) NOT NULL,           -- E.164
  nonce               TEXT NOT NULL,                  -- 32 hex chars
  expires_at          TIMESTAMPTZ NOT NULL,
  status              dispatch_target_status NOT NULL DEFAULT 'pending',
  -- sent_at default is a safety net only; the Phase 5 insert
  -- path (open_phase5_dispatch_round) supplies sent_at
  -- explicitly so the rebuild path in
  -- issueOperatorTokenFromTarget reproduces the same token
  -- byte-for-byte. (Iteration-3 P1 fix.)
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT trip_dispatch_targets_phone_per_round_unique
    UNIQUE (dispatch_round_id, target_phone),

  -- Defense-in-depth: nonce is global-unique so a collision
  -- across rounds (vanishingly unlikely with 16 random bytes,
  -- but defensible) becomes a clean insert error rather than
  -- silent token confusion.
  CONSTRAINT trip_dispatch_targets_nonce_unique UNIQUE (nonce)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_targets_round
  ON trip_dispatch_targets (dispatch_round_id, status);

CREATE INDEX IF NOT EXISTS idx_dispatch_targets_trip
  ON trip_dispatch_targets (trip_request_id, sent_at DESC);

ALTER TABLE trip_dispatch_targets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE trip_dispatch_targets IS
  'Phase 5: one row per dispatch target (operator phone). Server-only access.';


-- ============================================
-- 1d. trip_requests.current_dispatch_round_id
-- ============================================
--
-- Forward link from a trip to its currently-active dispatch
-- round. NULL until first Phase 5 dispatch. Every Phase 5
-- dispatch (re-)points this column at the new round and closes
-- the prior round in the same RPC transaction.
--
-- Phase 4 columns (dispatch_nonce, dispatch_expires_at,
-- dispatch_target_phone, dispatched_at) are NOT touched by this
-- migration. They remain populated for any pre-Phase-5 dispatch
-- and continue to drive submit_phase4_operator_offer for v=1
-- tokens.

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS current_dispatch_round_id UUID
    REFERENCES trip_dispatch_rounds(id);


-- ============================================
-- 1e. phase5_operator_offers
-- ============================================
--
-- The Phase 5 successor to phase4_operator_offers. Same shape
-- plus a dispatch_target_id FK so each offer is traceable to
-- the target row that produced it. Phase 4 offers stay in
-- phase4_operator_offers; Phase 5 offers go here. The unified
-- accept_offer RPC routes by the p_source argument.

CREATE TABLE IF NOT EXISTS phase5_operator_offers (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_request_id          UUID NOT NULL
                             REFERENCES trip_requests(id) ON DELETE CASCADE,
  dispatch_target_id       UUID NOT NULL
                             REFERENCES trip_dispatch_targets(id) ON DELETE RESTRICT,

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

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One target row should produce at most one offer; a network
  -- retry that submits twice with the same token must hit a
  -- clear DB error rather than create a silent duplicate.
  CONSTRAINT phase5_operator_offers_target_unique
    UNIQUE (dispatch_target_id)
);

CREATE INDEX IF NOT EXISTS idx_phase5_offers_trip
  ON phase5_operator_offers (trip_request_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_phase5_offers_target
  ON phase5_operator_offers (dispatch_target_id);

ALTER TABLE phase5_operator_offers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE phase5_operator_offers IS
  'Phase 5: free-text operator submissions via signed v=2 token URL. Server-only access.';


-- ============================================
-- 1f. updated_at triggers (use existing update_updated_at function)
-- ============================================

DROP TRIGGER IF EXISTS trip_dispatch_rounds_updated_at
  ON trip_dispatch_rounds;
CREATE TRIGGER trip_dispatch_rounds_updated_at
  BEFORE UPDATE ON trip_dispatch_rounds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trip_dispatch_targets_updated_at
  ON trip_dispatch_targets;
CREATE TRIGGER trip_dispatch_targets_updated_at
  BEFORE UPDATE ON trip_dispatch_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS phase5_operator_offers_updated_at
  ON phase5_operator_offers;
CREATE TRIGGER phase5_operator_offers_updated_at
  BEFORE UPDATE ON phase5_operator_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================
-- 2a. open_phase5_dispatch_round
-- ============================================
--
-- Opens a new dispatch round for a trip with N pre-built
-- targets supplied by the caller. The caller (Server Action)
-- generates target_id, nonce, sent_at, and expires_at locally
-- BEFORE this RPC call so the rebuild path in
-- issueOperatorTokenFromTarget reproduces the same HMAC token
-- byte-for-byte (iteration-3 P1 fix).
--
-- p_targets is a JSONB array of length 1..8 where each element
-- is {id, target_phone, nonce, sent_at, expires_at}.
--
-- Atomicity contract: either the new round + all N targets +
-- prior-round closure all commit, or nothing changes. A failure
-- partway leaves the trip in its pre-call state.

CREATE OR REPLACE FUNCTION open_phase5_dispatch_round(
  p_trip_id UUID,
  p_targets JSONB
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now              TIMESTAMPTZ := NOW();
  v_n                INTEGER;
  v_unique_ids       INTEGER;
  v_unique_phones    INTEGER;
  v_unique_nonces    INTEGER;
  v_trip_status      trip_request_status;
  v_prior_round_id   UUID;
  v_new_round_id     UUID;
BEGIN
  -- Step 1: validate p_targets shape (length and uniqueness).
  IF jsonb_typeof(p_targets) <> 'array' THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_targets');
  END IF;

  v_n := jsonb_array_length(p_targets);
  IF v_n IS NULL OR v_n < 1 OR v_n > 8 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_targets');
  END IF;

  SELECT
    COUNT(DISTINCT (t->>'id')::UUID),
    COUNT(DISTINCT t->>'target_phone'),
    COUNT(DISTINCT t->>'nonce')
  INTO v_unique_ids, v_unique_phones, v_unique_nonces
  FROM jsonb_array_elements(p_targets) AS t;

  IF v_unique_ids <> v_n
     OR v_unique_phones <> v_n
     OR v_unique_nonces <> v_n THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_targets');
  END IF;

  -- Step 2: lock the trip row first (lock-order discipline).
  -- Concurrent dispatch attempts on the same trip serialize
  -- behind this lock, so the prior-round-close + new-round-open
  -- sequence is strictly ordered.
  SELECT status, current_dispatch_round_id
    INTO v_trip_status, v_prior_round_id
    FROM trip_requests
    WHERE id = p_trip_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_found');
  END IF;

  -- Spec: re-dispatch is allowed from pending, distributed, OR
  -- offered. Rejected only from booked or cancelled.
  IF v_trip_status IN ('booked', 'cancelled') THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_open');
  END IF;

  -- Step 3: close the prior round (if any), cancel its
  -- still-pending targets. Existing offer rows on the prior
  -- round are NOT touched — their status stays 'pending' and
  -- they remain visible + acceptable from the unified
  -- comparison view (spec §J4).
  IF v_prior_round_id IS NOT NULL THEN
    UPDATE trip_dispatch_rounds
      SET status = 'closed',
          closed_at = v_now,
          closed_reason = 'redispatched'
      WHERE id = v_prior_round_id
        AND status = 'open';

    UPDATE trip_dispatch_targets
      SET status = 'cancelled'
      WHERE dispatch_round_id = v_prior_round_id
        AND status = 'pending';
  END IF;

  -- Step 4: insert the new round.
  INSERT INTO trip_dispatch_rounds (
    trip_request_id, status, opened_at
  ) VALUES (
    p_trip_id, 'open', v_now
  )
  RETURNING id INTO v_new_round_id;

  -- Step 5: insert N target rows using the supplied
  -- id/target_phone/nonce/sent_at/expires_at AS-IS. The
  -- table's DEFAULT NOW() for sent_at is bypassed because the
  -- column is supplied explicitly. (Iteration-3 P1 fix.)
  INSERT INTO trip_dispatch_targets (
    id, dispatch_round_id, trip_request_id,
    target_phone, nonce,
    sent_at, expires_at, status
  )
  SELECT
    (t->>'id')::UUID,
    v_new_round_id,
    p_trip_id,
    t->>'target_phone',
    t->>'nonce',
    (t->>'sent_at')::TIMESTAMPTZ,
    (t->>'expires_at')::TIMESTAMPTZ,
    'pending'
  FROM jsonb_array_elements(p_targets) AS t;

  -- Step 6: update the trip. Status moves forward only:
  -- pending → distributed; distributed and offered stay
  -- as-is. (Spec §"Status model" re-dispatch transitions.)
  UPDATE trip_requests
    SET current_dispatch_round_id = v_new_round_id,
        status = CASE
          WHEN status = 'pending' THEN 'distributed'
          ELSE status
        END
    WHERE id = p_trip_id;

  RETURN json_build_object('ok', true, 'round_id', v_new_round_id);
END;
$$;

-- See note above accept_phase4_offer's REVOKE block in the
-- Phase 4 migration: REVOKE FROM PUBLIC alone leaves anon +
-- authenticated with EXECUTE on Supabase. Both must be revoked
-- explicitly. (Phase 4 live verification round 1 P1 fix.)
REVOKE ALL ON FUNCTION open_phase5_dispatch_round(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION open_phase5_dispatch_round(UUID, JSONB)
  TO service_role;


-- ============================================
-- 2b. submit_phase5_operator_offer
-- ============================================
--
-- Operator submits an offer through a v=2 signed token URL.
-- The Server Action verifies the token's HMAC + decoded
-- payload before calling this RPC; the RPC re-verifies all
-- state inside its transaction with FOR UPDATE locks so the
-- token is necessary but never sufficient.
--
-- Lock order: parent trip → target row.
--
-- Race guards:
--   - The trip lock serializes concurrent submits and
--     concurrent admin accepts on the same trip.
--   - The target lock + nonce/round/status re-check rejects
--     any submission whose dispatch round is no longer current
--     (re-dispatch happened) or whose target was cancelled.
--   - The phase5_operator_offers_target_unique constraint
--     blocks a duplicate insert if a network retry races past
--     the application-level guard.

CREATE OR REPLACE FUNCTION submit_phase5_operator_offer(
  p_target_id              UUID,
  p_target_nonce           TEXT,
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
  v_now                    TIMESTAMPTZ := NOW();
  v_trip_id                UUID;
  v_trip_status            trip_request_status;
  v_trip_current_round_id  UUID;
  v_target                 trip_dispatch_targets%ROWTYPE;
  v_offer_id               UUID;
BEGIN
  -- Step 1: discover trip_id from the target row (no lock).
  -- trip_request_id on trip_dispatch_targets is set on INSERT
  -- and never updated, so reading it before the lock is safe.
  SELECT trip_request_id INTO v_trip_id
    FROM trip_dispatch_targets
    WHERE id = p_target_id;

  IF v_trip_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'target_not_pending');
  END IF;

  -- Step 2: lock the parent trip first.
  SELECT status, current_dispatch_round_id
    INTO v_trip_status, v_trip_current_round_id
    FROM trip_requests
    WHERE id = v_trip_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_open');
  END IF;

  IF v_trip_status IN ('booked', 'cancelled') THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_open');
  END IF;

  -- Step 3: lock the target row + re-check state inside the
  -- lock. Any of the four conditions below indicates either a
  -- re-dispatch (new nonce on the row), a stale token (wrong
  -- round), an expiry, or a non-pending target — all surface
  -- as token_stale to the operator UI, which renders the
  -- "هذا الرابط منتهي الصلاحية" page.
  SELECT * INTO v_target
    FROM trip_dispatch_targets
    WHERE id = p_target_id
    FOR UPDATE;

  IF v_target.nonce IS DISTINCT FROM p_target_nonce
     OR v_target.expires_at <= v_now
     OR v_target.dispatch_round_id IS DISTINCT FROM v_trip_current_round_id THEN
    RETURN json_build_object('ok', false, 'error', 'token_stale');
  END IF;

  IF v_target.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'target_not_pending');
  END IF;

  -- Step 4: insert the offer row. The
  -- phase5_operator_offers_target_unique constraint guarantees
  -- one offer per target — a duplicate insert from a network
  -- retry surfaces as a constraint violation.
  INSERT INTO phase5_operator_offers (
    trip_request_id, dispatch_target_id,
    operator_name, operator_phone, operator_email,
    aircraft_category, aircraft_type, aircraft_registration,
    total_price_sar,
    departure_eta, validity_hours, expires_at,
    notes,
    status
  ) VALUES (
    v_trip_id, p_target_id,
    p_operator_name, p_operator_phone, p_operator_email,
    p_aircraft_category, p_aircraft_type, p_aircraft_registration,
    p_total_price_sar,
    p_departure_eta, p_validity_hours,
    v_now + (p_validity_hours * INTERVAL '1 hour'),
    p_notes,
    'pending'
  )
  RETURNING id INTO v_offer_id;

  -- Step 5: flip the target to submitted.
  UPDATE trip_dispatch_targets
    SET status = 'submitted',
        submitted_at = v_now
    WHERE id = p_target_id;

  -- Step 6: promote the trip status forward (no-op if already
  -- offered).
  IF v_trip_status IN ('pending', 'distributed') THEN
    UPDATE trip_requests
      SET status = 'offered'
      WHERE id = v_trip_id;
  END IF;

  RETURN json_build_object('ok', true, 'offer_id', v_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION submit_phase5_operator_offer(
  UUID, TEXT, TEXT, TEXT, TEXT,
  aircraft_category, TEXT, TEXT,
  DECIMAL, TIMESTAMPTZ, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION submit_phase5_operator_offer(
  UUID, TEXT, TEXT, TEXT, TEXT,
  aircraft_category, TEXT, TEXT,
  DECIMAL, TIMESTAMPTZ, INTEGER, TEXT
) TO service_role;


-- ============================================
-- 2c. accept_offer (UNIFIED)
-- ============================================
--
-- The Phase 5 admin UI calls this RPC for BOTH Phase 4 and
-- Phase 5 offers — see spec §"Phase 4 backwards compatibility"
-- and the iteration-1 P1 fix. The legacy accept_phase4_offer
-- RPC stays in the DB for the deprecation window but is no
-- longer invoked by the application.
--
-- p_source ∈ ('phase4', 'phase5') routes the chosen-offer
-- lock + accept to the correct table. Sibling rejection
-- crosses BOTH tables in the same transaction so a Phase 4
-- offer accepted on a trip that also has Phase 5 offers
-- rejects them all (and vice versa).
--
-- Lock order: parent trip → chosen offer (in source table) →
-- sibling offers (across both tables) → still-pending Phase 5
-- targets → open dispatch rounds → trip status flip.

CREATE OR REPLACE FUNCTION accept_offer(
  p_source TEXT,
  p_offer_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now              TIMESTAMPTZ := NOW();
  v_trip_id          UUID;
  v_offer_status     offer_status;
  v_offer_expires_at TIMESTAMPTZ;
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

  -- Step 4: lock + validate the chosen offer.
  IF p_source = 'phase4' THEN
    SELECT status, expires_at
      INTO v_offer_status, v_offer_expires_at
      FROM phase4_operator_offers
      WHERE id = p_offer_id
      FOR UPDATE;
  ELSE
    SELECT status, expires_at
      INTO v_offer_status, v_offer_expires_at
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

  -- Step 5: reject every other pending sibling on this trip
  -- across BOTH tables. The trip lock held since step 3 means
  -- no concurrent submit / accept on this trip can race us;
  -- sibling row locks are acquired here with no contention
  -- beyond inserts that already waited for the trip lock in
  -- submit_phase{4,5}_operator_offer.
  --
  -- The "NOT (p_source = ... AND id = p_offer_id)" predicate
  -- excludes only the chosen offer in its own source table;
  -- the other table is rejected fully because no offer there
  -- is the one being accepted.
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

  -- Step 6: cancel every still-pending Phase 5 target on this
  -- trip. Operators who had not submitted yet will see the
  -- "هذا الرابط منتهي الصلاحية" page on next click because
  -- submit_phase5_operator_offer's target.status check fails.
  UPDATE trip_dispatch_targets
    SET status = 'cancelled'
    WHERE trip_request_id = v_trip_id
      AND status = 'pending';

  -- Step 7: close every open dispatch round on this trip.
  UPDATE trip_dispatch_rounds
    SET status = 'closed',
        closed_at = v_now,
        closed_reason = 'offer_accepted'
    WHERE trip_request_id = v_trip_id
      AND status = 'open';

  -- Step 8: flip the chosen offer to accepted.
  IF p_source = 'phase4' THEN
    UPDATE phase4_operator_offers
      SET status = 'accepted', decided_at = v_now
      WHERE id = p_offer_id;
  ELSE
    UPDATE phase5_operator_offers
      SET status = 'accepted', decided_at = v_now
      WHERE id = p_offer_id;
  END IF;

  -- Step 9: book the trip.
  UPDATE trip_requests
    SET status = 'booked'
    WHERE id = v_trip_id;

  RETURN json_build_object('ok', true, 'trip_request_id', v_trip_id);
END;
$$;

REVOKE ALL ON FUNCTION accept_offer(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_offer(TEXT, UUID)
  TO service_role;
