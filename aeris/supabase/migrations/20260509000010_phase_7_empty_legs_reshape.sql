-- ============================================================
-- Phase 7 — Empty Legs (PR 1 schema reshape)
--
-- Idempotent (safe to re-run). Every constraint addition is
-- wrapped in a `pg_constraint` DO block; every column is
-- `IF NOT EXISTS`; every ENUM value is `pg_enum`-checked;
-- every `CREATE TABLE` is `IF NOT EXISTS` (Codex iteration-11
-- P1 #2 fix); every `CREATE INDEX` is `IF NOT EXISTS` (Codex
-- iteration-11 P1 #2 fix); every singleton-row INSERT uses
-- `ON CONFLICT DO NOTHING`; every trigger uses
-- `CREATE OR REPLACE FUNCTION` + a `DROP TRIGGER IF EXISTS`
-- guard before `CREATE TRIGGER`.
--
-- Founder Probe 1 re-runs this file and expects zero schema
-- diff.
--
-- This file ships in PR 1 alongside `lib/empty-legs/types.ts`,
-- `lib/empty-legs/auction-curve.ts`, the parity test scaffold
-- `lib/empty-legs/__tests__/auction-curve.test.ts`, the
-- regenerated `types/database.ts`, the new
-- `test:empty-legs-curve` script in `package.json`, and the
-- corresponding CI step in `.github/workflows/ci.yml`. RPC
-- bodies (11 publics + 1 helper in PR 2a; PR 2e adds
-- expire_empty_leg_window as the 12th public) ship in
-- separate migrations: PR 2a's
-- `20260510000011_phase_7_empty_legs_rpcs.sql` and PR 2e's
-- `20260511000012_phase_7_empty_legs_match_event.sql`.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Relax `empty_legs.operator_id` + add operator snapshot
--    columns + add `operator_stub_id` column (column-only
--    here; FK + partial index land in §14 after
--    `phase7_operator_stubs` is created). Codex iteration-13
--    P1 #1 fix: PostgreSQL cannot reference a relation that
--    does not exist yet, so the FK is added in §14 in a
--    `pg_constraint`-guarded DO block.
-- ------------------------------------------------------------
ALTER TABLE empty_legs
  ALTER COLUMN operator_id DROP NOT NULL;

ALTER TABLE empty_legs
  ADD COLUMN IF NOT EXISTS operator_name_snapshot VARCHAR(120),
  ADD COLUMN IF NOT EXISTS operator_phone_snapshot VARCHAR(20),
  ADD COLUMN IF NOT EXISTS operator_email_snapshot VARCHAR(120),
  ADD COLUMN IF NOT EXISTS operator_stub_id UUID;


-- ------------------------------------------------------------
-- 2. Relax `empty_legs.aircraft_id` + add aircraft_snapshot.
--    Mirror Phase 6.2 PR 1 §3.
-- ------------------------------------------------------------
ALTER TABLE empty_legs
  ALTER COLUMN aircraft_id DROP NOT NULL;

ALTER TABLE empty_legs
  ADD COLUMN IF NOT EXISTS aircraft_snapshot TEXT;


-- ------------------------------------------------------------
-- 3. Relax `empty_legs.departure_airport` + `arrival_airport`
--    to nullable (Codex iteration-10 P1 #2 fix); add freeform-
--    fallback columns + presence CHECKs identical in shape to
--    `bookings_route_origin_present_check` /
--    `bookings_route_destination_present_check` from Phase 6.2.
--    The IATA FKs to `airports(iata_code)` remain so populated
--    IATA values still resolve to real airports.
-- ------------------------------------------------------------
ALTER TABLE empty_legs
  ALTER COLUMN departure_airport DROP NOT NULL,
  ALTER COLUMN arrival_airport DROP NOT NULL;

ALTER TABLE empty_legs
  ADD COLUMN IF NOT EXISTS departure_airport_freeform_snapshot VARCHAR(120),
  ADD COLUMN IF NOT EXISTS arrival_airport_freeform_snapshot VARCHAR(120);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_route_origin_present_check'
      AND conrelid = 'empty_legs'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE empty_legs
        ADD CONSTRAINT empty_legs_route_origin_present_check CHECK (
          departure_airport IS NOT NULL
          OR departure_airport_freeform_snapshot IS NOT NULL
        )
    $sql$;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_route_destination_present_check'
      AND conrelid = 'empty_legs'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE empty_legs
        ADD CONSTRAINT empty_legs_route_destination_present_check CHECK (
          arrival_airport IS NOT NULL
          OR arrival_airport_freeform_snapshot IS NOT NULL
        )
    $sql$;
  END IF;
END$$;


-- ------------------------------------------------------------
-- 4. ADD VALUE `'cancelled'` to `empty_leg_status` ENUM.
--    `pg_enum`-guarded for re-runnability.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'cancelled'
      AND enumtypid = 'empty_leg_status'::regtype
  ) THEN
    ALTER TYPE empty_leg_status ADD VALUE 'cancelled';
  END IF;
END$$;


-- ------------------------------------------------------------
-- 5. Extend `bookings.source_offer_table` CHECK to include
--    `'phase7_empty_leg'`. Drop-and-recreate the existing
--    Phase 6.2 `bookings_source_offer_check` constraint;
--    DROP IF EXISTS makes the migration idempotent.
-- ------------------------------------------------------------
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_source_offer_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_source_offer_check CHECK (
    source_offer_table IN ('phase4', 'phase5', 'phase7_empty_leg')
    OR source_offer_table IS NULL
  );


-- ------------------------------------------------------------
-- 6. Reservation-hold columns on `empty_legs` + paired CHECK
--    (all NULL or all non-NULL — no half-state). Mirror
--    Phase 6.2 PR 1 §6's checkout-token-pair-check pattern.
-- ------------------------------------------------------------
ALTER TABLE empty_legs
  ADD COLUMN IF NOT EXISTS reservation_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS reservation_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reservation_customer_name_snapshot VARCHAR(120),
  ADD COLUMN IF NOT EXISTS reservation_customer_phone_snapshot VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_reservation_pair_check'
      AND conrelid = 'empty_legs'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE empty_legs
        ADD CONSTRAINT empty_legs_reservation_pair_check CHECK (
          (reservation_token_hash IS NULL)
            = (reservation_expires_at IS NULL)
          AND (reservation_token_hash IS NULL)
            = (reservation_customer_name_snapshot IS NULL)
          AND (reservation_token_hash IS NULL)
            = (reservation_customer_phone_snapshot IS NULL)
        )
    $sql$;
  END IF;
END$$;


-- ------------------------------------------------------------
-- 7. Customer-booking link — `customer_booking_id UUID
--    REFERENCES bookings(id) ON DELETE SET NULL`. Set when
--    `confirm_empty_leg_reservation` flips `status` to `'sold'`.
-- ------------------------------------------------------------
ALTER TABLE empty_legs
  ADD COLUMN IF NOT EXISTS customer_booking_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_customer_booking_fk'
      AND conrelid = 'empty_legs'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE empty_legs
        ADD CONSTRAINT empty_legs_customer_booking_fk
        FOREIGN KEY (customer_booking_id)
        REFERENCES bookings(id)
        ON DELETE SET NULL
    $sql$;
  END IF;
END$$;


-- ------------------------------------------------------------
-- 8. Dutch auction columns + bounds CHECK + window order
--    CHECK. Defaults: initial 40%, floor 70%, accelerating
--    curve. Per Resolved Decisions §3 of the Phase 7 spec.
-- ------------------------------------------------------------
ALTER TABLE empty_legs
  ADD COLUMN IF NOT EXISTS auction_initial_discount_pct DECIMAL(4,2) NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS auction_floor_discount_pct DECIMAL(4,2) NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS auction_curve VARCHAR(20) NOT NULL DEFAULT 'accelerating',
  ADD COLUMN IF NOT EXISTS auction_window_start_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS auction_window_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_price_drop_at TIMESTAMPTZ;

-- `auction_window_end_at` is added nullable here because
-- existing `empty_legs` rows (if any) cannot be backfilled
-- generically. Production has zero rows, so the column gets
-- `NOT NULL` immediately via a follow-up SET NOT NULL only
-- if no rows exist; otherwise stays nullable until backfill.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM empty_legs LIMIT 1) THEN
    BEGIN
      EXECUTE 'ALTER TABLE empty_legs ALTER COLUMN auction_window_end_at SET NOT NULL';
    EXCEPTION WHEN OTHERS THEN
      -- Column already NOT NULL on a re-run; ignore.
      NULL;
    END;
  END IF;
