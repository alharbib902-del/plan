-- ============================================
-- AERIS — Reviews + Support app-layer wiring
-- Migration: 20260531000001
-- ============================================
-- The `reviews` and `support_tickets` tables already exist in
-- 20260422000001_initial_schema.sql with RLS enabled. This migration adds:
--   1. A `support_ticket_messages` thread table (the base table only stores the
--      opening `description`; replies need their own rows).
--   2. RLS hardening (deny-all for anon/authenticated; access via service_role
--      RPCs only — the Phase 8/9 discipline) on the new table.
--   3. SECURITY DEFINER RPCs the server actions call through the service-role
--      client:
--        - create_review            (client → completed booking they own)
--        - create_support_ticket    (client)
--        - add_support_ticket_message (client reply OR admin reply)
--        - admin_update_support_ticket (status + optional resolution)
--   4. operators.rating_avg / rating_count are refreshed by create_review so the
--      distribution layer can read an up-to-date average (read-only consumer;
--      not touched here beyond the UPDATE).

-- ============================================
-- SUPPORT TICKET MESSAGES (reply thread)
-- ============================================

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_role user_role NOT NULL,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
  ON support_ticket_messages(ticket_id, created_at);

ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: deny-all for anon/authenticated. All reads/writes
-- go through the service-role client in server code (Phase 8/9 pattern).

-- Defense in depth: revoke direct table privileges from the API roles.
REVOKE ALL ON reviews FROM anon, authenticated;
REVOKE ALL ON support_tickets FROM anon, authenticated;
REVOKE ALL ON support_ticket_messages FROM anon, authenticated;

-- ============================================
-- RPC: create_review
-- Client posts a review for a COMPLETED booking they own. Ownership, completed
-- status, and the one-review-per-booking rule are all enforced here (booking_id
-- is already UNIQUE on `reviews`, so the insert is also race-safe). Returns the
-- new review id, or NULL when any guard fails.
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

  IF EXISTS (SELECT 1 FROM reviews WHERE booking_id = p_booking_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO reviews (
    booking_id, client_id, operator_id, aircraft_id,
    overall_rating, aircraft_rating, crew_rating, service_rating, comment
  )
  VALUES (
    p_booking_id, p_client_id, v_operator_id, v_aircraft_id,
    p_overall_rating, p_aircraft_rating, p_crew_rating, p_service_rating,
    NULLIF(p_comment, '')
  )
  RETURNING id INTO v_id;

  -- Refresh the operator rating aggregates from published reviews so the
  -- distribution scorer reads a current average. Guarded: only runs when the
  -- operators table actually exposes rating_avg + rating_count, so this
  -- migration applies cleanly regardless of the operators schema revision.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'operators'
      AND column_name = 'rating_avg'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'operators'
      AND column_name = 'rating_count'
  ) THEN
    UPDATE operators o
    SET rating_avg = sub.avg_rating,
        rating_count = sub.cnt
    FROM (
      SELECT ROUND(AVG(overall_rating)::numeric, 2) AS avg_rating,
             COUNT(*) AS cnt
      FROM reviews
      WHERE operator_id = v_operator_id
        AND is_published = true
    ) AS sub
    WHERE o.id = v_operator_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================
-- RPC: create_support_ticket
-- Client opens a ticket. Seeds the thread with the opening message so the
-- conversation view is uniform. Returns the new ticket id.
-- ============================================

CREATE OR REPLACE FUNCTION create_support_ticket(
  p_user_id UUID,
  p_category support_category,
  p_subject TEXT,
  p_description TEXT,
  p_booking_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO support_tickets (user_id, category, subject, description, booking_id, status)
  VALUES (p_user_id, p_category, p_subject, p_description, p_booking_id, 'open')
  RETURNING id INTO v_id;

  INSERT INTO support_ticket_messages (ticket_id, author_role, author_id, body)
  VALUES (v_id, 'client', p_user_id, p_description);

  RETURN v_id;
END;
$$;

-- ============================================
-- RPC: add_support_ticket_message
-- Append a reply. For client authors, ownership is enforced (the ticket's
-- user_id must equal the author). Admin/support authors may post to any ticket.
-- Reopens a resolved/closed ticket back to 'in_progress' when the client replies.
-- Returns the new message id, or NULL when the ticket is missing / not owned.
-- ============================================

CREATE OR REPLACE FUNCTION add_support_ticket_message(
  p_ticket_id UUID,
  p_author_role user_role,
  p_author_id UUID,
  p_body TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_status support_status;
  v_id UUID;
BEGIN
  SELECT user_id, status INTO v_owner, v_status
  FROM support_tickets
  WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_author_role = 'client' AND v_owner <> p_author_id THEN
    RETURN NULL;
  END IF;

  INSERT INTO support_ticket_messages (ticket_id, author_role, author_id, body)
  VALUES (p_ticket_id, p_author_role, p_author_id, p_body)
  RETURNING id INTO v_id;

  IF p_author_role = 'client' AND v_status IN ('resolved', 'closed') THEN
    UPDATE support_tickets
    SET status = 'in_progress'
    WHERE id = p_ticket_id;
  ELSE
    UPDATE support_tickets
    SET updated_at = NOW()
    WHERE id = p_ticket_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ============================================
-- RPC: admin_update_support_ticket
-- Admin/support sets a new status (+ optional resolution text). Stamps
-- resolved_at when moving into a resolved/closed state.
-- ============================================

CREATE OR REPLACE FUNCTION admin_update_support_ticket(
  p_ticket_id UUID,
  p_status support_status,
  p_resolution TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE support_tickets
  SET status = p_status,
      resolution = COALESCE(NULLIF(p_resolution, ''), resolution),
      resolved_at = CASE
        WHEN p_status IN ('resolved', 'closed') AND resolved_at IS NULL THEN NOW()
        ELSE resolved_at
      END
  WHERE id = p_ticket_id;
END;
$$;

-- ============================================
-- GRANTS — server actions call these via the service-role client.
-- ============================================

GRANT EXECUTE ON FUNCTION create_review(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION create_support_ticket(UUID, support_category, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION add_support_ticket_message(UUID, user_role, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_update_support_ticket(UUID, support_status, TEXT) TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
