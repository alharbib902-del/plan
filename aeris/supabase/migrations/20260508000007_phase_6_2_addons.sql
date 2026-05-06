-- ============================================================
-- Phase 6.2 — Priced Add-ons + Booking-shaped Checkout-prep
-- PR 1, File A: schema reshape + ENUM ADD VALUE
-- ============================================================
--
-- Idempotent (safe to re-run). Every constraint addition is
-- wrapped in a `pg_constraint` DO block; every column is
-- `IF NOT EXISTS`; every ENUM value is `pg_enum`-checked.
-- Founder probe #5 re-runs PR 1's three migration files and
-- expects zero changes.
--
-- This file ships in PR 1 ALONGSIDE File B
-- (20260508000008_phase_6_2_payment_default.sql) and File C
-- (20260508000009_phase_6_2_addon_catalog.sql). Each file is
-- a separate Supabase migration session; sequencing is:
--   File A → ENUM extension committed → File B → SET DEFAULT
--   uses the new value → File C → addon_catalog table + seed
--
-- This file does NOT extend `accept_offer`. The body extension
-- + the five mutation RPCs + backfill ship in PR 2a's
-- 20260509000008_phase_6_2_accept_offer.sql.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Relax bookings.client_id (guest mode).
-- ------------------------------------------------------------
ALTER TABLE bookings
  ALTER COLUMN client_id DROP NOT NULL;

-- ------------------------------------------------------------
-- 2. Relax bookings.operator_id. Phase 4 / Phase 5 offers
--    carry NO operator_id at all — they store free-text
--    operator_name/phone/email snapshots only. The `operators`
--    table is empty in production (no operator onboarding flow
--    has shipped). Forcing a NOT NULL FK to operators(id)
--    would make every accept_offer booking insert fail. Per
--    Codex iteration-1 P1 #1 fix.
-- ------------------------------------------------------------
ALTER TABLE bookings
  ALTER COLUMN operator_id DROP NOT NULL;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS operator_name_snapshot VARCHAR(120),
  ADD COLUMN IF NOT EXISTS operator_phone_snapshot VARCHAR(20),
  ADD COLUMN IF NOT EXISTS operator_email_snapshot VARCHAR(120);

-- ------------------------------------------------------------
-- 3. Relax bookings.aircraft_id. Phase 4 / Phase 5 offers
--    carry no aircraft_id (freeform aircraft description).
--    The booking records a snapshot of the offered aircraft
--    text via aircraft_snapshot.
-- ------------------------------------------------------------
ALTER TABLE bookings
  ALTER COLUMN aircraft_id DROP NOT NULL;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS aircraft_snapshot TEXT;

-- ------------------------------------------------------------
-- 4. Customer-identity snapshot columns (mirror Phase 4
--    trip_requests pattern). Either client_id OR a snapshot
--    of customer_name/customer_phone is required (enforced
--    by the identity check below).
-- ------------------------------------------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS customer_name_snapshot VARCHAR(120),
  ADD COLUMN IF NOT EXISTS customer_phone_snapshot VARCHAR(20);

-- ------------------------------------------------------------
-- 5. bookings_identity_check constraint (idempotent).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_identity_check'
      AND conrelid = 'bookings'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE bookings
        ADD CONSTRAINT bookings_identity_check CHECK (
          client_id IS NOT NULL
          OR (customer_name_snapshot IS NOT NULL
              AND customer_phone_snapshot IS NOT NULL)
        )
    $sql$;
  END IF;
END$$;

-- ------------------------------------------------------------
-- 6. Customer checkout-prep token (S5). Both columns are
--    nullable — issued by the founder manually after the
--    WhatsApp coordination call, NOT at accept_offer time.
--    A paired CHECK ensures the two columns appear or
--    disappear together so no half-issued state is reachable.
--    Codex iteration-2 P1 fix.
-- ------------------------------------------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS checkout_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS checkout_token_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_checkout_token
  ON bookings(checkout_token_hash)
  WHERE checkout_token_hash IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_checkout_token_pair_check'
      AND conrelid = 'bookings'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE bookings
        ADD CONSTRAINT bookings_checkout_token_pair_check CHECK (
          (checkout_token_hash IS NULL)
            = (checkout_token_expires_at IS NULL)
        )
    $sql$;
  END IF;
END$$;