END$$;

-- Bounds CHECKs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_auction_initial_discount_range_check'
      AND conrelid = 'empty_legs'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE empty_legs
        ADD CONSTRAINT empty_legs_auction_initial_discount_range_check
        CHECK (auction_initial_discount_pct >= 10
           AND auction_initial_discount_pct <= 50)
    $sql$;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_auction_floor_discount_range_check'
      AND conrelid = 'empty_legs'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE empty_legs
        ADD CONSTRAINT empty_legs_auction_floor_discount_range_check
        CHECK (auction_floor_discount_pct >= 50
           AND auction_floor_discount_pct <= 90)
    $sql$;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_auction_bounds_check'
      AND conrelid = 'empty_legs'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE empty_legs
        ADD CONSTRAINT empty_legs_auction_bounds_check
        CHECK (auction_floor_discount_pct >= auction_initial_discount_pct)
    $sql$;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_auction_curve_check'
      AND conrelid = 'empty_legs'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE empty_legs
        ADD CONSTRAINT empty_legs_auction_curve_check
        CHECK (auction_curve IN ('linear', 'accelerating'))
    $sql$;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_auction_window_order_check'
      AND conrelid = 'empty_legs'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE empty_legs
        ADD CONSTRAINT empty_legs_auction_window_order_check CHECK (
          auction_window_end_at IS NULL
          OR auction_window_end_at > auction_window_start_at
        )
    $sql$;
  END IF;
