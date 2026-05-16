-- ============================================================
-- Phase 12 PR 1 — Aeris MedEvac (Medical Evacuation +
-- Aeris Shield subscriptions) intake + admin PII surface.
--
-- Spec: aeris/docs/PHASE-12-MEDEVAC-SPEC.md
-- (Codex 100/100 after 16 review rounds, merged at 082d90a)
-- This migration implements PR 1's 27-object inventory:
--
--   §3.1 — medevac_requests table + 7 ENUMs + 7 named CHECKs + 4 indexes + RLS
--   §3.2 — medevac_offers table + 4 named CHECKs + 2 indexes + RLS
--   §3.3 — medevac_requests.accepted_offer_id FK (deferred-add)
--   §3.4 — bookings_source_discriminator_check + bookings_source_offer_check extensions
--   §3.5 — aircraft_medical_certifications table + enforce trigger + RLS
--   §3.6 — medevac_severity_sla lookup + 3-row seed + RLS
--   §3.7 — medevac_subscription_plan_terms lookup + 4-row seed + RLS,
--          medevac_subscriptions table + 4 named CHECKs + 2 indexes + RLS,
--          medevac_requests.subscription_id FK (deferred-add)
--   §3.8 — aeris_shield_config singleton + 1-row seed + RLS
--   §3.9 — medevac_email_alert_status singleton + 1-row seed + RLS
--   §3.11 — safe_parse_date(TEXT) helper (IMMUTABLE + PARALLEL SAFE)
--   §4.1 — create_medevac_request_guest RPC (severity='stable' gate at RPC layer)
--   §4.2 — create_medevac_request_authenticated RPC (allows all severities)
--   §4.3 — submit_medevac_offer RPC (cert-expiry gate)
--   §4.7 — consume_aeris_shield_event RPC (atomic Shield consume + booking)
--   §4.8 — subscribe_to_aeris_shield RPC (owner-seeded covered_members)
--   §4.10 — admin_read_medevac_request_detail RPC (atomic PII read + audit)
--
-- Conventions carried forward from Phase 9/10/11:
--   #1   REVOKE PUBLIC + anon + authenticated; GRANT EXECUTE service_role
--   #12  ip_required guard on public RPCs
--   #15  looseClient pattern for callers (TS layer; see lib/medevac/types.ts)
--   #16  Codex round 3 PR #75 P1 #2 — no ROLLBACK/COMMIT/SET TRANSACTION
--        inside PL/pgSQL bodies; let RAISE EXCEPTION propagate so Postgres'
--        statement-level transaction reverts all prior writes
--
-- Replay-safety conventions:
--   - All ENUM CREATE TYPE wrapped in pg_type DO block guards
--   - All CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
--   - All named CHECK + FK constraints have explicit names + DO block guards
--   - Phase 1 prototype cleanup: refuse drop if rows exist (RAISE EXCEPTION),
--     CASCADE-drop + ENUM cleanup if empty (one-off, idempotent)
-- ============================================================


-- ============================================================
-- Phase 1 prototype cleanup (one-off, idempotent)
--
-- Mirrors the Phase 11 cargo cleanup pattern. The Phase 1
-- initial_schema.sql (lines 505-563) has a prototype
-- `medevac_requests` + `medevac_subscriptions` with a
-- different shape (FK to users instead of clients, no
-- *_snapshot columns, simpler statuses). Refuses to drop
-- if any rows exist; otherwise CASCADE-drops the tables +
-- legacy ENUMs so the new shape can be re-created.
-- ============================================================

DO $$
DECLARE
  v_row_count INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'medevac_requests'
  ) THEN
    EXECUTE 'SELECT COUNT(*) FROM medevac_requests' INTO v_row_count;
    IF v_row_count > 0 THEN
      RAISE EXCEPTION
        'Legacy medevac_requests has % rows — manual migration required before drop.',
        v_row_count;
    END IF;
    DROP TABLE medevac_requests CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'medevac_subscriptions'
  ) THEN
    EXECUTE 'SELECT COUNT(*) FROM medevac_subscriptions' INTO v_row_count;
    IF v_row_count > 0 THEN
      RAISE EXCEPTION
        'Legacy medevac_subscriptions has % rows — manual migration required before drop.',
        v_row_count;
    END IF;
    DROP TABLE medevac_subscriptions CASCADE;
  END IF;

  -- Legacy ENUMs (Phase 1 initial_schema.sql). Dropped via
  -- CASCADE because the columns above were already removed
  -- when their tables dropped; this just retires the type names.
  DROP TYPE IF EXISTS medevac_status CASCADE;
  DROP TYPE IF EXISTS medevac_severity CASCADE;
  DROP TYPE IF EXISTS medevac_service_level CASCADE;
  DROP TYPE IF EXISTS subscription_plan CASCADE;
  DROP TYPE IF EXISTS subscription_status CASCADE;
END $$;


-- ============================================================
-- §3.1 — 7 ENUMs (Phase 9 replay-safe DO + pg_type guards)
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'medevac_severity' AND n.nspname = 'public') THEN
    CREATE TYPE medevac_severity AS ENUM ('stable', 'moderate', 'critical');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'medevac_service_level' AND n.nspname = 'public') THEN
    CREATE TYPE medevac_service_level AS ENUM ('BMT', 'ALS', 'CCT', 'repatriation');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'medevac_request_status' AND n.nspname = 'public') THEN
    CREATE TYPE medevac_request_status AS ENUM (
      'pending',          -- waiting for offers (out-of-pocket path)
      'offers_received',  -- ≥1 operator offer in
      'accepted',         -- client/admin accepted → booking created
      'covered',          -- subscription-funded auto-dispatch (J5 path)
      'cancelled',        -- client/admin cancelled before acceptance
      'expired'           -- 7-day TTL hit without acceptance OR SLA window passed
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'medevac_offer_status' AND n.nspname = 'public') THEN
    CREATE TYPE medevac_offer_status AS ENUM (
      'pending', 'accepted', 'declined', 'withdrawn', 'expired'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'aeris_shield_plan' AND n.nspname = 'public') THEN
    CREATE TYPE aeris_shield_plan AS ENUM (
      'individual', 'family', 'vip_family', 'diamond'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'aeris_shield_subscription_status' AND n.nspname = 'public') THEN
    CREATE TYPE aeris_shield_subscription_status AS ENUM (
      'pending_payment', 'active', 'expired', 'cancelled', 'suspended'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'medical_certifying_authority' AND n.nspname = 'public') THEN
    CREATE TYPE medical_certifying_authority AS ENUM (
      'SCFHS',                    -- Saudi Commission for Health Specialties
      'civil_aviation_authority', -- GACA medical aviation cert
      'foreign_equivalent',       -- e.g. FAA, EASA, GMC for repatriation flights
      'other'
    );
  END IF;
END $$;


