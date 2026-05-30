-- ============================================
-- AERIS — Support app-layer: re-point identity to clients + harden RPCs
-- Migration: 20260531000003  (forward-only — does NOT rewrite applied versions)
-- ============================================
-- The Support tables were created in initial_schema against the legacy unified
-- `users` table, which is now EMPTY — the app uses separate clients / operators
-- / admin_accounts. So `create_support_ticket(user_id := clients.id)` violated
-- the support_tickets.user_id -> users(id) FK and could never insert a row
-- (support_tickets / support_ticket_messages are both empty).
--
-- Model adopted: tickets are opened by CLIENTS and managed by ADMIN. (Operators
-- are intentionally out of scope — a separate PR if ever needed.)
--
-- This migration (tables are empty, so a pure structural re-point):
--   1. Re-points support_tickets.user_id -> client_id (FK -> clients).
--   2. Drops the legacy users FK on support_tickets.assigned_to (nullable uuid;
--      admin-assignment UI is a later PR) and on support_ticket_messages.author_id
--      (kept as a nullable uuid + author_role discriminator: client -> clients.id,
--      support/admin -> admin id or NULL).
--   3. Re-points/hardens the Support RPCs to the client_id model, enforces
--      booking ownership, whitelists author roles, and locks every RPC to
--      service_role only (REVOKE FROM PUBLIC/anon/authenticated).

-- ---- 1 + 2: drop legacy users FKs (by introspection — name-agnostic) --------
DO $$
DECLARE v_con text;
BEGIN
  FOR v_con IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND (
        (con.conrelid = 'public.support_tickets'::regclass AND a.attname IN ('user_id', 'assigned_to'))
        OR (con.conrelid = 'public.support_ticket_messages'::regclass AND a.attname = 'author_id')
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',
      (SELECT conrelid::regclass FROM pg_constraint WHERE conname = v_con LIMIT 1), v_con);
  END LOOP;
END $$;

-- rename user_id -> client_id (guarded so the migration is re-run safe)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE support_tickets RENAME COLUMN user_id TO client_id;
  END IF;
END $$;

-- re-point client_id -> clients(id) (guarded)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.support_tickets'::regclass AND conname = 'support_tickets_client_id_fkey'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---- 3a: create_support_ticket (client_id model + booking ownership) --------
-- DROP+CREATE because the first parameter is renamed (p_user_id -> p_client_id);
-- CREATE OR REPLACE cannot rename an existing input parameter.
DROP FUNCTION IF EXISTS create_support_ticket(UUID, support_category, TEXT, TEXT, UUID);
CREATE FUNCTION create_support_ticket(
  p_client_id UUID,
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
  -- If a booking is referenced, it must belong to this client.
  IF p_booking_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM bookings WHERE id = p_booking_id AND client_id = p_client_id
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO support_tickets (client_id, category, subject, description, booking_id, status)
  VALUES (p_client_id, p_category, p_subject, p_description, p_booking_id, 'open')
  RETURNING id INTO v_id;

  INSERT INTO support_ticket_messages (ticket_id, author_role, author_id, body)
  VALUES (v_id, 'client', p_client_id, p_description);

  RETURN v_id;
END;
$$;

-- ---- 3b: add_support_ticket_message (ownership by client_id + role guard) ----
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
  v_client UUID;
  v_status support_status;
  v_id UUID;
BEGIN
  -- Only client (own ticket) / support / admin may author. Reject operator etc.
  IF p_author_role NOT IN ('client', 'support', 'admin') THEN
    RETURN NULL;
  END IF;

  SELECT client_id, status INTO v_client, v_status
  FROM support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Clients may only post to their own ticket.
  IF p_author_role = 'client' AND v_client <> p_author_id THEN
    RETURN NULL;
  END IF;

  INSERT INTO support_ticket_messages (ticket_id, author_role, author_id, body)
  VALUES (p_ticket_id, p_author_role, p_author_id, p_body)
  RETURNING id INTO v_id;

  -- A client reply reopens a resolved/closed ticket; otherwise just touch it.
  IF p_author_role = 'client' AND v_status IN ('resolved', 'closed') THEN
    UPDATE support_tickets SET status = 'in_progress' WHERE id = p_ticket_id;
  ELSE
    UPDATE support_tickets SET updated_at = NOW() WHERE id = p_ticket_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ---- 4: lock the re-created / replaced RPCs to service_role only -------------
-- (admin_update_support_ticket was already locked in 20260531000002.)
REVOKE ALL ON FUNCTION create_support_ticket(UUID, support_category, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_support_ticket(UUID, support_category, TEXT, TEXT, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION add_support_ticket_message(UUID, user_role, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_support_ticket_message(UUID, user_role, UUID, TEXT)
  TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