END$$;


-- ------------------------------------------------------------
-- 9. `lead_inquiries` consent + frequency-cap columns.
--    Default `FALSE` (Codex iteration-1 P1 #1 fix: existing
--    rows backfill to FALSE — historical leads predate the
--    empty-legs marketing category and have not consented to
--    it).
-- ------------------------------------------------------------
ALTER TABLE lead_inquiries
  ADD COLUMN IF NOT EXISTS empty_legs_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_empty_leg_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lead_inquiries_empty_legs_eligible
  ON lead_inquiries(customer_phone)
  WHERE empty_legs_opt_in = TRUE;


-- ------------------------------------------------------------
-- 10. Audit trigger on `empty_legs` — fires AFTER UPDATE on
--     `current_price`, `current_discount_pct`, `status`,
--     `reservation_token_hash`. Writes to `audit_logs`.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION _audit_empty_legs_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.current_price IS DISTINCT FROM OLD.current_price
     OR NEW.current_discount_pct IS DISTINCT FROM OLD.current_discount_pct
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.reservation_token_hash IS DISTINCT FROM OLD.reservation_token_hash
  THEN
    INSERT INTO audit_logs (
      entity_type, entity_id, action, old_value, new_value
    ) VALUES (
      'empty_legs',
      NEW.id,
      'update',
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION _audit_empty_legs_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS empty_legs_audit_trigger ON empty_legs;
CREATE TRIGGER empty_legs_audit_trigger
  AFTER UPDATE ON empty_legs
  FOR EACH ROW
  EXECUTE FUNCTION _audit_empty_legs_change();


-- ------------------------------------------------------------
-- 11. `empty_legs.suppress_notifications` column (Codex
--     iteration-7 P1 #3 fix). The matching engine excludes
--     `suppress_notifications = TRUE` legs entirely — even
--     after both flags flip and any backlog drains. Admin
--     publish form's canary checkbox writes this column.
-- ------------------------------------------------------------
ALTER TABLE empty_legs
  ADD COLUMN IF NOT EXISTS suppress_notifications BOOLEAN NOT NULL DEFAULT FALSE;


-- ------------------------------------------------------------
-- 12. Re-create the existing `empty_legs_public_available`
--     RLS policy assertion (no-op). Initial-schema policy
--     permits anon SELECT only when `status='available'`;
--     Phase 7's new `'cancelled'` value is automatically
--     excluded (it's neither `'available'` nor matches the
--     operator-by-`auth.uid` clause). No policy change
--     needed; section is a no-op assertion to make the
--     review explicit.
-- ------------------------------------------------------------
-- (no-op section — see comment above)


-- ------------------------------------------------------------
-- 13. `empty_leg_notifications` dedicated table (Codex
--     iteration-1 P1 #2 fix). Initial-schema `notifications`
--     keys on `user_id NOT NULL REFERENCES users(id)` and is
--     unusable for guest `lead_inquiries` recipients. This
--     table is keyed on `lead_inquiry_id` + `leg_id` so the
--     frequency cap + per-leg dedupe + outreach queue can
--     read against guest-shaped rows.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empty_leg_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_inquiry_id UUID NOT NULL
    REFERENCES lead_inquiries(id) ON DELETE CASCADE,
  leg_id UUID NOT NULL
    REFERENCES empty_legs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('published', 'price_dropped')
  ),
  channel TEXT NOT NULL CHECK (
    channel IN ('whatsapp_link')
  ),
  wa_url TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outreach_sent_at TIMESTAMPTZ,
  external_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_empty_leg_notifications_lead_24h
  ON empty_leg_notifications(lead_inquiry_id, sent_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_empty_leg_notifications_lead_leg_unique
  ON empty_leg_notifications(lead_inquiry_id, leg_id);
CREATE INDEX IF NOT EXISTS idx_empty_leg_notifications_outreach_pending
  ON empty_leg_notifications(sent_at DESC)
  WHERE outreach_sent_at IS NULL;

ALTER TABLE empty_leg_notifications ENABLE ROW LEVEL SECURITY;
-- No policies: service-role-only access (anon + authenticated
-- get nothing; matches the audit-log posture of §10).


-- ------------------------------------------------------------
-- 14. `phase7_operator_stubs` table (Codex iteration-11 P1 #1
--     fix) + FK + index wiring for `empty_legs.operator_stub_id`
--     (Codex iteration-13 P1 #1 fix — the column was added in
--     §1 without an FK because PostgreSQL cannot reference a
--     relation that does not exist yet; the FK is added here
--     in a `pg_constraint`-guarded DO block now that the
--     target table exists).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phase7_operator_stubs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name VARCHAR(200) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(20) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phase7_operator_stubs_active
  ON phase7_operator_stubs(created_at DESC)
  WHERE status = 'active';

ALTER TABLE phase7_operator_stubs
  ENABLE ROW LEVEL SECURITY;
-- No policies: service-role-only access. The admin bootstrap
-- form + the session-mint dropdown both read/write via the
-- admin Supabase client.

-- FK + index wiring for empty_legs.operator_stub_id (Codex
-- iteration-13 P1 #1 fix).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empty_legs_operator_stub_fk'
      AND conrelid = 'empty_legs'::regclass
  ) THEN
    EXECUTE $sql$
      ALTER TABLE empty_legs
        ADD CONSTRAINT empty_legs_operator_stub_fk
        FOREIGN KEY (operator_stub_id)
        REFERENCES phase7_operator_stubs(id)
        ON DELETE SET NULL
    $sql$;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_empty_legs_operator_stub
  ON empty_legs(operator_stub_id, status)
  WHERE operator_stub_id IS NOT NULL;


-- ------------------------------------------------------------
-- 15. `operator_empty_leg_sessions` table (Codex iteration-2
--     P1 #3 fix; iteration-11 P1 #1 fix retargeted FK from
--     `operators(id)` to `phase7_operator_stubs(id)`;
--     iteration-12 P1 #2 fix renamed column from
--     `operator_id` to `operator_stub_id`).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operator_empty_leg_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_stub_id UUID NOT NULL
    REFERENCES phase7_operator_stubs(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_empty_leg_sessions_hash
  ON operator_empty_leg_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_operator_empty_leg_sessions_stub
  ON operator_empty_leg_sessions(operator_stub_id, expires_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE operator_empty_leg_sessions
  ENABLE ROW LEVEL SECURITY;
-- No policies: service-role-only access.


-- ------------------------------------------------------------
-- 16. `empty_leg_outreach_alert_status` singleton table
--     (Codex iteration-5 P2 #2 fix). The founder batch email
--     path UPDATEs this row on every send attempt so the
--     admin outreach queue can render a banner when status
--     <> 'healthy'. Singleton constraint: `id INT` + CHECK
--     `(id = 1)`.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS empty_leg_outreach_alert_status (
  id INT PRIMARY KEY DEFAULT 1
    CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN (
      'healthy', 'config_missing', 'send_failed'
    )),
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO empty_leg_outreach_alert_status
  (id, status) VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE empty_leg_outreach_alert_status
  ENABLE ROW LEVEL SECURITY;
-- No policies: service-role-only access.


-- ------------------------------------------------------------
-- 17. `empty_leg_notifications` AFTER INSERT trigger that
--     atomically updates `lead_inquiries.last_empty_leg_notified_at`
--     to the inserted row's `NEW.sent_at` (Codex iteration-7
--     P1 #2 fix + iteration-9 P2 #2 wording fix). Atomicity
--     comes from PostgreSQL — the trigger fires inside the
--     same transaction as the INSERT, so the column is never
--     out of sync with the queue write.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION _update_lead_inquiry_last_notified()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE lead_inquiries
    SET last_empty_leg_notified_at = NEW.sent_at
    WHERE id = NEW.lead_inquiry_id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION _update_lead_inquiry_last_notified()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS empty_leg_notifications_update_last_notified
  ON empty_leg_notifications;
CREATE TRIGGER empty_leg_notifications_update_last_notified
  AFTER INSERT ON empty_leg_notifications
  FOR EACH ROW
  EXECUTE FUNCTION _update_lead_inquiry_last_notified();


-- ============================================================
-- END OF PR 1 MIGRATION
--
-- Post-migration shape (Founder Probes 1, 2, 3, 4, 4a, 4b
-- verify):
--   - empty_legs: operator_id / aircraft_id / departure_airport
--     / arrival_airport all nullable; new snapshot, freeform,
--     reservation, customer_booking, Dutch-auction,
--     suppress_notifications, operator_stub_id columns;
--     11 new constraints (route presence x2, reservation
--     pair, customer_booking FK, auction range x2, auction
--     bounds, auction curve, auction window order, FK to
--     phase7_operator_stubs); 2 new indexes
--     (idx_empty_legs_operator_stub partial,
--     idx_lead_inquiries_empty_legs_eligible partial); audit
--     trigger active.
--   - empty_leg_status ENUM contains 'cancelled'.
--   - bookings.source_offer_table CHECK accepts
--     'phase7_empty_leg' alongside the legacy 'phase4' /
--     'phase5' values.
--   - lead_inquiries: empty_legs_opt_in BOOLEAN NOT NULL
--     DEFAULT FALSE, last_empty_leg_notified_at TIMESTAMPTZ;
--     partial index on customer_phone WHERE
--     empty_legs_opt_in = TRUE.
--   - 4 new tables (empty_leg_notifications,
--     phase7_operator_stubs, operator_empty_leg_sessions,
--     empty_leg_outreach_alert_status) with service-role-
--     only RLS and the indexes / CHECK / seeded row listed
--     in their respective sections.
--   - 1 new AFTER INSERT trigger on empty_leg_notifications
--     that updates lead_inquiries.last_empty_leg_notified_at
--     atomically.
-- ============================================================