-- ============================================================
-- §3.1 — medevac_requests table + CHECKs + indexes + RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS medevac_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  medevac_request_number VARCHAR(20) NOT NULL UNIQUE
    DEFAULT 'MEV-' || substring(uuid_generate_v4()::TEXT, 1, 8),

  -- Path discriminator (guest vs authed). Round 3 PR #75 P2 #4
  -- fix: ON DELETE RESTRICT (was SET NULL). SET NULL would null
  -- a non-stable authed row's client_id and violate the guest
  -- severity CHECK. RESTRICT forces archival before client delete.
  client_id UUID REFERENCES clients(id) ON DELETE RESTRICT,

  -- Snapshots (Phase 9 PR 2 immutable-snapshot discipline)
  patient_name_snapshot VARCHAR(200) NOT NULL,
  patient_age_snapshot INT,
  contact_name_snapshot VARCHAR(120) NOT NULL,
  contact_phone_snapshot VARCHAR(20) NOT NULL,
  contact_email_snapshot VARCHAR(120),

  -- Triage
  condition_severity medevac_severity NOT NULL,
  service_level medevac_service_level NOT NULL,

  -- Route
  from_location_freeform VARCHAR(300) NOT NULL,
  from_iata VARCHAR(4),
  to_hospital_name VARCHAR(300) NOT NULL,
  to_hospital_contact_phone VARCHAR(20),
  to_hospital_freeform_address VARCHAR(300),
  to_iata VARCHAR(4),

  -- Insurance snapshot (D9 — Phase 14 wires actual claim filing)
  insurance_provider_snapshot VARCHAR(200),
  insurance_claim_ref VARCHAR(100),

  -- Pricing (estimated by client; operator quotes final)
  estimated_value_sar DECIMAL(14, 2) NOT NULL CHECK (estimated_value_sar > 0),

  -- Subscription linkage (D13 — used for J5 covered path).
  -- FK added in §3.7 after medevac_subscriptions exists.
  subscription_id UUID,
  is_covered BOOLEAN NOT NULL DEFAULT false,

  -- Status + audit
  status medevac_request_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  accepted_offer_id UUID, -- FK added in §3.3 after medevac_offers exists
  dispatched_at TIMESTAMPTZ,
  sla_escalated_at TIMESTAMPTZ, -- D10 — set when cron escalates past SLA

  handling_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Identity check: snapshots ALWAYS populated
  CONSTRAINT medevac_requests_identity_check CHECK (
    patient_name_snapshot IS NOT NULL
    AND contact_name_snapshot IS NOT NULL
    AND contact_phone_snapshot IS NOT NULL
  ),

  -- Public-path severity gate (D1)
  CONSTRAINT medevac_requests_guest_severity_check CHECK (
    client_id IS NOT NULL OR condition_severity = 'stable'
  ),

  -- Covered status invariant (D13) — two-way (Round 2 P1 #2):
  --   (is_covered = true) <=> (status = 'covered')
  --   status='covered' => subscription_id IS NOT NULL
  CONSTRAINT medevac_requests_covered_status_equiv_check CHECK (
    (is_covered = true) = (status = 'covered')
  ),
  CONSTRAINT medevac_requests_covered_has_subscription_check CHECK (
    status <> 'covered' OR subscription_id IS NOT NULL
  ),

  -- Accepted requests must have accepted_offer_id (covered rows
  -- never become accepted; the equiv check above keeps that pair tight)
  CONSTRAINT medevac_requests_accepted_link_check CHECK (
    status <> 'accepted' OR accepted_offer_id IS NOT NULL
  ),

  -- Length caps (defense-in-depth)
  CONSTRAINT medevac_requests_value_positive_check CHECK (
    estimated_value_sar > 0
  ),
  CONSTRAINT medevac_requests_cancellation_reason_length_check CHECK (
    cancellation_reason IS NULL OR length(cancellation_reason) <= 500
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_medevac_requests_client
  ON medevac_requests (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_medevac_requests_status
  ON medevac_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medevac_requests_severity
  ON medevac_requests (condition_severity, created_at DESC)
  WHERE status IN ('pending', 'offers_received');
CREATE INDEX IF NOT EXISTS idx_medevac_requests_sla_pending
  ON medevac_requests (dispatched_at)
  WHERE status IN ('pending', 'offers_received')
    AND dispatched_at IS NOT NULL
    AND sla_escalated_at IS NULL;

ALTER TABLE medevac_requests ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.2 — medevac_offers table + CHECKs + indexes + RLS
--
-- Mirrors cargo_offers shape per D15.
-- ============================================================

CREATE TABLE IF NOT EXISTS medevac_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  medevac_request_id UUID NOT NULL
    REFERENCES medevac_requests(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL
    REFERENCES operators(id) ON DELETE RESTRICT,
  aircraft_id UUID NOT NULL
    REFERENCES aircraft(id) ON DELETE RESTRICT,

  -- Snapshots
  operator_name_snapshot VARCHAR(200) NOT NULL,
  operator_phone_snapshot VARCHAR(20) NOT NULL,
  operator_email_snapshot VARCHAR(255) NOT NULL,
  aircraft_snapshot TEXT,
  medical_team_snapshot TEXT,

  -- Pricing
  base_price_sar DECIMAL(14, 2) NOT NULL
    CONSTRAINT medevac_offers_base_price_positive_check
      CHECK (base_price_sar > 0),
  medical_team_price_sar DECIMAL(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT medevac_offers_medical_team_nonneg_check
      CHECK (medical_team_price_sar >= 0),
  insurance_coordination_price_sar DECIMAL(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT medevac_offers_insurance_coord_nonneg_check
      CHECK (insurance_coordination_price_sar >= 0),
  total_price_sar DECIMAL(14, 2) GENERATED ALWAYS AS (
    base_price_sar + medical_team_price_sar + insurance_coordination_price_sar
  ) STORED,

  proposed_pickup_at TIMESTAMPTZ NOT NULL,
  proposed_arrival_at TIMESTAMPTZ NOT NULL,

  operator_notes TEXT,
  decline_reason TEXT,
  withdraw_reason TEXT,

  status medevac_offer_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  decided_at TIMESTAMPTZ,
  decided_by_user_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT medevac_offers_time_order_check CHECK (
    proposed_arrival_at > proposed_pickup_at
  ),
  CONSTRAINT medevac_offers_decline_reason_length_check CHECK (
    decline_reason IS NULL OR length(decline_reason) <= 500
  ),
  CONSTRAINT medevac_offers_withdraw_reason_length_check CHECK (
    withdraw_reason IS NULL OR length(withdraw_reason) <= 500
  )
);

CREATE INDEX IF NOT EXISTS idx_medevac_offers_request
  ON medevac_offers (medevac_request_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medevac_offers_operator
  ON medevac_offers (operator_id, status, created_at DESC);

ALTER TABLE medevac_offers ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.3 — medevac_requests.accepted_offer_id FK (deferred-add)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'medevac_requests_accepted_offer_fkey'
       AND conrelid = 'medevac_requests'::regclass
  ) THEN
    ALTER TABLE medevac_requests
      ADD CONSTRAINT medevac_requests_accepted_offer_fkey
      FOREIGN KEY (accepted_offer_id)
      REFERENCES medevac_offers(id)
      ON DELETE RESTRICT;
  END IF;
END $$;


-- ============================================================
-- §3.4 — bookings constraint extensions for medevac
--
-- Phase 11 PR 1 already widened bookings.operator_*_snapshot to
-- varchar(200)/(255), so no width change here. Only the
-- discriminator + source-offer CHECK extensions are needed.
-- ============================================================

-- §3.4.1 — extend source_discriminator CHECK to accept 'medevac'
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_source_discriminator_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bookings_source_discriminator_check'
       AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_source_discriminator_check
      CHECK (source_discriminator IN ('charter', 'empty_leg', 'cargo', 'medevac'));
  END IF;
END $$;

-- §3.4.2 — extend source_offer_check to accept 'medevac_offers'
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_source_offer_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bookings_source_offer_check'
       AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_source_offer_check CHECK (
        source_offer_table IN (
          'phase4', 'phase5', 'phase7_empty_leg',
          'cargo_offers', 'medevac_offers'
        )
        OR source_offer_table IS NULL
      );
  END IF;
END $$;


-- ============================================================
-- §3.5 — aircraft_medical_certifications + enforce trigger + RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS aircraft_medical_certifications (
  aircraft_id UUID PRIMARY KEY
    REFERENCES aircraft(id) ON DELETE CASCADE,
  supports_BMT BOOLEAN NOT NULL DEFAULT false,
  supports_ALS BOOLEAN NOT NULL DEFAULT false,
  supports_CCT BOOLEAN NOT NULL DEFAULT false,
  supports_repatriation BOOLEAN NOT NULL DEFAULT false,
  certifying_authority medical_certifying_authority NOT NULL,
  certification_number TEXT,
  certification_expires_at TIMESTAMPTZ NOT NULL,
  -- Per-threshold warning state owned by PR 1 schema (Round 1
  -- P1 #4 + Round 2 P2 #5 fixes). PR 3 cron sets each flag
  -- once per renewal cycle, then resets all 4 to NULL when
  -- certification_expires_at > NOW() + INTERVAL '30 days'.
  warning_30d_sent_at TIMESTAMPTZ,
  warning_14d_sent_at TIMESTAMPTZ,
  warning_7d_sent_at  TIMESTAMPTZ,
  warning_1d_sent_at  TIMESTAMPTZ,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Round 3 P1 #1: at-least-one-supports_* rule lives in the
  -- trigger below, not as a table CHECK, so the PR 3 cron
  -- enforcement flip (all-false on expiry) can pass.
);

-- Insert/update guard. Centralises three rules:
--   (a) INSERT: future expiry only (SQLSTATE 22023)
--   (b) UPDATE re-enable on expired cert: blocked (22023)
--   (c) at-least-one supports_*: enforced on INSERT and on
--       non-expiry UPDATEs; allowed all-false only when the
--       cert has already expired (PR 3 cron flip path)
CREATE OR REPLACE FUNCTION enforce_aircraft_medical_certifications()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- (a) INSERT: future expiry only.
  IF TG_OP = 'INSERT' AND NEW.certification_expires_at <= NOW() THEN
    RAISE EXCEPTION 'certification_expires_at must be in the future'
      USING ERRCODE = '22023';
  END IF;

  -- (b) UPDATE on expired cert: forbid re-enable of any flag.
  IF TG_OP = 'UPDATE'
     AND NEW.certification_expires_at <= NOW()
     AND (
       (NEW.supports_BMT AND NOT OLD.supports_BMT)
       OR (NEW.supports_ALS AND NOT OLD.supports_ALS)
       OR (NEW.supports_CCT AND NOT OLD.supports_CCT)
       OR (NEW.supports_repatriation AND NOT OLD.supports_repatriation)
     )
  THEN
    RAISE EXCEPTION 'cannot re-enable supports_* on an expired certification'
      USING ERRCODE = '22023';
  END IF;

  -- (c) At-least-one supports_* rule.
  IF NOT (NEW.supports_BMT OR NEW.supports_ALS
          OR NEW.supports_CCT OR NEW.supports_repatriation)
  THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'at least one supports_* flag must be true on insert'
        USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.certification_expires_at > NOW() THEN
      RAISE EXCEPTION 'at least one supports_* flag must remain true on non-expiry update'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_past_expiry_trigger
  ON aircraft_medical_certifications;
DROP TRIGGER IF EXISTS enforce_aircraft_medical_certifications_trigger
  ON aircraft_medical_certifications;
CREATE TRIGGER enforce_aircraft_medical_certifications_trigger
  BEFORE INSERT OR UPDATE ON aircraft_medical_certifications
  FOR EACH ROW EXECUTE FUNCTION enforce_aircraft_medical_certifications();

ALTER TABLE aircraft_medical_certifications ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.6 — medevac_severity_sla lookup + 3-row seed + RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS medevac_severity_sla (
  severity medevac_severity PRIMARY KEY,
  sla_interval INTERVAL NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO medevac_severity_sla (severity, sla_interval) VALUES
  ('critical', INTERVAL '1 hour'),
  ('moderate', INTERVAL '4 hours'),
  ('stable',   INTERVAL '24 hours')
ON CONFLICT (severity) DO NOTHING;

ALTER TABLE medevac_severity_sla ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.7 — plan_terms lookup + seed; medevac_subscriptions table
-- + deferred subscription_id FK on medevac_requests
-- ============================================================

CREATE TABLE IF NOT EXISTS medevac_subscription_plan_terms (
  plan aeris_shield_plan PRIMARY KEY,
  annual_fee_sar DECIMAL(10, 2) NOT NULL CHECK (annual_fee_sar > 0),
  -- -1 = unlimited (diamond)
  covered_events INT NOT NULL CHECK (covered_events > 0 OR covered_events = -1),
  service_level medevac_service_level NOT NULL,
  includes_repatriation BOOLEAN NOT NULL DEFAULT false,
  max_covered_members INT NOT NULL CHECK (max_covered_members > 0),
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO medevac_subscription_plan_terms VALUES
  ('individual',  15000,   1, 'ALS', false,  1, 'Individual coverage — 1 ALS event/year'),
  ('family',      48000,   4, 'ALS', false,  4, 'Family — 4 ALS events/year, up to 4 members'),
  ('vip_family',  150000, 12, 'CCT', true,   6, 'VIP Family — 12 CCT events/year + repatriation, up to 6 members'),
  ('diamond',     400000, -1, 'CCT', true,  10, 'Diamond — unlimited CCT + repatriation + dedicated nurse coordinator')
ON CONFLICT (plan) DO NOTHING;

-- Round 4 PR #75 P2 #3 — RLS on the plan-terms lookup. The
-- marketing page reads via service-role helper, not direct REST.
ALTER TABLE medevac_subscription_plan_terms ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS medevac_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_number VARCHAR(30) NOT NULL UNIQUE
    DEFAULT 'SHIELD-' || substring(uuid_generate_v4()::TEXT, 1, 8),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  plan aeris_shield_plan NOT NULL,

  -- Immutable snapshots of plan terms at signup time
  annual_fee_at_signup_sar DECIMAL(10, 2) NOT NULL,
  covered_events_at_signup INT NOT NULL,
  service_level_at_signup medevac_service_level NOT NULL,
  includes_repatriation_at_signup BOOLEAN NOT NULL,
  max_covered_members_at_signup INT NOT NULL,

  -- D5: [{ name: TEXT, relationship: TEXT, dob: DATE }] —
  -- owner seeded at signup as relationship='self'; admin
  -- mutates additional members post-activation only.
  covered_members JSONB NOT NULL DEFAULT '[]'::jsonb,

  used_events INT NOT NULL DEFAULT 0
    CHECK (used_events >= 0),

  -- Round 2 P1 #1: nullable until activation. §4.9 admin
  -- activation (or Phase 14 HyperPay webhook) stamps both.
  start_date DATE,
  end_date DATE,
  auto_renew BOOLEAN NOT NULL DEFAULT true,
  status aeris_shield_subscription_status NOT NULL DEFAULT 'pending_payment',

  payment_token_hash TEXT,
  last_renewal_at TIMESTAMPTZ,
  next_renewal_due TIMESTAMPTZ,

  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT medevac_subscriptions_date_order_check CHECK (
    start_date IS NULL OR end_date IS NULL OR end_date > start_date
  ),
  -- Round 2 P1 #1 + Round 6 P2 #4: active/expired/suspended
  -- require both dates; pending_payment + cancelled can be NULL.
  CONSTRAINT medevac_subscriptions_active_has_dates_check CHECK (
    status IN ('pending_payment', 'cancelled')
    OR (start_date IS NOT NULL AND end_date IS NOT NULL AND end_date > start_date)
  ),
  CONSTRAINT medevac_subscriptions_events_within_plan_check CHECK (
    covered_events_at_signup = -1 OR used_events <= covered_events_at_signup
  ),
  CONSTRAINT medevac_subscriptions_cancellation_reason_length_check CHECK (
    cancellation_reason IS NULL OR length(cancellation_reason) <= 500
  )
);

CREATE INDEX IF NOT EXISTS idx_medevac_subscriptions_client
  ON medevac_subscriptions (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medevac_subscriptions_status
  ON medevac_subscriptions (status, end_date)
  WHERE status IN ('active', 'pending_payment');

ALTER TABLE medevac_subscriptions ENABLE ROW LEVEL SECURITY;

-- Now add the deferred FK on medevac_requests.subscription_id.
-- Round 1 PR #75 P2 #6 — ON DELETE RESTRICT (was SET NULL).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'medevac_requests_subscription_fkey'
       AND conrelid = 'medevac_requests'::regclass
  ) THEN
    ALTER TABLE medevac_requests
      ADD CONSTRAINT medevac_requests_subscription_fkey
      FOREIGN KEY (subscription_id)
      REFERENCES medevac_subscriptions(id) ON DELETE RESTRICT;
  END IF;
END $$;


-- ============================================================
-- §3.8 — aeris_shield_config singleton + 1-row seed + RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS aeris_shield_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Round 1 P1 #5: ON DELETE RESTRICT (was SET NULL). Admin
  -- must pick a replacement before deleting the configured
  -- default operator.
  default_operator_id UUID REFERENCES operators(id) ON DELETE RESTRICT,
  founder_notification_email VARCHAR(120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO aeris_shield_config (id, default_operator_id, founder_notification_email)
  VALUES (1, NULL, 'basem902@gmail.com')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE aeris_shield_config ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.9 — medevac_email_alert_status singleton + 1-row seed + RLS
--
-- Round 3 P2 #5: full DDL inlined (was "mirrors cargo").
-- Consumer + writer ship in PR 3.
-- ============================================================

CREATE TABLE IF NOT EXISTS medevac_email_alert_status (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'config_missing', 'send_failed')),
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO medevac_email_alert_status (id, status)
  VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE medevac_email_alert_status ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- §3.11 — safe_parse_date helper (IMMUTABLE + PARALLEL SAFE)
--
-- Round 8 PR #75 P2 #1. Used by §4.7 covered_members dob filter
-- AND by the admin covered_members Server Action's write-time
-- validator. Returns NULL for ANY parse failure: NULL input,
-- non-ISO-8601 shape, OR shape-valid-but-semantically-invalid
-- date like "2026-02-31" / "2026-99-99". The nested
-- BEGIN/EXCEPTION block catches both invalid_datetime_format
-- (22007) and datetime_field_overflow (22008); no other class
-- is swallowed.
-- ============================================================

CREATE OR REPLACE FUNCTION safe_parse_date(p_text TEXT)
  RETURNS DATE
  LANGUAGE plpgsql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_text IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_text !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN p_text::DATE;
  EXCEPTION
    WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RETURN NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION safe_parse_date(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION safe_parse_date(TEXT) TO service_role;


-- ============================================================
-- §4.1 — create_medevac_request_guest RPC (NEW)
--
-- Public path. Severity gate at RPC layer (D1):
-- only 'stable' is accepted; moderate/critical require an
-- authed account. The medevac_requests_guest_severity_check
-- CHECK constraint is the second line of defense.
-- ============================================================

CREATE OR REPLACE FUNCTION create_medevac_request_guest(
  p_payload JSONB,
  p_ip      INET
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id UUID;
  v_request_number TEXT;
  v_severity medevac_severity;
  v_service_level medevac_service_level;
BEGIN
  -- ip_required guard (Phase 9 convention #12)
  IF p_ip IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ip_required');
  END IF;

  -- Text allowlist before ENUM casts (Phase 11 PR 1 round 1 P1 #3 pattern)
  IF p_payload->>'condition_severity' IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'condition_severity_required');
  END IF;
  IF (p_payload->>'condition_severity') NOT IN ('stable', 'moderate', 'critical') THEN
    RETURN json_build_object('ok', false, 'error', 'condition_severity_invalid');
  END IF;
  -- D1 — guest path only accepts 'stable'
  IF (p_payload->>'condition_severity') <> 'stable' THEN
    RETURN json_build_object('ok', false, 'error', 'severity_requires_account');
  END IF;
  v_severity := (p_payload->>'condition_severity')::medevac_severity;

  IF p_payload->>'service_level' IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'service_level_required');
  END IF;
  IF (p_payload->>'service_level') NOT IN ('BMT', 'ALS', 'CCT', 'repatriation') THEN
    RETURN json_build_object('ok', false, 'error', 'service_level_invalid');
  END IF;
  v_service_level := (p_payload->>'service_level')::medevac_service_level;

  -- Required-field guards (BTRIM so "   " fails consistently)
  IF NULLIF(BTRIM(p_payload->>'patient_name'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'patient_name_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'contact_name'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'contact_name_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'contact_phone'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'contact_phone_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'from_location_freeform'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'from_location_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'to_hospital_name'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'to_hospital_required');
  END IF;
  IF NULLIF(p_payload->>'estimated_value_sar', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'estimated_value_required');
  END IF;

  -- DB-boundary length guards
  IF length(BTRIM(p_payload->>'patient_name')) > 200 THEN
    RETURN json_build_object('ok', false, 'error', 'patient_name_invalid');
  END IF;
  IF length(BTRIM(p_payload->>'contact_name')) > 120 THEN
    RETURN json_build_object('ok', false, 'error', 'contact_name_invalid');
  END IF;
  IF length(BTRIM(p_payload->>'contact_phone')) > 20 THEN
    RETURN json_build_object('ok', false, 'error', 'contact_phone_invalid');
  END IF;
  IF p_payload->>'contact_email' IS NOT NULL
     AND length(BTRIM(p_payload->>'contact_email')) > 120 THEN
    RETURN json_build_object('ok', false, 'error', 'contact_email_invalid');
  END IF;
  IF length(BTRIM(p_payload->>'from_location_freeform')) > 300 THEN
    RETURN json_build_object('ok', false, 'error', 'from_location_invalid');
  END IF;
  IF length(BTRIM(p_payload->>'to_hospital_name')) > 300 THEN
    RETURN json_build_object('ok', false, 'error', 'to_hospital_invalid');
  END IF;

  -- Positive value gate
  IF (p_payload->>'estimated_value_sar')::DECIMAL <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'estimated_value_invalid');
  END IF;

  -- INSERT
  INSERT INTO medevac_requests (
    client_id,
    patient_name_snapshot,
    patient_age_snapshot,
    contact_name_snapshot,
    contact_phone_snapshot,
    contact_email_snapshot,
    condition_severity,
    service_level,
    from_location_freeform,
    from_iata,
    to_hospital_name,
    to_hospital_contact_phone,
    to_hospital_freeform_address,
    to_iata,
    insurance_provider_snapshot,
    insurance_claim_ref,
    estimated_value_sar,
    status
  ) VALUES (
    NULL,  -- guest path
    BTRIM(p_payload->>'patient_name'),
    NULLIF(p_payload->>'patient_age', '')::INT,
    BTRIM(p_payload->>'contact_name'),
    BTRIM(p_payload->>'contact_phone'),
    NULLIF(BTRIM(p_payload->>'contact_email'), ''),
    v_severity,
    v_service_level,
    BTRIM(p_payload->>'from_location_freeform'),
    NULLIF(BTRIM(p_payload->>'from_iata'), ''),
    BTRIM(p_payload->>'to_hospital_name'),
    NULLIF(BTRIM(p_payload->>'to_hospital_contact_phone'), ''),
    NULLIF(BTRIM(p_payload->>'to_hospital_freeform_address'), ''),
    NULLIF(BTRIM(p_payload->>'to_iata'), ''),
    NULLIF(BTRIM(p_payload->>'insurance_provider'), ''),
    NULLIF(BTRIM(p_payload->>'insurance_claim_ref'), ''),
    (p_payload->>'estimated_value_sar')::DECIMAL,
    'pending'
  )
  RETURNING id, medevac_request_number INTO v_request_id, v_request_number;

  RETURN json_build_object(
    'ok', true,
    'medevac_request_id', v_request_id,
    'medevac_request_number', v_request_number
  );
END;
$$;

REVOKE ALL ON FUNCTION create_medevac_request_guest(JSONB, INET) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_medevac_request_guest(JSONB, INET) TO service_role;


-- ============================================================
-- §4.2 — create_medevac_request_authenticated RPC (NEW)
--
-- Authed client path. Allows all severities. The J5 covered
-- branch (use_subscription=true) is routed through
-- consume_aeris_shield_event from the Server Action layer,
-- NOT from inside this RPC — keeps the two RPC contracts
-- distinct and the audit trail clean.
-- ============================================================

CREATE OR REPLACE FUNCTION create_medevac_request_authenticated(
  p_client_id UUID,
  p_payload   JSONB
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id UUID;
  v_request_number TEXT;
  v_severity medevac_severity;
  v_service_level medevac_service_level;
BEGIN
  IF p_client_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'client_id_required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  -- Severity + service_level text allowlist
  IF p_payload->>'condition_severity' IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'condition_severity_required');
  END IF;
  IF (p_payload->>'condition_severity') NOT IN ('stable', 'moderate', 'critical') THEN
    RETURN json_build_object('ok', false, 'error', 'condition_severity_invalid');
  END IF;
  v_severity := (p_payload->>'condition_severity')::medevac_severity;

  IF p_payload->>'service_level' IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'service_level_required');
  END IF;
  IF (p_payload->>'service_level') NOT IN ('BMT', 'ALS', 'CCT', 'repatriation') THEN
    RETURN json_build_object('ok', false, 'error', 'service_level_invalid');
  END IF;
  v_service_level := (p_payload->>'service_level')::medevac_service_level;

  -- Required-field guards
  IF NULLIF(BTRIM(p_payload->>'patient_name'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'patient_name_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'contact_name'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'contact_name_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'contact_phone'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'contact_phone_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'from_location_freeform'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'from_location_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'to_hospital_name'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'to_hospital_required');
  END IF;
  IF NULLIF(p_payload->>'estimated_value_sar', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'estimated_value_required');
  END IF;

  -- Length guards (same caps as guest path)
  IF length(BTRIM(p_payload->>'patient_name')) > 200 THEN
    RETURN json_build_object('ok', false, 'error', 'patient_name_invalid');
  END IF;
  IF length(BTRIM(p_payload->>'contact_name')) > 120 THEN
    RETURN json_build_object('ok', false, 'error', 'contact_name_invalid');
  END IF;
  IF length(BTRIM(p_payload->>'contact_phone')) > 20 THEN
    RETURN json_build_object('ok', false, 'error', 'contact_phone_invalid');
  END IF;
  IF p_payload->>'contact_email' IS NOT NULL
     AND length(BTRIM(p_payload->>'contact_email')) > 120 THEN
    RETURN json_build_object('ok', false, 'error', 'contact_email_invalid');
  END IF;
  IF length(BTRIM(p_payload->>'from_location_freeform')) > 300 THEN
    RETURN json_build_object('ok', false, 'error', 'from_location_invalid');
  END IF;
  IF length(BTRIM(p_payload->>'to_hospital_name')) > 300 THEN
    RETURN json_build_object('ok', false, 'error', 'to_hospital_invalid');
  END IF;

  IF (p_payload->>'estimated_value_sar')::DECIMAL <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'estimated_value_invalid');
  END IF;

  INSERT INTO medevac_requests (
    client_id,
    patient_name_snapshot,
    patient_age_snapshot,
    contact_name_snapshot,
    contact_phone_snapshot,
    contact_email_snapshot,
    condition_severity,
    service_level,
    from_location_freeform,
    from_iata,
    to_hospital_name,
    to_hospital_contact_phone,
    to_hospital_freeform_address,
    to_iata,
    insurance_provider_snapshot,
    insurance_claim_ref,
    estimated_value_sar,
    status
  ) VALUES (
    p_client_id,
    BTRIM(p_payload->>'patient_name'),
    NULLIF(p_payload->>'patient_age', '')::INT,
    BTRIM(p_payload->>'contact_name'),
    BTRIM(p_payload->>'contact_phone'),
    NULLIF(BTRIM(p_payload->>'contact_email'), ''),
    v_severity,
    v_service_level,
    BTRIM(p_payload->>'from_location_freeform'),
    NULLIF(BTRIM(p_payload->>'from_iata'), ''),
    BTRIM(p_payload->>'to_hospital_name'),
    NULLIF(BTRIM(p_payload->>'to_hospital_contact_phone'), ''),
    NULLIF(BTRIM(p_payload->>'to_hospital_freeform_address'), ''),
    NULLIF(BTRIM(p_payload->>'to_iata'), ''),
    NULLIF(BTRIM(p_payload->>'insurance_provider'), ''),
    NULLIF(BTRIM(p_payload->>'insurance_claim_ref'), ''),
    (p_payload->>'estimated_value_sar')::DECIMAL,
    'pending'
  )
  RETURNING id, medevac_request_number INTO v_request_id, v_request_number;

  RETURN json_build_object(
    'ok', true,
    'medevac_request_id', v_request_id,
    'medevac_request_number', v_request_number
  );
END;
$$;

REVOKE ALL ON FUNCTION create_medevac_request_authenticated(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_medevac_request_authenticated(UUID, JSONB) TO service_role;


-- ============================================================
-- §4.3 — submit_medevac_offer RPC (NEW)
--
-- Operator path. Capability check queries
-- aircraft_medical_certifications. D11: refuses offers from
-- expired-cert aircraft (certification_expires_at > NOW()).
-- ============================================================

CREATE OR REPLACE FUNCTION submit_medevac_offer(
  p_operator_id UUID,
  p_payload     JSONB
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_request medevac_requests%ROWTYPE;
  v_aircraft aircraft%ROWTYPE;
  v_operator operators%ROWTYPE;
  v_cert aircraft_medical_certifications%ROWTYPE;
  v_aircraft_id UUID;
  v_request_id UUID;
  v_offer_id UUID;
  v_base_price DECIMAL(14, 2);
  v_medical_team_price DECIMAL(14, 2);
  v_insurance_coord_price DECIMAL(14, 2);
  v_proposed_pickup TIMESTAMPTZ;
  v_proposed_arrival TIMESTAMPTZ;
  v_cert_supports BOOLEAN;
BEGIN
  IF p_operator_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'operator_id_required');
  END IF;

  -- Resolve operator + approval check
  SELECT * INTO v_operator FROM operators WHERE id = p_operator_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;
  IF v_operator.signup_status <> 'approved' THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_approved');
  END IF;

  -- Resolve request
  IF NULLIF(p_payload->>'medevac_request_id', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'medevac_request_id_required');
  END IF;
  v_request_id := (p_payload->>'medevac_request_id')::UUID;
  SELECT * INTO v_request FROM medevac_requests WHERE id = v_request_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'medevac_request_not_found');
  END IF;
  IF v_request.status NOT IN ('pending', 'offers_received') THEN
    RETURN json_build_object('ok', false, 'error', 'medevac_request_not_open');
  END IF;
  IF v_request.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'medevac_request_expired');
  END IF;

  -- Resolve aircraft + ownership check
  IF NULLIF(p_payload->>'aircraft_id', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'aircraft_id_required');
  END IF;
  v_aircraft_id := (p_payload->>'aircraft_id')::UUID;
  SELECT * INTO v_aircraft FROM aircraft WHERE id = v_aircraft_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'aircraft_not_found');
  END IF;
  IF v_aircraft.operator_id <> p_operator_id THEN
    RETURN json_build_object('ok', false, 'error', 'aircraft_not_owned');
  END IF;

  -- Medical certification gate (D7 + D11)
  SELECT * INTO v_cert
    FROM aircraft_medical_certifications
   WHERE aircraft_id = v_aircraft_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'aircraft_no_medical_certification');
  END IF;
  IF v_cert.certification_expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'aircraft_certification_expired');
  END IF;

  -- Match the requested service_level against the supports_* flag
  v_cert_supports := CASE v_request.service_level
    WHEN 'BMT'          THEN v_cert.supports_BMT
    WHEN 'ALS'          THEN v_cert.supports_ALS
    WHEN 'CCT'          THEN v_cert.supports_CCT
    WHEN 'repatriation' THEN v_cert.supports_repatriation
    ELSE false
  END;
  IF NOT v_cert_supports THEN
    RETURN json_build_object('ok', false, 'error', 'aircraft_capability_missing');
  END IF;

  -- Pricing guards
  IF NULLIF(p_payload->>'base_price_sar', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'base_price_required');
  END IF;
  v_base_price := (p_payload->>'base_price_sar')::DECIMAL;
  IF v_base_price <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'base_price_invalid');
  END IF;
  v_medical_team_price := COALESCE(
    NULLIF(p_payload->>'medical_team_price_sar', '')::DECIMAL,
    0
  );
  IF v_medical_team_price < 0 THEN
    RETURN json_build_object('ok', false, 'error', 'medical_team_price_invalid');
  END IF;
  v_insurance_coord_price := COALESCE(
    NULLIF(p_payload->>'insurance_coordination_price_sar', '')::DECIMAL,
    0
  );
  IF v_insurance_coord_price < 0 THEN
    RETURN json_build_object('ok', false, 'error', 'insurance_coordination_price_invalid');
  END IF;

  -- Timestamp guards
  IF NULLIF(p_payload->>'proposed_pickup_at', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'proposed_pickup_at_required');
  END IF;
  IF NULLIF(p_payload->>'proposed_arrival_at', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'proposed_arrival_at_required');
  END IF;
  v_proposed_pickup := (p_payload->>'proposed_pickup_at')::TIMESTAMPTZ;
  v_proposed_arrival := (p_payload->>'proposed_arrival_at')::TIMESTAMPTZ;
  IF v_proposed_pickup <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'proposed_pickup_must_be_future');
  END IF;
  IF v_proposed_arrival <= v_proposed_pickup THEN
    RETURN json_build_object('ok', false, 'error', 'proposed_arrival_after_pickup');
  END IF;

  -- INSERT offer
  INSERT INTO medevac_offers (
    medevac_request_id,
    operator_id,
    aircraft_id,
    operator_name_snapshot,
    operator_phone_snapshot,
    operator_email_snapshot,
    aircraft_snapshot,
    medical_team_snapshot,
    base_price_sar,
    medical_team_price_sar,
    insurance_coordination_price_sar,
    proposed_pickup_at,
    proposed_arrival_at,
    operator_notes,
    status
  ) VALUES (
    v_request_id,
    p_operator_id,
    v_aircraft_id,
    LEFT(COALESCE(v_operator.company_name, ''), 200),
    LEFT(COALESCE(v_operator.contact_phone, ''), 20),
    LEFT(COALESCE(v_operator.contact_email, ''), 255),
    NULLIF(BTRIM(p_payload->>'aircraft_snapshot'), ''),
    NULLIF(BTRIM(p_payload->>'medical_team_snapshot'), ''),
    v_base_price,
    v_medical_team_price,
    v_insurance_coord_price,
    v_proposed_pickup,
    v_proposed_arrival,
    NULLIF(BTRIM(p_payload->>'operator_notes'), ''),
    'pending'
  )
  RETURNING id INTO v_offer_id;

  -- Flip request status pending → offers_received if first offer
  IF v_request.status = 'pending' THEN
    UPDATE medevac_requests
       SET status = 'offers_received',
           updated_at = NOW()
     WHERE id = v_request_id
       AND status = 'pending';
  END IF;

  RETURN json_build_object(
    'ok', true,
    'medevac_offer_id', v_offer_id
  );
END;
$$;

REVOKE ALL ON FUNCTION submit_medevac_offer(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_medevac_offer(UUID, JSONB) TO service_role;


-- ============================================================
-- §4.7 — consume_aeris_shield_event RPC (NEW — Shield path)
--
-- Atomic Shield-funded request + booking insert. 10 steps;
-- any RAISE EXCEPTION (or structured 'ok:false' return)
-- aborts the whole RPC inside Postgres' statement-level
-- transaction (Round 3 P1 #2: no PL/pgSQL ROLLBACK needed).
-- ============================================================

CREATE OR REPLACE FUNCTION consume_aeris_shield_event(
  p_subscription_id     UUID,
  p_client_id           UUID,
  p_patient_member_name TEXT,
  p_patient_member_dob  DATE,
  p_payload             JSONB
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_subscription medevac_subscriptions%ROWTYPE;
  v_config aeris_shield_config%ROWTYPE;
  v_operator operators%ROWTYPE;
  v_aircraft aircraft%ROWTYPE;
  v_cert_aircraft_id UUID;
  v_normalised_name TEXT;
  v_canonical_patient_name TEXT;
  v_patient_age INT;
  v_severity medevac_severity;
  v_service_level medevac_service_level;
  v_non_repat_allowed TEXT[];
  v_entitled BOOLEAN;
  v_request_id UUID;
  v_request_number TEXT;
  v_booking_id UUID;
BEGIN
  IF p_subscription_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'subscription_id_required');
  END IF;
  IF p_client_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'client_id_required');
  END IF;
  IF NULLIF(BTRIM(p_patient_member_name), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'patient_member_name_required');
  END IF;

  -- Round 9 P1 #1: future-DOB guard before any matching.
  IF p_patient_member_dob IS NULL
     OR p_patient_member_dob > CURRENT_DATE THEN
    RETURN json_build_object('ok', false, 'error', 'patient_dob_invalid');
  END IF;

  -- Service-level + severity text allowlist
  IF p_payload->>'condition_severity' IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'condition_severity_required');
  END IF;
  IF (p_payload->>'condition_severity') NOT IN ('stable', 'moderate', 'critical') THEN
    RETURN json_build_object('ok', false, 'error', 'condition_severity_invalid');
  END IF;
  v_severity := (p_payload->>'condition_severity')::medevac_severity;

  IF p_payload->>'service_level' IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'service_level_required');
  END IF;
  IF (p_payload->>'service_level') NOT IN ('BMT', 'ALS', 'CCT', 'repatriation') THEN
    RETURN json_build_object('ok', false, 'error', 'service_level_invalid');
  END IF;
  v_service_level := (p_payload->>'service_level')::medevac_service_level;

  -- Route + customer payload guards
  IF NULLIF(BTRIM(p_payload->>'contact_name'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'contact_name_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'contact_phone'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'contact_phone_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'from_location_freeform'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'from_location_required');
  END IF;
  IF NULLIF(BTRIM(p_payload->>'to_hospital_name'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'to_hospital_required');
  END IF;
  IF NULLIF(p_payload->>'estimated_value_sar', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'estimated_value_required');
  END IF;

  -- Step 1 — Lock the subscription FOR UPDATE.
  SELECT * INTO v_subscription
    FROM medevac_subscriptions
   WHERE id = p_subscription_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'subscription_not_found');
  END IF;

  -- Step 2 — Verify subscription ownership (Round 4 P1 #2).
  IF v_subscription.client_id <> p_client_id THEN
    RETURN json_build_object('ok', false, 'error', 'subscription_not_owned');
  END IF;

  -- Step 3 — Verify subscription state.
  IF v_subscription.status <> 'active'
     OR v_subscription.end_date IS NULL
     OR v_subscription.end_date <= CURRENT_DATE
     OR NOT (
       v_subscription.covered_events_at_signup = -1
       OR v_subscription.used_events < v_subscription.covered_events_at_signup
     )
  THEN
    RETURN json_build_object('ok', false, 'error', 'subscription_not_consumable');
  END IF;

  -- Step 4 — Patient covered-member eligibility (Round 6 P1 #3 +
  -- Round 8 P2 #1 safe_parse_date + Round 9 P1 #1 future-DOB guard).
  v_normalised_name := BTRIM(lower(p_patient_member_name));

  SELECT BTRIM(m->>'name')
    INTO v_canonical_patient_name
    FROM jsonb_array_elements(v_subscription.covered_members) AS m
   WHERE lower(BTRIM(m->>'name')) = v_normalised_name
     AND safe_parse_date(m->>'dob') = p_patient_member_dob
   LIMIT 1;

  IF v_canonical_patient_name IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'patient_not_covered');
  END IF;

  -- Step 5 — Service-level eligibility (Round 4 P1 #1 decomposed
  -- matrix: non-repat per service_level_at_signup, repat per flag).
  v_non_repat_allowed := CASE v_subscription.service_level_at_signup
    WHEN 'BMT'          THEN ARRAY['BMT']
    WHEN 'ALS'          THEN ARRAY['BMT', 'ALS']
    WHEN 'CCT'          THEN ARRAY['BMT', 'ALS', 'CCT']
    WHEN 'repatriation' THEN ARRAY['BMT', 'ALS', 'CCT']
    ELSE ARRAY[]::TEXT[]
  END;

  v_entitled := (
    (v_service_level::TEXT <> 'repatriation'
     AND v_service_level::TEXT = ANY(v_non_repat_allowed))
    OR
    (v_service_level::TEXT = 'repatriation'
     AND v_subscription.includes_repatriation_at_signup = true)
  );

  IF NOT v_entitled THEN
    RETURN json_build_object('ok', false, 'error', 'service_level_not_entitled');
  END IF;

  -- Step 6 — Load + verify aeris_shield_config.default_operator_id.
  SELECT * INTO v_config FROM aeris_shield_config WHERE id = 1;
  IF NOT FOUND OR v_config.default_operator_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'shield_default_operator_missing');
  END IF;

  SELECT * INTO v_operator FROM operators WHERE id = v_config.default_operator_id;
  IF NOT FOUND OR v_operator.signup_status <> 'approved' THEN
    RETURN json_build_object('ok', false, 'error', 'shield_default_operator_not_approved');
  END IF;

  -- Find first capable aircraft owned by the default operator
  SELECT amc.aircraft_id INTO v_cert_aircraft_id
    FROM aircraft_medical_certifications amc
    JOIN aircraft a ON a.id = amc.aircraft_id
   WHERE a.operator_id = v_operator.id
     AND amc.certification_expires_at > NOW()
     AND CASE v_service_level
       WHEN 'BMT'          THEN amc.supports_BMT
       WHEN 'ALS'          THEN amc.supports_ALS
       WHEN 'CCT'          THEN amc.supports_CCT
       WHEN 'repatriation' THEN amc.supports_repatriation
       ELSE false
     END
   ORDER BY amc.updated_at DESC
   LIMIT 1;
  IF v_cert_aircraft_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'shield_default_operator_not_certified');
  END IF;

  IF NULLIF(BTRIM(v_operator.contact_email), '') IS NULL
     OR NULLIF(BTRIM(v_operator.contact_phone), '') IS NULL
  THEN
    RETURN json_build_object('ok', false, 'error', 'shield_default_operator_missing_contact');
  END IF;

  SELECT * INTO v_aircraft FROM aircraft WHERE id = v_cert_aircraft_id;

  -- Compute patient age (Round 9 P1 #1: pin to INT — AGE returns INTERVAL).
  v_patient_age := EXTRACT(YEAR FROM AGE(CURRENT_DATE, p_patient_member_dob))::INT;

  -- Step 7 — Increment used_events.
  UPDATE medevac_subscriptions
     SET used_events = used_events + 1,
         updated_at = NOW()
   WHERE id = p_subscription_id;

  -- Step 8 — Insert medevac_requests row (covered shape).
  INSERT INTO medevac_requests (
    client_id,
    patient_name_snapshot,
    patient_age_snapshot,
    contact_name_snapshot,
    contact_phone_snapshot,
    contact_email_snapshot,
    condition_severity,
    service_level,
    from_location_freeform,
    from_iata,
    to_hospital_name,
    to_hospital_contact_phone,
    to_hospital_freeform_address,
    to_iata,
    insurance_provider_snapshot,
    insurance_claim_ref,
    estimated_value_sar,
    subscription_id,
    is_covered,
    status
  ) VALUES (
    p_client_id,
    v_canonical_patient_name,
    v_patient_age,
    BTRIM(p_payload->>'contact_name'),
    BTRIM(p_payload->>'contact_phone'),
    NULLIF(BTRIM(p_payload->>'contact_email'), ''),
    v_severity,
    v_service_level,
    BTRIM(p_payload->>'from_location_freeform'),
    NULLIF(BTRIM(p_payload->>'from_iata'), ''),
    BTRIM(p_payload->>'to_hospital_name'),
    NULLIF(BTRIM(p_payload->>'to_hospital_contact_phone'), ''),
    NULLIF(BTRIM(p_payload->>'to_hospital_freeform_address'), ''),
    NULLIF(BTRIM(p_payload->>'to_iata'), ''),
    NULLIF(BTRIM(p_payload->>'insurance_provider'), ''),
    NULLIF(BTRIM(p_payload->>'insurance_claim_ref'), ''),
    (p_payload->>'estimated_value_sar')::DECIMAL,
    p_subscription_id,
    true,
    'covered'
  )
  RETURNING id, medevac_request_number INTO v_request_id, v_request_number;

  -- Step 9 — Insert bookings row (covered variant: both source
  -- fields NULL, source_discriminator='medevac', payment_status
  -- ='pending_offline' per Round 2 P1 #3).
  INSERT INTO bookings (
    operator_id,
    client_id,
    source_offer_table,
    source_offer_id,
    source_discriminator,
    offer_id,
    trip_request_id,
    operator_name_snapshot,
    operator_email_snapshot,
    operator_phone_snapshot,
    customer_name_snapshot,
    customer_email_snapshot,
    customer_phone_snapshot,
    total_price_sar,
    payment_status,
    status,
    notes
  ) VALUES (
    v_operator.id,
    p_client_id,
    NULL,                             -- D6 covered variant
    NULL,                             -- D6 covered variant
    'medevac',
    NULL,
    NULL,
    LEFT(COALESCE(v_operator.company_name, ''), 200),
    LEFT(COALESCE(v_operator.contact_email, ''), 255),
    LEFT(COALESCE(v_operator.contact_phone, ''), 20),
    v_canonical_patient_name,
    NULLIF(BTRIM(p_payload->>'contact_email'), ''),
    BTRIM(p_payload->>'contact_phone'),
    (p_payload->>'estimated_value_sar')::DECIMAL,
    'pending_offline',                -- Round 2 P1 #3
    'confirmed',
    'Shield covered event (' || v_request_number || ')'
  )
  RETURNING id INTO v_booking_id;

  -- Step 10 — Audit log entry (PII redacted per D12).
  INSERT INTO audit_logs (
    entity_type, entity_id, action, new_value, user_id
  ) VALUES (
    'medevac_request',
    v_request_id,
    'shield_event_consumed',
    jsonb_build_object(
      'mev_number', v_request_number,
      'subscription_id', p_subscription_id,
      'service_level', v_service_level,
      'condition_severity', v_severity,
      'operator_id', v_operator.id,
      'aircraft_id', v_cert_aircraft_id,
      'covered_events_remaining',
        CASE
          WHEN v_subscription.covered_events_at_signup = -1 THEN -1
          ELSE v_subscription.covered_events_at_signup - (v_subscription.used_events + 1)
        END
    ),
    NULL
  );

  RETURN json_build_object(
    'ok', true,
    'medevac_request_id', v_request_id,
    'medevac_request_number', v_request_number,
    'booking_id', v_booking_id,
    'covered_events_remaining',
      CASE
        WHEN v_subscription.covered_events_at_signup = -1 THEN -1
        ELSE v_subscription.covered_events_at_signup - (v_subscription.used_events + 1)
      END,
    'dispatched_operator_id', v_operator.id
  );
END;
$$;

REVOKE ALL ON FUNCTION consume_aeris_shield_event(UUID, UUID, TEXT, DATE, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_aeris_shield_event(UUID, UUID, TEXT, DATE, JSONB) TO service_role;


-- ============================================================
-- §4.8 — subscribe_to_aeris_shield RPC (NEW — Shield signup)
--
-- Wraps medevac_subscriptions INSERT. Round 6 P1 #3: prepends
-- the owner to covered_members as relationship='self' using
-- the required p_owner_dob param (clients table has no
-- date_of_birth). Enforces uniqueness on
-- (lower(BTRIM(name)), dob) across the resulting array.
-- ============================================================

CREATE OR REPLACE FUNCTION subscribe_to_aeris_shield(
  p_client_id              UUID,
  p_plan                   TEXT,
  p_owner_dob              DATE,
  p_payload_covered_members JSONB
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_client clients%ROWTYPE;
  v_plan aeris_shield_plan;
  v_terms medevac_subscription_plan_terms%ROWTYPE;
  v_covered_members JSONB;
  v_member_count INT;
  v_subscription_id UUID;
  v_subscription_number TEXT;
  v_owner_name TEXT;
  v_pair_count INT;
BEGIN
  IF p_client_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'client_id_required');
  END IF;
  SELECT * INTO v_client FROM clients WHERE id = p_client_id;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  -- DOB guards
  IF p_owner_dob IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'owner_dob_required');
  END IF;
  IF p_owner_dob > CURRENT_DATE THEN
    RETURN json_build_object('ok', false, 'error', 'owner_dob_invalid');
  END IF;

  -- Plan allowlist + lookup
  IF p_plan IS NULL OR p_plan NOT IN ('individual', 'family', 'vip_family', 'diamond') THEN
    RETURN json_build_object('ok', false, 'error', 'plan_invalid');
  END IF;
  v_plan := p_plan::aeris_shield_plan;

  SELECT * INTO v_terms FROM medevac_subscription_plan_terms WHERE plan = v_plan;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'plan_terms_not_found');
  END IF;

  -- Owner name from client record (canonical, casing preserved)
  v_owner_name := BTRIM(COALESCE(v_client.full_name, ''));
  IF v_owner_name = '' THEN
    RETURN json_build_object('ok', false, 'error', 'client_full_name_missing');
  END IF;

  -- Prepend the owner to covered_members
  v_covered_members := jsonb_build_array(
    jsonb_build_object(
      'name', v_owner_name,
      'relationship', 'self',
      'dob', to_jsonb(p_owner_dob)
    )
  ) || COALESCE(p_payload_covered_members, '[]'::jsonb);

  -- Size cap (≤ plan's max_covered_members)
  v_member_count := jsonb_array_length(v_covered_members);
  IF v_member_count > v_terms.max_covered_members THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'covered_members_exceed_plan_cap',
      'max_allowed', v_terms.max_covered_members,
      'attempted', v_member_count
    );
  END IF;

  -- Uniqueness on (lower(BTRIM(name)), dob) — Round 6 P1 #3.
  -- Counts distinct (name, dob) pairs and compares to total
  -- count; mismatch means a duplicate exists.
  SELECT COUNT(DISTINCT (lower(BTRIM(m->>'name')), safe_parse_date(m->>'dob')))
    INTO v_pair_count
    FROM jsonb_array_elements(v_covered_members) AS m
   WHERE safe_parse_date(m->>'dob') IS NOT NULL
     AND safe_parse_date(m->>'dob') <= CURRENT_DATE
     AND NULLIF(BTRIM(m->>'name'), '') IS NOT NULL;

  IF v_pair_count <> v_member_count THEN
    RETURN json_build_object('ok', false, 'error', 'covered_members_duplicate_pair');
  END IF;

  -- INSERT the subscription (pending_payment; activation lands later)
  INSERT INTO medevac_subscriptions (
    client_id,
    plan,
    annual_fee_at_signup_sar,
    covered_events_at_signup,
    service_level_at_signup,
    includes_repatriation_at_signup,
    max_covered_members_at_signup,
    covered_members,
    used_events,
    start_date,
    end_date,
    auto_renew,
    status
  ) VALUES (
    p_client_id,
    v_plan,
    v_terms.annual_fee_sar,
    v_terms.covered_events,
    v_terms.service_level,
    v_terms.includes_repatriation,
    v_terms.max_covered_members,
    v_covered_members,
    0,
    NULL,                       -- Round 2 P1 #1: nullable until activation
    NULL,
    true,
    'pending_payment'
  )
  RETURNING id, subscription_number
       INTO v_subscription_id, v_subscription_number;

  RETURN json_build_object(
    'ok', true,
    'subscription_id', v_subscription_id,
    'subscription_number', v_subscription_number,
    'status', 'pending_payment'
  );
END;
$$;

REVOKE ALL ON FUNCTION subscribe_to_aeris_shield(UUID, TEXT, DATE, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION subscribe_to_aeris_shield(UUID, TEXT, DATE, JSONB) TO service_role;


-- ============================================================
-- §4.10 — admin_read_medevac_request_detail RPC (NEW)
--
-- Round 6 P1 #2: atomic admin PII read + admin_pii_read audit
-- in one SECURITY DEFINER contract. Round 7 P1 #1: fail-closed
-- step 0 metadata guard. The audit INSERT happens BEFORE the
-- PII SELECT so a SELECT failure can never expose data
-- unaudited; both writes live in one statement-level
-- transaction.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_read_medevac_request_detail(
  p_request_id       UUID,
  p_session_metadata JSONB
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_mev_number TEXT;
  v_service_level medevac_service_level;
  v_condition_severity medevac_severity;
  v_request_json JSON;
BEGIN
  -- Step 0 — Fail-closed metadata guard (Round 7 P1 #1).
  IF p_session_metadata IS NULL
     OR (p_session_metadata->>'cookie_expiry') IS NULL
     OR length(BTRIM(p_session_metadata->>'cookie_expiry')) = 0
     OR (p_session_metadata->>'cookie_fingerprint') IS NULL
     OR length(BTRIM(p_session_metadata->>'cookie_fingerprint')) = 0
  THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'admin_session_metadata_required'
    );
  END IF;

  IF p_request_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'request_id_required');
  END IF;

  -- Pre-resolve metadata fields so the audit row reflects the
  -- actual row even if a downstream guard fails (e.g. unknown UUID).
  SELECT medevac_request_number, service_level, condition_severity
    INTO v_mev_number, v_service_level, v_condition_severity
    FROM medevac_requests
   WHERE id = p_request_id;

  -- Step 1 — INSERT the audit row FIRST.
  --
  -- Round 6 P1 #1: user_id is NULL because Aeris admin auth is
  -- a cookie session, not a users.id; the identity lives in
  -- new_value via cookie_expiry + cookie_fingerprint.
  INSERT INTO audit_logs (
    entity_type, entity_id, action, new_value, user_id
  ) VALUES (
    'medevac_request',
    p_request_id,
    'admin_pii_read',
    jsonb_build_object(
      'mev_number', v_mev_number,
      'service_level', v_service_level,
      'condition_severity', v_condition_severity,
      'cookie_expiry', p_session_metadata->>'cookie_expiry',
      'cookie_fingerprint', p_session_metadata->>'cookie_fingerprint'
    ),
    NULL
  );

  -- Step 2 — SELECT the full PII row.
  SELECT row_to_json(r) INTO v_request_json
    FROM medevac_requests r
   WHERE r.id = p_request_id;

  IF v_request_json IS NULL THEN
    -- Row genuinely not found. Audit row from step 1 stays
    -- (captures the access attempt with NULL service_level etc.).
    RETURN json_build_object(
      'ok', false,
      'error', 'request_not_found'
    );
  END IF;

  -- Step 3 — Return.
  RETURN json_build_object(
    'ok', true,
    'request', v_request_json,
    'audit_logged_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_read_medevac_request_detail(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_read_medevac_request_detail(UUID, JSONB) TO service_role;


-- ============================================================
-- Migration summary
-- ============================================================
-- Phase 12 PR 1 created/extended:
--   - 7 NEW ENUMs (medevac_severity, medevac_service_level,
--     medevac_request_status, medevac_offer_status,
--     aeris_shield_plan, aeris_shield_subscription_status,
--     medical_certifying_authority)
--   - 8 NEW tables/lookups/singletons (medevac_requests,
--     medevac_offers, aircraft_medical_certifications,
--     medevac_severity_sla, medevac_subscription_plan_terms,
--     medevac_subscriptions, aeris_shield_config,
--     medevac_email_alert_status)
--   - 2 deferred FKs (accepted_offer_id, subscription_id)
--   - 2 bookings CHECK extensions (source_discriminator,
--     source_offer_check) for 'medevac' / 'medevac_offers'
--   - 1 trigger (enforce_aircraft_medical_certifications_trigger)
--   - 8 named indexes
--   - 6 RPCs + 1 helper function (safe_parse_date)
--   - RLS enabled on every new table/lookup/singleton
--   - 14 named CHECK + FK constraints
--
-- Probe 33 inventory (spec §6) verifies all of the above.
-- ============================================================
