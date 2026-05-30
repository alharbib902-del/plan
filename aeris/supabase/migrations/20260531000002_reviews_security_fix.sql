-- ============================================
-- AERIS — Reviews/Support forward security fix
-- Migration: 20260531000002
-- ============================================
-- 20260531000001_reviews_support.sql was applied to production before its
-- privileges/logic were reviewed. Supabase will NOT re-run an already-applied
-- version, so this forward migration REPAIRS production (and fresh DBs alike):
--
--   1. Replaces create_review with the hardened body — ON CONFLICT (booking_id)
--      race-safety + refresh of operators.rating (the column the distribution /
--      cargo / medevac scorers actually read; the original targeted the
--      non-existent rating_avg / rating_count and never ran).
--   2. Locks create_review AND the not-yet-wired support RPCs to service_role
--      ONLY. CREATE FUNCTION grants EXECUTE to PUBLIC by default, so the original
--      left all four RPCs callable by anon / authenticated through the public
--      PostgREST RPC API — bypassing the server-action session checks.
--   3. Backfills operators.rating from existing published reviews.
--
-- The support RPC bodies are unchanged (now service_role-only + unused by app
-- code); the Support PR hardens their authorization and adds server actions.

-- ---- 1: hardened create_review ----------------------------------------------
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

  -- booking_id is UNIQUE on reviews; ON CONFLICT keeps this race-safe and yields
  -- no row (v_id NULL) on a duplicate instead of raising unique_violation.
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

  -- Refresh operators.rating from the published-review average.
  -- reviews.is_published DEFAULTs true, so the row just inserted is included.
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

-- ---- 2: lock all four RPCs to service_role only -----------------------------
REVOKE ALL ON FUNCTION create_review(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_review(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION create_support_ticket(UUID, support_category, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_support_ticket(UUID, support_category, TEXT, TEXT, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION add_support_ticket_message(UUID, user_role, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_support_ticket_message(UUID, user_role, UUID, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION admin_update_support_ticket(UUID, support_status, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_update_support_ticket(UUID, support_status, TEXT)
  TO service_role;

-- ---- 3: backfill operators.rating from existing published reviews -----------
UPDATE operators o
SET rating = sub.avg_rating
FROM (
  SELECT operator_id, ROUND(AVG(overall_rating)::numeric, 2) AS avg_rating
  FROM reviews
  WHERE is_published = true
  GROUP BY operator_id
) AS sub
WHERE o.id = sub.operator_id;

-- ============================================
-- END OF MIGRATION
-- ============================================
