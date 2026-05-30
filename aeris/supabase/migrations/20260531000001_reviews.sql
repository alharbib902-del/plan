-- ============================================
-- AERIS — Reviews app-layer wiring
-- Migration: 20260531000001
-- ============================================
-- The `reviews` table already exists in 20260422000001_initial_schema.sql with
-- RLS enabled (is_published DEFAULT true, booking_id UNIQUE). This migration adds:
--   1. Defense-in-depth REVOKE on `reviews` for the API roles — all access goes
--      through the service-role client in server code (Phase 8/9 discipline).
--   2. create_review: SECURITY DEFINER RPC the client server action calls.
--      Ownership, completed-flight, and one-review-per-booking are all enforced
--      here. Locked to service_role ONLY (revoked from PUBLIC/anon/authenticated)
--      so it cannot bypass the app-layer session checks via the public RPC API.
--   3. Refreshes operators.rating (the column the distribution scorer reads) from
--      the published-review average for the operator.
--
-- Support (support_ticket_messages + support RPCs) ships in its own migration
-- alongside the Support app-layer PR, where each RPC is paired with an
-- authorization boundary and a server action.

-- Defense in depth: the API roles never touch reviews directly.
REVOKE ALL ON reviews FROM anon, authenticated;

-- ============================================
-- RPC: create_review
-- Client posts a review for a COMPLETED booking they own. Ownership, completed
-- status, and the one-review-per-booking rule are all enforced here. Returns the
-- new review id, or NULL when any guard fails / the booking was already reviewed.
-- ============================================

CREATE OR REPLACE FUNCTION create_review(
  p_booking_id UUID,
  p_client_id UUID,
  p_overall_rating INTEGER,
  p_aircraft_rating INTEGER,
  p_crew_rating INTEGER,
  p_service_rating INTEGER,
  p_comment TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator_id UUID;
  v_aircraft_id UUID;
  v_flight_status booking_flight_status;
  v_id UUID;
BEGIN
  IF p_overall_rating IS NULL OR p_overall_rating < 1 OR p_overall_rating > 5 THEN
    RETURN NULL;
  END IF;

  SELECT operator_id, aircraft_id, flight_status
    INTO v_operator_id, v_aircraft_id, v_flight_status
  FROM bookings
  WHERE id = p_booking_id
    AND client_id = p_client_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_flight_status <> 'completed' THEN
    RETURN NULL;
  END IF;

  -- booking_id is UNIQUE on reviews. ON CONFLICT keeps this race-safe and yields
  -- no row (v_id stays NULL) on a duplicate, instead of raising unique_violation.
  INSERT INTO reviews (
    booking_id, client_id, operator_id, aircraft_id,
    overall_rating, aircraft_rating, crew_rating, service_rating, comment
  )
  VALUES (
    p_booking_id, p_client_id, v_operator_id, v_aircraft_id,
    p_overall_rating, p_aircraft_rating, p_crew_rating, p_service_rating,
    NULLIF(p_comment, '')
  )
  ON CONFLICT (booking_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Refresh operators.rating (the column the distribution/cargo/medevac scorers
  -- read) from the published-review average. reviews.is_published DEFAULTs true,
  -- so the row just inserted is included.
  UPDATE operators o
  SET rating = sub.avg_rating
  FROM (
    SELECT ROUND(AVG(overall_rating)::numeric, 2) AS avg_rating
    FROM reviews
    WHERE operator_id = v_operator_id
      AND is_published = true
  ) AS sub
  WHERE o.id = v_operator_id;

  RETURN v_id;
END;
$$;

-- ============================================
-- GRANTS — service-role ONLY.
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default; revoke it so anon /
-- authenticated cannot call this SECURITY DEFINER RPC through the public API and
-- bypass the server-action session checks.
-- ============================================

REVOKE ALL ON FUNCTION create_review(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_review(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, TEXT)
  TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
