-- ============================================
-- AERIS — Abandoned trip-request recovery (client reminders)
-- Migration: 20260531000005  (forward-only)
-- ============================================
-- Client-side recovery nudge: a trip_request that reached `offered` (operators
-- have made offers) but the client never accepted → after a delay the recovery
-- cron emails the client once to come back and complete the booking. Deduped to
-- one reminder per request.
--
-- Discipline (Phase 8/9): deny-all RLS; the cron + dedup go through the
-- service-role client + the SECURITY DEFINER RPCs below only.

CREATE TABLE IF NOT EXISTS trip_request_recovery_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_request_id UUID NOT NULL REFERENCES trip_requests(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email',
  reminded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trip_request_recovery_reminders_unique UNIQUE (trip_request_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_request_recovery_reminders_client
  ON trip_request_recovery_reminders (client_id);

ALTER TABLE trip_request_recovery_reminders ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: deny-all for anon/authenticated. Service-role only.
REVOKE ALL ON trip_request_recovery_reminders FROM anon, authenticated;

-- ---- RPC: record_trip_request_recovery_reminder (race-safe claim) ------------
CREATE OR REPLACE FUNCTION record_trip_request_recovery_reminder(
  p_trip_request_id UUID,
  p_channel TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- client_id is derived from the request itself, never trusted from the caller.
  INSERT INTO trip_request_recovery_reminders (trip_request_id, client_id, channel)
  SELECT tr.id, tr.client_id, COALESCE(NULLIF(trim(p_channel), ''), 'email')
  FROM trip_requests tr
  WHERE tr.id = p_trip_request_id AND tr.client_id IS NOT NULL
  ON CONFLICT (trip_request_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;  -- NULL when already reminded, or request missing / guest-owned
END;
$$;

-- ---- RPC: delete_trip_request_recovery_reminder (release claim on send fail) -
CREATE OR REPLACE FUNCTION delete_trip_request_recovery_reminder(
  p_reminder_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  DELETE FROM trip_request_recovery_reminders WHERE id = p_reminder_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

-- ---- RPC: list_recoverable_trip_requests ------------------------------------
-- Candidate selection for the cron. The not-yet-reminded filter is an anti-join
-- (LEFT JOIN reminders ... IS NULL) applied BEFORE the limit, so already-reminded
-- requests can never crowd out newer ones (no starvation). Uses updated_at (no
-- activity for the stale window) rather than created_at, so a request that only
-- just became `offered` is not reminded immediately. Guests excluded by the join.
CREATE OR REPLACE FUNCTION list_recoverable_trip_requests(
  p_stale_before TIMESTAMPTZ,
  p_limit INTEGER
)
RETURNS TABLE (
  trip_request_id UUID,
  request_number VARCHAR,
  departure_airport VARCHAR,
  arrival_airport VARCHAR,
  client_id UUID,
  client_full_name VARCHAR,
  client_auth_email VARCHAR,
  client_contact_phone VARCHAR
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tr.id, tr.request_number, tr.departure_airport, tr.arrival_airport,
         c.id, c.full_name, c.auth_email, c.contact_phone
  FROM trip_requests tr
  JOIN clients c ON c.id = tr.client_id
  LEFT JOIN trip_request_recovery_reminders r ON r.trip_request_id = tr.id
  WHERE tr.status = 'offered'
    AND tr.updated_at < p_stale_before
    AND r.id IS NULL
  ORDER BY tr.updated_at ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;

-- ---- grants — service_role ONLY ---------------------------------------------
REVOKE ALL ON FUNCTION record_trip_request_recovery_reminder(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_trip_request_recovery_reminder(UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION delete_trip_request_recovery_reminder(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_trip_request_recovery_reminder(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION list_recoverable_trip_requests(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION list_recoverable_trip_requests(TIMESTAMPTZ, INTEGER)
  TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