-- ------------------------------------------------------------
-- 7. Source-offer linkage. The legacy bookings.offer_id FK
--    points at the unused `offers` table; Phase 4 / Phase 5
--    use phase4_operator_offers and phase5_operator_offers
--    instead. Track origin via a discriminator + UUID pair.
--    No FK because the target table is one-of-two; the read
--    path joins by source_offer_table to the right table.
--
--    Two CHECKs together: one bounds the discriminator to
--    the known values; the other enforces that the
--    discriminator and the UUID appear or disappear together
--    (no half-state). Codex iteration-2 P2 fix.
-- ------------------------------------------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS source_offer_table VARCHAR(20),
  ADD COLUMN IF NOT EXISTS source_offer_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_source_offer_check'
      AND conrelid = 'bookings'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE bookings
        ADD CONSTRAINT bookings_source_offer_check CHECK (
          source_offer_table IN ('phase4', 'phase5')
          OR source_offer_table IS NULL
        )
    $sql$;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_source_offer_pair_check'
      AND conrelid = 'bookings'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE bookings
        ADD CONSTRAINT bookings_source_offer_pair_check CHECK (
          (source_offer_table IS NULL)
            = (source_offer_id IS NULL)
        )
    $sql$;
  END IF;
END$$;

-- ------------------------------------------------------------
-- 8. Pre-allocated breakdown columns may be NULL when the
--    parent offer is from phase4/phase5 (no breakdown data).
--    Make vat_amount / commission_amount / operator_payout
--    nullable so the booking row can be created without
--    forcing a fictitious breakdown. Phase 11 will compute
--    these from real payment capture; Phase 6.2 leaves them
--    NULL by default.
-- ------------------------------------------------------------
ALTER TABLE bookings
  ALTER COLUMN vat_amount DROP NOT NULL,
  ALTER COLUMN commission_amount DROP NOT NULL,
  ALTER COLUMN operator_payout DROP NOT NULL;

-- ------------------------------------------------------------
-- 9. addon_subtype CHECK constraint (idempotent). Pins the
--    20 known subtypes at the DB layer as defense-in-depth
--    behind File C's seeded `addon_catalog` table.
--
--    The list MUST stay in sync with `lib/addons/catalog.ts`
--    AND with the `addon_catalog.subtype` PK set in File C.
--    Drift is caught at CI by `catalog-vs-seed.test.ts`
--    (Layer 1, no DB) + at deploy time by founder Probe 2b
--    (Layer 2, DB-side).
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_addons_subtype_check'
      AND conrelid = 'booking_addons'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE booking_addons
        ADD CONSTRAINT booking_addons_subtype_check
        CHECK (addon_subtype IN (
          'limousine_executive', 'limousine_business', 'limousine_luxury',
          'hostess_custom', 'pilot_custom',
          'standard_free', 'arabic_premium', 'royal_dining',
          'floral_arrangement', 'celebration', 'photographer',
          'masseur', 'prayer_kit', 'child_accessories',
          'pet_transport', 'onboard_doctor', 'vip_security',
          'live_music', 'airport_vip', 'diplomatic_protocol'
        ))
    $sql$;
  END IF;
END$$;

