-- ============================================================
-- Phase 10 PR 1 — Empty Legs Client-Side Portal
--
-- Spec: aeris/docs/CLAUDE-TASK.md (Codex 100/100, round 8)
-- PR: #61 (spec) merged at e0e120f. This migration implements:
--
--   §3.1 — empty_legs.reservation_client_id + named FK + valid-states CHECK
--   §3.2 — empty_leg_notifications.client_id + email_url + multi-channel
--   §3.3 — clients.notification_preferences JSONB
--   §3.4 — bookings.source_discriminator
--   §3.6 — client_empty_leg_alert_status singleton
--   §4.1 — reserve_empty_leg_authenticated (NEW)
--   §4.3 — confirm_empty_leg_reservation_for_client (NEW)
--   §4.4 — Phase 7 patches: confirm_empty_leg_reservation +
--          admin_mark_empty_leg_sold for source_discriminator
--   §4.5 — Phase 7 patches: expire/release/admin_release/cancel
--          to ALSO clear reservation_client_id
--   §4.6 — release_empty_leg_reservation_for_client (NEW)
--
-- Conventions carried forward from Phase 9 PR 1:
--   #1  REVOKE PUBLIC + anon + authenticated; GRANT EXECUTE service_role
--   #12 ip_required guard on auth-bound RPCs
--   #15 looseClient pattern for callers
--   #19 UUID guards in route helpers (TS layer)
--
-- Replay-safety conventions (Codex round 4 + 7):
--   - All ADD COLUMN use IF NOT EXISTS
--   - All CHECK + FK constraints have explicit names + DO block guards
--   - Audit-then-RAISE before binding constraints on existing data
-- ============================================================


