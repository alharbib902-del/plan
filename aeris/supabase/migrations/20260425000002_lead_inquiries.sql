-- ============================================
-- AERIS — Lead Inquiries (Phase 2)
-- Migration: 20260425000002
-- ============================================
--
-- Stores guest flight requests captured via the public website form.
-- This table is SERVER-ONLY: RLS is enabled with no policies for anon
-- or authenticated roles, so the only way to read or write is the
-- Supabase service-role key used by the Next.js admin client.
--
-- Reuses helpers from 20260422000001_initial_schema.sql:
--   - update_updated_at()
--   - generate_request_number(prefix TEXT)
-- ============================================

CREATE TYPE lead_status AS ENUM (
  'new', 'contacted', 'quoted', 'converted', 'closed'
);

CREATE TYPE lead_trip_type AS ENUM (
  'one_way', 'round_trip', 'multi_city'
);

CREATE TABLE lead_inquiries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- DB is the single source of truth for request_number.
  -- App code MUST NOT pre-generate this; INSERT and read RETURNING.
  request_number  VARCHAR(20) UNIQUE NOT NULL DEFAULT generate_request_number('AER'),

  -- Customer fields (public form data)
  customer_name   VARCHAR(120) NOT NULL,
  customer_phone  VARCHAR(20)  NOT NULL,

  -- Trip fields (matches lib/validators/trip-request.ts shape)
  trip_type       lead_trip_type NOT NULL,
  origin          VARCHAR(120) NOT NULL,
  destination     VARCHAR(120) NOT NULL,
  departure_date  DATE NOT NULL,
  return_date     DATE,
  passengers      SMALLINT NOT NULL CHECK (passengers BETWEEN 1 AND 19),
  notes           TEXT,

  -- Operational fields
  status          lead_status NOT NULL DEFAULT 'new',
  source          VARCHAR(40)  NOT NULL DEFAULT 'website',
  internal_notes  TEXT,
  last_contacted_at TIMESTAMPTZ,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lead_inquiries_status_created
  ON lead_inquiries (status, created_at DESC);

CREATE INDEX idx_lead_inquiries_created
  ON lead_inquiries (created_at DESC);

CREATE TRIGGER lead_inquiries_updated_at BEFORE UPDATE ON lead_inquiries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: deny-all by default. Only the service role (admin client) reads/writes.
ALTER TABLE lead_inquiries ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies → anon + authenticated cannot SELECT/INSERT/UPDATE/DELETE.

COMMENT ON TABLE lead_inquiries IS
  'Phase 2: guest flight requests from /request. Server-only access via service role.';