-- ------------------------------------------------------------
-- 10. Soft-cancel timestamp on booking_addons (S5).
-- ------------------------------------------------------------
ALTER TABLE booking_addons
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- ------------------------------------------------------------
-- 11. Direct-linked trip + route + passenger snapshot fields
--     on bookings (Codex iteration-3 P1 #1 + iteration-4 P1
--     + iteration-4 P2 #1 fixes). Without these, the customer
--     checkout-prep page would have to walk
--     bookings → source_offer_table → that offer's
--     trip_request_id → trip_requests just to render
--     origin/destination/passengers — fragile and surprising.
--     Direct fields make the booking row self-sufficient for
--     read paths.
--
--     trip_request_id is a real FK (RESTRICT) so a booking
--     always has a known trip parent. The route/passenger
--     fields are snapshot copies (not derived) so future
--     trip_requests edits don't mutate the historical booking.
--
--     Both IATA and freeform snapshots are stored because
--     Phase 6.0 PR 2 kept a freeform fallback on /request for
--     cities without an IATA match. A presence CHECK enforces
--     that at least one of the pair is non-NULL per side, so
--     the customer page never renders an empty
--     origin/destination.
-- ------------------------------------------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS trip_request_id UUID,
  ADD COLUMN IF NOT EXISTS route_origin_iata VARCHAR(10),
  ADD COLUMN IF NOT EXISTS route_destination_iata VARCHAR(10),
  ADD COLUMN IF NOT EXISTS route_origin_freeform_snapshot VARCHAR(120),
  ADD COLUMN IF NOT EXISTS route_destination_freeform_snapshot VARCHAR(120),
  ADD COLUMN IF NOT EXISTS passengers_count_snapshot SMALLINT,
  ADD COLUMN IF NOT EXISTS return_scheduled TIMESTAMPTZ;

-- FK on trip_request_id, idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_trip_request_fk'
      AND conrelid = 'bookings'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE bookings
        ADD CONSTRAINT bookings_trip_request_fk
        FOREIGN KEY (trip_request_id)
        REFERENCES trip_requests(id)
        ON DELETE RESTRICT
    $sql$;
  END IF;
END$$;

-- passengers_count_snapshot range CHECK matching the
-- trip_requests.passengers_count CHECK in the initial schema
-- (1..19 per advisor doc).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_passengers_count_check'
      AND conrelid = 'bookings'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE bookings
        ADD CONSTRAINT bookings_passengers_count_check CHECK (
          passengers_count_snapshot IS NULL
          OR (passengers_count_snapshot BETWEEN 1 AND 19)
        )
    $sql$;
  END IF;
END$$;

-- Route presence CHECKs (Codex iteration-4 P1 fix): at least
-- one of (iata, freeform) per side is non-NULL when the
-- booking's route is populated at all. Allowing both to be
-- NULL is the legacy (pre-PR-2a) row state; once accept_offer
-- or backfill runs on a row, the helper functions guarantee
-- at least one column per side.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_route_origin_present_check'
      AND conrelid = 'bookings'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE bookings
        ADD CONSTRAINT bookings_route_origin_present_check CHECK (
          trip_request_id IS NULL
          OR route_origin_iata IS NOT NULL
          OR route_origin_freeform_snapshot IS NOT NULL
        )
    $sql$;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_route_destination_present_check'
      AND conrelid = 'bookings'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE bookings
        ADD CONSTRAINT bookings_route_destination_present_check CHECK (
          trip_request_id IS NULL
          OR route_destination_iata IS NOT NULL
          OR route_destination_freeform_snapshot IS NOT NULL
        )
    $sql$;
  END IF;
END$$;

-- The columns are added nullable in PR 1 because no existing
-- rows exist (bookings table never written to in production).
-- PR 2a's accept_offer body and backfill function populate
-- them on every INSERT; the spec requires them populated for
-- every Phase 6.2 booking. A future cleanup PR can flip
-- trip_request_id to NOT NULL after grep confirms zero NULL
-- rows.

-- Partial unique index on trip_request_id so one trip cannot
-- have more than one booking row (Codex iteration-4 P2 #1
-- fix). Two concurrent accept_offer calls on the same trip —
-- or accept + backfill — would fail the second INSERT with a
-- PG unique violation, which rolls back its SECURITY DEFINER
-- transaction. The backfill function's
-- booking_already_exists early return becomes defense-in-
-- depth (a friendlier error than the raw unique violation).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_trip_request_unique
  ON bookings(trip_request_id)
  WHERE trip_request_id IS NOT NULL;

-- Non-unique lookup index, retained for read paths that
-- filter by trip_request_id.
CREATE INDEX IF NOT EXISTS idx_bookings_trip_request
  ON bookings(trip_request_id);

-- ============================================================
-- S7.2.A — booking_payment_status ENUM extension
--
-- Phase 6.2 adds ONLY 'pending_offline' (Codex iteration-1
-- P2 fix). 'partial_paid' and 'failed' are explicitly out of
-- scope — they ship in Phase 11 alongside the webhook
-- handlers that consume them, NOT here.
--
-- NO `SET DEFAULT` here; that ships in File B in a fresh
-- migration session so the new value is visible by the time
-- the default literal is parsed (PostgreSQL's read-after-add
-- restriction inside the same transaction).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'pending_offline'
      AND enumtypid = 'booking_payment_status'::regtype
  ) THEN
    ALTER TYPE booking_payment_status ADD VALUE 'pending_offline';
  END IF;
END$$;

-- ============================================================
-- END OF FILE A
--
-- Post-File-A shape (founder probe #1 verifies):
--   - bookings: client_id / operator_id / aircraft_id /
--     vat_amount / commission_amount / operator_payout all
--     nullable; new snapshot + token + source-offer + trip-
--     link + route + passenger-count columns exist; eight new
--     constraints (identity, source_offer + pair, checkout-
--     token pair, trip_request FK, passengers-count, route-
--     origin-present, route-destination-present); two indexes
--     on trip_request_id (one partial unique, one plain).
--   - booking_addons: subtype CHECK (20 names) + cancelled_at
--     column.
--   - booking_payment_status ENUM: 'pending_offline' added;
--     default still 'pending' (File B sets the new default).
-- ============================================================