-- ============================================================
-- §3.1 — empty_legs.reservation_client_id + named FK + valid-states CHECK
--
-- Adds the column for State C (CLIENT) reservations + a named FK
-- with ON DELETE RESTRICT (round 6 P1 #1 — SET NULL would corrupt
-- the valid-states CHECK on hard-delete) + a 4-step replay-safe
-- sequence (round 7 P2 #3) so partial replays from earlier draft
-- versions can't leave the wrong FK action in place.
-- ============================================================

-- Step 1: add the column WITHOUT inline FK
ALTER TABLE empty_legs
  ADD COLUMN IF NOT EXISTS reservation_client_id UUID;

-- Step 2: drop any prior FK constraint on the column (covers the
-- replay-from-round-6-draft case where the prior spec wrote
-- ON DELETE SET NULL via inline FK with the conventional auto name).
ALTER TABLE empty_legs
  DROP CONSTRAINT IF EXISTS empty_legs_reservation_client_id_fkey;
ALTER TABLE empty_legs
  DROP CONSTRAINT IF EXISTS empty_legs_reservation_client_fkey;

-- Step 3: add the named FK with ON DELETE RESTRICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'empty_legs_reservation_client_fkey'
       AND conrelid = 'empty_legs'::regclass
  ) THEN
    ALTER TABLE empty_legs
      ADD CONSTRAINT empty_legs_reservation_client_fkey
      FOREIGN KEY (reservation_client_id)
      REFERENCES clients(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Step 4: partial index for the State C lookup path
CREATE INDEX IF NOT EXISTS idx_empty_legs_reservation_client
  ON empty_legs (reservation_client_id)
  WHERE reservation_client_id IS NOT NULL;

-- Replace Phase 7's pair-check with the 3-state OR (Codex round 1
-- P1 #1). State A: NO reservation, State B: GUEST, State C: CLIENT.
ALTER TABLE empty_legs
  DROP CONSTRAINT IF EXISTS empty_legs_reservation_pair_check;

ALTER TABLE empty_legs
  ADD CONSTRAINT empty_legs_reservation_pair_check CHECK (
    -- State A: NO reservation (all 5 columns NULL)
    (
      reservation_token_hash               IS NULL
      AND reservation_expires_at           IS NULL
      AND reservation_customer_name_snapshot  IS NULL
      AND reservation_customer_phone_snapshot IS NULL
      AND reservation_client_id            IS NULL
    )
    OR
    -- State B: GUEST reservation (4-pair NOT NULL, client_id NULL)
    (
      reservation_token_hash               IS NOT NULL
      AND reservation_expires_at           IS NOT NULL
      AND reservation_customer_name_snapshot  IS NOT NULL
      AND reservation_customer_phone_snapshot IS NOT NULL
      AND reservation_client_id            IS NULL
    )
    OR
    -- State C: CLIENT reservation (client_id + expires_at NOT NULL,
    -- token_hash + 2 snapshots NULL — client snapshots come from
    -- the clients table at read time)
    (
      reservation_token_hash               IS NULL
      AND reservation_expires_at           IS NOT NULL
      AND reservation_customer_name_snapshot  IS NULL
      AND reservation_customer_phone_snapshot IS NULL
      AND reservation_client_id            IS NOT NULL
    )
  );


-- ============================================================
-- §3.2 — empty_leg_notifications.client_id + email_url +
--        multi-channel row model + XOR check + indexes
--
-- Allows the matching engine to write a match row keyed on a
-- client (not just a lead). Multi-channel row model (round 4 P1 #1):
-- channel can be 'whatsapp_link' | 'email' | 'email_and_wa' with
-- per-channel URL pair check pinning which URLs must be populated.
-- ============================================================

ALTER TABLE empty_leg_notifications
  ADD COLUMN IF NOT EXISTS client_id UUID
    REFERENCES clients(id) ON DELETE CASCADE;

-- Drop the legacy NOT NULL on lead_inquiry_id (round 1 P1 #2).
-- The XOR below enforces "exactly one of {client, lead}".
ALTER TABLE empty_leg_notifications
  ALTER COLUMN lead_inquiry_id DROP NOT NULL;

-- Add email_url + drop NOT NULL on wa_url (round 4 P1 #1).
ALTER TABLE empty_leg_notifications
  ADD COLUMN IF NOT EXISTS email_url TEXT;

ALTER TABLE empty_leg_notifications
  ALTER COLUMN wa_url DROP NOT NULL;

-- Drop + recreate the channel CHECK to allow the two new values.
ALTER TABLE empty_leg_notifications
  DROP CONSTRAINT IF EXISTS empty_leg_notifications_channel_check;

ALTER TABLE empty_leg_notifications
  ADD CONSTRAINT empty_leg_notifications_channel_check CHECK (
    channel IN ('whatsapp_link', 'email', 'email_and_wa')
  );

-- Per-channel URL pair pre-audit. Phase 7 production rows are
-- guaranteed to conform (channel='whatsapp_link' + wa_url NOT NULL
-- + email_url NULL by default), so this audit reports zero in
-- healthy production.
DO $$
DECLARE
  v_offending_count INT;
BEGIN
  SELECT COUNT(*) INTO v_offending_count
    FROM empty_leg_notifications
   WHERE NOT (
     (channel = 'whatsapp_link'  AND wa_url IS NOT NULL AND email_url IS NULL)
     OR (channel = 'email'        AND email_url IS NOT NULL AND wa_url IS NULL)
     OR (channel = 'email_and_wa' AND wa_url IS NOT NULL AND email_url IS NOT NULL)
   );
  IF v_offending_count > 0 THEN
    RAISE EXCEPTION 'PR 1 migration: empty_leg_notifications has % rows that violate the per-channel URL pair check; manual cleanup required',
      v_offending_count;
  END IF;
END $$;

ALTER TABLE empty_leg_notifications
  DROP CONSTRAINT IF EXISTS empty_leg_notifications_channel_url_pair_check;

ALTER TABLE empty_leg_notifications
  ADD CONSTRAINT empty_leg_notifications_channel_url_pair_check CHECK (
    (channel = 'whatsapp_link'  AND wa_url IS NOT NULL AND email_url IS NULL)
    OR (channel = 'email'        AND email_url IS NOT NULL AND wa_url IS NULL)
    OR (channel = 'email_and_wa' AND wa_url IS NOT NULL AND email_url IS NOT NULL)
  );

-- Recipient XOR pre-audit (round 2 P1 #3 + round 3 P2 #2).
-- Phase 7 production rows have lead_inquiry_id NOT NULL +
-- client_id NULL by definition, so the audit reports zero.
DO $$
DECLARE
  v_offending_count INT;
BEGIN
  SELECT COUNT(*) INTO v_offending_count
    FROM empty_leg_notifications
   WHERE NOT ((client_id IS NULL) <> (lead_inquiry_id IS NULL));
  IF v_offending_count > 0 THEN
    RAISE EXCEPTION 'PR 1 migration: empty_leg_notifications has % rows that violate the recipient XOR (both NULL or both populated); manual cleanup required before the constraint can be added',
      v_offending_count;
  END IF;
END $$;

ALTER TABLE empty_leg_notifications
  DROP CONSTRAINT IF EXISTS empty_leg_notifications_recipient_xor_check;

ALTER TABLE empty_leg_notifications
  ADD CONSTRAINT empty_leg_notifications_recipient_xor_check CHECK (
    (client_id IS NULL) <> (lead_inquiry_id IS NULL)
  );

-- Sibling unique index for client+leg dedupe (mirror of the
-- existing lead+leg uniqueness on the lead path).
CREATE UNIQUE INDEX IF NOT EXISTS idx_empty_leg_notifications_client_leg_unique
  ON empty_leg_notifications (client_id, leg_id)
  WHERE client_id IS NOT NULL;

-- Frequency cap (5/24h) index keyed on client.
CREATE INDEX IF NOT EXISTS idx_empty_leg_notifications_client_24h
  ON empty_leg_notifications (client_id, sent_at DESC)
  WHERE client_id IS NOT NULL;


-- ============================================================
-- §3.3 — clients.notification_preferences JSONB
--
-- Single forward-extensible JSONB column. Default empty object;
-- app code COALESCEs missing keys to opt-in (see §3.3 helper
-- isClientOptedIn in lib/clients/notification-preferences.ts).
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB
  NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN clients.notification_preferences IS
  'Per-client opt-in/opt-out per (category, channel). Missing keys default to opt-in. Phase 10 ships empty_legs.{email,wa_link}; later phases extend.';


-- ============================================================
-- §3.4 — bookings.source_discriminator
--
-- 4-step replay-safe: ADD COLUMN nullable + backfill via CASE +
-- named CHECK constraint via DO block + flip NOT NULL + DEFAULT.
-- The DEFAULT='charter' is LOAD-BEARING for Phase 9 accept_offer
-- (round 6 P2 #4 lock — PR 1 does NOT patch accept_offer).
-- ============================================================

-- Step 1: add the column NULLABLE (NO inline CHECK; named in step 3).
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS source_discriminator TEXT;

-- Step 2: backfill from source_offer_table (Phase 6/7 column).
-- Idempotent: WHERE source_discriminator IS NULL ensures replay safety.
UPDATE bookings
   SET source_discriminator = CASE
     WHEN source_offer_table = 'phase7_empty_leg' THEN 'empty_leg'
     ELSE 'charter'
   END
 WHERE source_discriminator IS NULL;

-- Step 3: add the named CHECK constraint AFTER backfill so existing
-- rows are valid before the constraint binds. Replay-safe pg_constraint
-- guard mirrors the §3.1 + §3.2 discipline.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bookings_source_discriminator_check'
       AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_source_discriminator_check
      CHECK (source_discriminator IN ('charter', 'empty_leg'));
  END IF;
END $$;

-- Step 4: flip NOT NULL + DEFAULT for forward writes. The DEFAULT
-- IS LOAD-BEARING for accept_offer (round 6 P2 #4 + round 7 P2 #4).
-- §4.3, §4.4 RPCs write 'empty_leg' explicitly; DEFAULT is the
-- safety-net for accept_offer only.
ALTER TABLE bookings
  ALTER COLUMN source_discriminator SET NOT NULL;

ALTER TABLE bookings
  ALTER COLUMN source_discriminator SET DEFAULT 'charter';

-- Index for the unified /me/bookings query (client_id + chip filter).
CREATE INDEX IF NOT EXISTS idx_bookings_client_source
  ON bookings (client_id, source_discriminator, created_at DESC)
  WHERE client_id IS NOT NULL;


-- ============================================================
-- §3.6 — client_empty_leg_alert_status singleton (NEW)
--
-- Tracks operational health of the client empty-leg email channel
-- (covers BOTH match-email and reservation-email surfaces — round 7
-- P1 #2 — single canary card represents Resend health for all client
-- empty-leg emails). Mirrors the Phase 7 / 8 / 9 alert-singleton
-- pattern; 5th canary card on /admin/operators/canary.
-- ============================================================

CREATE TABLE IF NOT EXISTS client_empty_leg_alert_status (
  id                   INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status               TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'config_missing', 'send_failed')),
  last_failure_at      TIMESTAMPTZ,
  last_failure_reason  TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO client_empty_leg_alert_status (id, status)
  VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE client_empty_leg_alert_status ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §4.1 — reserve_empty_leg_authenticated (NEW)
--
-- Authenticated client reserves a leg in-place. Mirrors Phase 9
-- create_authenticated_trip_request shape: client guard +
-- advisory lock + SELECT FOR UPDATE + UPDATE + structured errors.
-- TTL = 1 hour (Decision #9), capped at auction_window_end_at.
-- ============================================================

CREATE OR REPLACE FUNCTION reserve_empty_leg_authenticated(
  p_client_id UUID,
  p_leg_id    UUID,
  p_ip        INET
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_row    RECORD;
  v_leg_row       RECORD;
  v_now           TIMESTAMPTZ := NOW();
  v_expires_at    TIMESTAMPTZ;
BEGIN
  -- ip_required guard (Phase 9 PR 1 convention #12)
  IF p_ip IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ip_required');
  END IF;

  -- 1. Client lookup + status guard
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

  -- 2. Per-leg advisory lock (Phase 9 convention)
  PERFORM pg_advisory_xact_lock(
    ('x' || substr(md5(p_leg_id::text), 1, 16))::bit(64)::bigint
  );

  -- 3. Leg lookup + state guards
  SELECT id, status, auction_window_end_at,
         reservation_token_hash, reservation_client_id,
         max_passengers, current_price
    INTO v_leg_row
    FROM empty_legs
   WHERE id = p_leg_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  IF v_leg_row.status <> 'available' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reservable');
  END IF;

  -- Guard: leg already reserved (by anyone — guest or client)
  IF v_leg_row.reservation_token_hash IS NOT NULL
     OR v_leg_row.reservation_client_id IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_already_reserved');
  END IF;

  -- Guard: auction window closed
  IF v_leg_row.auction_window_end_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'auction_window_closed');
  END IF;

  -- 4. Compute reservation TTL: 1 hour (Decision #9), capped at
  --    auction window end (so reservation never outlives the offer).
  v_expires_at := LEAST(
    v_now + INTERVAL '1 hour',
    v_leg_row.auction_window_end_at
  );

  -- 5. Apply the reservation in-place (State C)
  UPDATE empty_legs
     SET reservation_client_id = v_client_row.id,
         reservation_expires_at = v_expires_at,
         status = 'reserved'
   WHERE id = p_leg_id;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'reserved_at', v_now,
    'expires_at', v_expires_at,
    'price_at_reservation', v_leg_row.current_price
  );
END;
$$;

REVOKE ALL ON FUNCTION reserve_empty_leg_authenticated(UUID, UUID, INET)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_empty_leg_authenticated(UUID, UUID, INET)
  TO service_role;


-- ============================================================
-- §4.3 — confirm_empty_leg_reservation_for_client (NEW)
--
-- Admin confirms a State C (CLIENT) reservation. Parallel to
-- Phase 7 confirm_empty_leg_reservation (guest path); the existing
-- guest RPC stays unchanged. Booking column shape mirrors Phase 7
-- exactly with these *DIFF*s:
--   - source_discriminator='empty_leg' (Phase 10 §3.4)
--   - client_id NOT NULL (auth path)
--   - customer_name + customer_phone snapshots from clients table
-- ============================================================

CREATE OR REPLACE FUNCTION confirm_empty_leg_reservation_for_client(
  p_leg_id        UUID,
  p_admin_user_id UUID
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_now         TIMESTAMPTZ := NOW();
  v_leg         empty_legs%ROWTYPE;
  v_client_row  RECORD;
  v_booking_id  UUID;
BEGIN
  -- 1. Lock the leg row + verify State C
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT * INTO v_leg FROM empty_legs WHERE id = p_leg_id;

  IF v_leg.status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  IF v_leg.reservation_client_id IS NULL THEN
    -- Guest reservation — caller used the wrong RPC.
    RETURN json_build_object('ok', false, 'error', 'not_a_client_reservation');
  END IF;

  IF v_leg.reservation_expires_at IS NOT NULL
     AND v_leg.reservation_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_expired');
  END IF;

  -- Route presence guard (mirrors Phase 7 confirm RPC)
  IF v_leg.departure_airport IS NULL
     AND v_leg.departure_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_origin_missing');
  END IF;

  IF v_leg.arrival_airport IS NULL
     AND v_leg.arrival_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_destination_missing');
  END IF;

  -- 2. Live client snapshot (State C reservations don't carry
  --    snapshot columns — Decision #1 + §3.1 State C).
  SELECT id, full_name, contact_phone, signup_status
    INTO v_client_row
    FROM clients
   WHERE id = v_leg.reservation_client_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  -- We do NOT block on client_not_active here: a client whose status
  -- flipped to 'suspended' between reserve and confirm still gets the
  -- booking row. Admin can manually cancel via existing booking-cancel
  -- flow.

  -- 3. INSERT bookings row — column shape mirrors Phase 7 confirm
  --    EXACTLY. *DIFF* comments mark the divergences.
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
    source_discriminator,             -- *DIFF* Phase 10 §3.4
    client_id,                         -- *DIFF* NOT NULL (auth path)
    customer_name_snapshot,            -- *DIFF* from clients table
    customer_phone_snapshot,           -- *DIFF* from clients table
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
    NULL,                                            -- offer_id
    NULL,                                            -- trip_request_id
    v_leg.departure_airport,
    v_leg.arrival_airport,
    v_leg.departure_airport_freeform_snapshot,
    v_leg.arrival_airport_freeform_snapshot,
    v_leg.max_passengers,
    NULL,                                            -- return_scheduled (one-way)
    'phase7_empty_leg',                              -- source_offer_table
    v_leg.id,                                        -- source_offer_id
    'empty_leg',                                     -- *DIFF* source_discriminator
    v_client_row.id,                                 -- *DIFF* client_id
    v_client_row.full_name,                          -- *DIFF* customer_name_snapshot
    v_client_row.contact_phone,                      -- *DIFF* customer_phone_snapshot
    v_leg.operator_id,
    v_leg.operator_name_snapshot,
    v_leg.operator_phone_snapshot,
    v_leg.operator_email_snapshot,
    v_leg.aircraft_id,
    v_leg.aircraft_snapshot,
    v_leg.current_price,                             -- base_amount
    0,                                               -- addons_amount
    NULL,                                            -- vat_amount (Decision #12)
    v_leg.current_price,                             -- total_amount
    NULL,                                            -- commission_amount (Decision #12)
    NULL,                                            -- operator_payout (Decision #12)
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_leg.departure_window_start,                    -- departure_scheduled
    NULL,                                            -- checkout_token_hash
    NULL                                             -- checkout_token_expires_at
  )
  RETURNING id INTO v_booking_id;

  -- 4. Clear reservation + flip leg to sold + link booking back
  UPDATE empty_legs
     SET status                 = 'sold',
         customer_booking_id    = v_booking_id,
         reservation_client_id  = NULL,
         reservation_expires_at = NULL
   WHERE id = p_leg_id;

  -- 5. Audit log entry. round 3 P1 #1: audit_logs has user_id (NOT
  --    actor_id), FK to users(id) ON DELETE SET NULL. Aeris admin
  --    auth is cookie + env-var based; admins do NOT have a users
  --    row, so user_id=NULL + admin id stashed in new_value.
  INSERT INTO audit_logs (
    entity_type, entity_id, action, new_value, user_id
  ) VALUES (
    'booking', v_booking_id, 'empty_leg_client_confirmed',
    jsonb_build_object(
      'leg_id', v_leg.id,
      'client_id', v_client_row.id,
      'admin_user_id', p_admin_user_id,
      'confirmed_at', v_now
    ),
    NULL
  );

  RETURN json_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'leg_id', v_leg.id,
    'client_id', v_client_row.id,
    'confirmed_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION confirm_empty_leg_reservation_for_client(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_empty_leg_reservation_for_client(UUID, UUID)
  TO service_role;


-- ============================================================
-- §4.4.1 — confirm_empty_leg_reservation (Phase 7 patch)
--
-- Phase 7 reference: 20260510000011_phase_7_empty_legs_rpcs.sql §5
-- line 615. Diff vs Phase 7 original: + source_discriminator column
-- + 'empty_leg' value. All other behaviour preserved.
-- ============================================================

CREATE OR REPLACE FUNCTION confirm_empty_leg_reservation(
  p_leg_id     UUID,
  p_token_hash VARCHAR(64)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now             TIMESTAMPTZ := NOW();
  v_leg             empty_legs%ROWTYPE;
  v_booking_id      UUID;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT * INTO v_leg FROM empty_legs WHERE id = p_leg_id;

  IF v_leg.status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  IF v_leg.reservation_expires_at IS NOT NULL
     AND v_leg.reservation_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_expired');
  END IF;

  IF p_token_hash IS NULL
     OR v_leg.reservation_token_hash IS DISTINCT FROM p_token_hash THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_token_mismatch');
  END IF;

  IF v_leg.reservation_customer_name_snapshot IS NULL
     OR v_leg.reservation_customer_phone_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_state_invalid');
  END IF;

  IF v_leg.departure_airport IS NULL
     AND v_leg.departure_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_origin_missing');
  END IF;

  IF v_leg.arrival_airport IS NULL
     AND v_leg.arrival_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_destination_missing');
  END IF;

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
    source_discriminator,             -- *DIFF* Phase 10 §3.4
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
    NULL,
    NULL,
    v_leg.departure_airport,
    v_leg.arrival_airport,
    v_leg.departure_airport_freeform_snapshot,
    v_leg.arrival_airport_freeform_snapshot,
    v_leg.max_passengers,
    NULL,
    'phase7_empty_leg',
    v_leg.id,
    'empty_leg',                                     -- *DIFF* source_discriminator
    NULL,
    v_leg.reservation_customer_name_snapshot,
    v_leg.reservation_customer_phone_snapshot,
    v_leg.operator_id,
    v_leg.operator_name_snapshot,
    v_leg.operator_phone_snapshot,
    v_leg.operator_email_snapshot,
    v_leg.aircraft_id,
    v_leg.aircraft_snapshot,
    v_leg.current_price,
    0,
    NULL,
    v_leg.current_price,
    NULL,
    NULL,
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_leg.departure_window_start,
    NULL,
    NULL
  )
  RETURNING id INTO v_booking_id;

  UPDATE empty_legs
    SET status = 'sold',
        customer_booking_id = v_booking_id,
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL
    WHERE id = p_leg_id;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'booking_id', v_booking_id
  );
END;
$$;

REVOKE ALL ON FUNCTION confirm_empty_leg_reservation(UUID, VARCHAR)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_empty_leg_reservation(UUID, VARCHAR)
  TO service_role;


-- ============================================================
-- §4.4.2 — admin_mark_empty_leg_sold (Phase 7 patch)
--
-- Phase 7 reference: same migration §11 line 1085. Diff vs original:
-- + source_discriminator column + 'empty_leg' value.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_mark_empty_leg_sold(
  p_leg_id         UUID,
  p_customer_name  TEXT,
  p_customer_phone TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now            TIMESTAMPTZ := NOW();
  v_leg            empty_legs%ROWTYPE;
  v_booking_id     UUID;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT * INTO v_leg FROM empty_legs WHERE id = p_leg_id;

  IF v_leg.status <> 'available' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_available');
  END IF;

  IF v_leg.auction_window_end_at IS NOT NULL
     AND v_leg.auction_window_end_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'leg_window_closed');
  END IF;

  IF NULLIF(TRIM(p_customer_name), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_name_missing');
  END IF;

  IF NULLIF(TRIM(p_customer_phone), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_phone_missing');
  END IF;

  IF v_leg.departure_airport IS NULL
     AND v_leg.departure_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_origin_missing');
  END IF;

  IF v_leg.arrival_airport IS NULL
     AND v_leg.arrival_airport_freeform_snapshot IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'leg_route_destination_missing');
  END IF;

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
    source_discriminator,             -- *DIFF* Phase 10 §3.4
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
    NULL,
    NULL,
    v_leg.departure_airport,
    v_leg.arrival_airport,
    v_leg.departure_airport_freeform_snapshot,
    v_leg.arrival_airport_freeform_snapshot,
    v_leg.max_passengers,
    NULL,
    'phase7_empty_leg',
    v_leg.id,
    'empty_leg',                                     -- *DIFF* source_discriminator
    NULL,
    TRIM(p_customer_name),
    TRIM(p_customer_phone),
    v_leg.operator_id,
    v_leg.operator_name_snapshot,
    v_leg.operator_phone_snapshot,
    v_leg.operator_email_snapshot,
    v_leg.aircraft_id,
    v_leg.aircraft_snapshot,
    v_leg.current_price,
    0,
    NULL,
    v_leg.current_price,
    NULL,
    NULL,
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_leg.departure_window_start,
    NULL,
    NULL
  )
  RETURNING id INTO v_booking_id;

  UPDATE empty_legs
    SET status = 'sold',
        customer_booking_id = v_booking_id
    WHERE id = p_leg_id;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'booking_id', v_booking_id
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_mark_empty_leg_sold(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_mark_empty_leg_sold(UUID, TEXT, TEXT)
  TO service_role;


-- ============================================================
-- §4.5.1 — expire_empty_leg_reservation (Phase 7 patch — cron path)
--
-- Phase 7 reference: same migration §9 line 957. Cron-callable
-- per-leg RPC; the cron route at /api/cron/empty-legs/expire-reservations
-- calls this for each leg where status='reserved' AND
-- reservation_expires_at <= NOW().
-- Diff vs Phase 7 original: + reservation_client_id = NULL on the
-- UPDATE SET clause. All other behaviour preserved.
-- ============================================================

CREATE OR REPLACE FUNCTION expire_empty_leg_reservation(
  p_leg_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now             TIMESTAMPTZ := NOW();
  v_status          empty_leg_status;
  v_expires_at      TIMESTAMPTZ;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, reservation_expires_at
    INTO v_status, v_expires_at
    FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  IF v_expires_at IS NULL OR v_expires_at > v_now THEN
    RETURN json_build_object('ok', true, 'no_op', true);
  END IF;

  UPDATE empty_legs
    SET status = 'available',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL,
        reservation_client_id = NULL          -- *DIFF* Phase 10 §3.1
    WHERE id = p_leg_id;

  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION expire_empty_leg_reservation(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_empty_leg_reservation(UUID)
  TO service_role;


-- ============================================================
-- §4.5.2 — release_empty_leg_reservation (Phase 7 patch — token release)
--
-- Phase 7 reference: same migration §6 line 777. Token-bound
-- customer-initiated release. State C reservations have no token,
-- so the existing token-mismatch guard naturally rejects them — but
-- the defensive reservation_client_id = NULL belongs in the SET
-- clause regardless (round 5 P1 #2 — defense-in-depth).
-- ============================================================

CREATE OR REPLACE FUNCTION release_empty_leg_reservation(
  p_leg_id     UUID,
  p_token_hash VARCHAR(64)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status   empty_leg_status;
  v_hash     VARCHAR(64);
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, reservation_token_hash INTO v_status, v_hash
    FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  IF p_token_hash IS NULL
     OR v_hash IS DISTINCT FROM p_token_hash THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_token_mismatch');
  END IF;

  UPDATE empty_legs
    SET status = 'available',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL,
        reservation_client_id = NULL          -- *DIFF* Phase 10 §3.1
    WHERE id = p_leg_id;

  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION release_empty_leg_reservation(UUID, VARCHAR)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_empty_leg_reservation(UUID, VARCHAR)
  TO service_role;


-- ============================================================
-- §4.5.3 — admin_release_empty_leg_reservation (Phase 7 patch)
--
-- Phase 7 reference: same migration §7 line 840. Admin "إلغاء
-- التحفظ" button. After Phase 10, the same admin affordance
-- handles State C client reservations too via a relabeled UI.
-- Diff vs Phase 7 original: + reservation_client_id = NULL.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_release_empty_leg_reservation(
  p_leg_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status empty_leg_status;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status INTO v_status FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'reserved' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_reserved');
  END IF;

  UPDATE empty_legs
    SET status = 'available',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL,
        reservation_client_id = NULL          -- *DIFF* Phase 10 §3.1
    WHERE id = p_leg_id;

  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION admin_release_empty_leg_reservation(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_release_empty_leg_reservation(UUID)
  TO service_role;


-- ============================================================
-- §4.5.4 — cancel_empty_leg (Phase 7 patch — terminal cancel)
--
-- Phase 7 reference: same migration §8 line 893. Terminal cancel
-- (flips to 'cancelled', not 'available'). When a State C
-- reservation exists at cancel time, this clears the client's hold
-- + flips the leg terminal.
-- Diff vs Phase 7 original: + reservation_client_id = NULL.
-- ============================================================

CREATE OR REPLACE FUNCTION cancel_empty_leg(
  p_leg_id UUID,
  p_reason TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status empty_leg_status;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status INTO v_status FROM empty_legs WHERE id = p_leg_id;

  IF v_status NOT IN ('available', 'reserved') THEN
    RETURN json_build_object('ok', false,
      'error', CASE v_status
                 WHEN 'sold' THEN 'leg_sold_use_booking_flow'
                 ELSE 'leg_terminal'
               END);
  END IF;

  UPDATE empty_legs
    SET status = 'cancelled',
        reservation_token_hash = NULL,
        reservation_expires_at = NULL,
        reservation_customer_name_snapshot = NULL,
        reservation_customer_phone_snapshot = NULL,
        reservation_client_id = NULL          -- *DIFF* Phase 10 §3.1
    WHERE id = p_leg_id;

  INSERT INTO audit_logs (entity_type, entity_id, action, new_value)
    VALUES (
      'empty_legs', p_leg_id, 'cancel',
      jsonb_build_object('reason', NULLIF(TRIM(p_reason), ''))
    );

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION cancel_empty_leg(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_empty_leg(UUID, TEXT)
  TO service_role;


-- ============================================================
-- §4.6 — release_empty_leg_reservation_for_client (NEW)
--
-- Client-initiated cancel. Triple ownership/state/TTL guard
-- collapsed to single opaque cancel_not_allowed (round 6 P1 #2 +
-- Phase 9 PR 3 P1 #2 opaque-error pattern). Clears the full
-- reservation tuple, flips status='available', recomputes price.
-- ============================================================

CREATE OR REPLACE FUNCTION release_empty_leg_reservation_for_client(
  p_leg_id    UUID,
  p_client_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now      TIMESTAMPTZ := NOW();
  v_leg      empty_legs%ROWTYPE;
BEGIN
  -- 1. Lock the leg row + load it
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT * INTO v_leg FROM empty_legs WHERE id = p_leg_id;

  -- 2. Triple guard collapsed to opaque error (Phase 9 PR 3 pattern)
  IF v_leg.status <> 'reserved'
     OR v_leg.reservation_client_id IS DISTINCT FROM p_client_id
     OR v_leg.reservation_expires_at IS NULL
     OR v_leg.reservation_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'cancel_not_allowed');
  END IF;

  -- 3. Clear full reservation tuple + flip back to 'available'.
  --    Mirrors §4.5.3 admin_release SET list exactly so all three
  --    release paths (admin, cron expire, client cancel) leave
  --    identical post-state.
  UPDATE empty_legs
     SET status                              = 'available',
         reservation_token_hash              = NULL,
         reservation_expires_at              = NULL,
         reservation_customer_name_snapshot  = NULL,
         reservation_customer_phone_snapshot = NULL,
         reservation_client_id               = NULL
   WHERE id = p_leg_id;

  -- 4. Re-snap current_price onto the Dutch-auction curve.
  --    SECURITY DEFINER lets us call the locked-down helper that
  --    service_role cannot reach directly.
  PERFORM _recompute_empty_leg_price(p_leg_id);

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'released_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION release_empty_leg_reservation_for_client(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_empty_leg_reservation_for_client(UUID, UUID)
  TO service_role;


-- ============================================================
-- END OF PR 1 MIGRATION
--
-- Post-migration shape (Probe 21 verifies):
--   - 4 new columns: empty_legs.reservation_client_id,
--     empty_leg_notifications.{client_id, email_url},
--     bookings.source_discriminator, clients.notification_preferences
--   - 1 new table: client_empty_leg_alert_status (singleton)
--   - 9 RPCs: 3 NEW + 6 patches (4 reservation-clearing + 2 booking-write)
--   - 5 named constraints: pair_check, channel_check, channel_url_pair_check,
--     recipient_xor_check, source_discriminator_check, FK with RESTRICT
--   - 4 indexes: reservation_client (partial), client_leg_unique (partial),
--     client_24h (partial), client_source (partial)
-- ============================================================
