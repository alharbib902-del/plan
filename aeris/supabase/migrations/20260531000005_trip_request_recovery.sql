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
  p_client_id UUID,
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
  INSERT INTO trip_request_recovery_reminders (trip_request_id, client_id, channel)
  VALUES (p_trip_request_id, p_client_id, COALESCE(NULLIF(trim(p_channel), ''), 'email'))
  ON CONFLICT (trip_request_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;  -- NULL when this request was already reminded
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

-- ---- grants — service_role ONLY ---------------------------------------------
REVOKE ALL ON FUNCTION record_trip_request_recovery_reminder(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_trip_request_recovery_reminder(UUID, UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION delete_trip_request_recovery_reminder(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_trip_request_recovery_reminder(UUID)
  TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
