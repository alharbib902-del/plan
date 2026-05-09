-- ============================================================
-- Phase 7 — PR 2e (matching engine + Dutch auction cron)
--
-- Three changes in this migration:
--
--   1. NEW TABLE `empty_leg_events_outbox` — durable per-event
--      record so the synchronous match-trigger and the cron
--      drain converge to the same processed/unprocessed state
--      (Codex iteration-2 P2 #1 + iteration-6 P1 #1 fix).
--
--   2. CREATE OR REPLACE the PR 2a stub
--      `publish_empty_leg_event(p_leg_id, p_event_type)` to
--      INSERT a row into the outbox. PR 2a's stub returned
--      `{ ok: true, no_op: true }` — this PR ships the real
--      body. SECURITY DEFINER + service-role-only EXECUTE
--      grants are unchanged.
--
--   3. NEW PUBLIC RPC `expire_empty_leg_window(p_leg_id)` —
--      the 12th SECURITY DEFINER public, called by
--      `/api/cron/empty-legs/expire-windows`. Flips
--      `status = 'expired'` only when the leg is still
--      `available` AND `auction_window_end_at <= NOW()`.
--      Returns `{ ok, leg_id, no_op? }`.
--
-- All three follow the Phase 6.2 / Phase 7 PR 2a discipline:
-- IF NOT EXISTS for tables, idempotent grants, structured-
-- error contract on the RPC.
-- ============================================================


-- ============================================================
-- 1. empty_leg_events_outbox
--
-- One row per fire of `publish_empty_leg_event`. Codex
-- round-2 P1 #1 fix on PR 2e #33: the route layer claims
-- pending rows by reading `id` first, then UPDATEs
-- WHERE id IN (claimed ids) AND processed_at IS NULL —
-- so a new row landing for the same (leg, event_type)
-- during the matcher run is left for the next cron tick
-- to claim. The earlier comment promised
-- `SELECT ... FOR UPDATE SKIP LOCKED` semantics; the
-- claim-by-id pattern is the implemented equivalent
-- (Supabase JS client cannot pass FOR UPDATE through
-- PostgREST without a SECURITY DEFINER RPC). Per-leg
-- ordered branches in matching.ts dictate whether the
-- row is marked `processed_at = NOW()` or left NULL for
-- replay (Codex iteration-6 P1 #1 + iteration-7 P1 #3
-- contracts).
-- ============================================================

CREATE TABLE IF NOT EXISTS empty_leg_events_outbox (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  leg_id        UUID NOT NULL REFERENCES empty_legs(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN ('published', 'price_dropped')),
  emitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ
);

-- Drain index: pending rows ordered by emitted_at. The
-- cron's claim-by-id route scan reads from this partial
-- index (Codex round-3 P2 #2 fix on PR 2e #33: the prior
-- comment promised FOR UPDATE SKIP LOCKED semantics, but
-- the implemented pattern is "SELECT id WHERE
-- processed_at IS NULL ORDER BY emitted_at LIMIT N" then
-- "UPDATE WHERE id IN (...) AND processed_at IS NULL" —
-- the IS NULL guard is what prevents two concurrent
-- workers from double-processing, not row locks).
CREATE INDEX IF NOT EXISTS idx_empty_leg_events_outbox_pending
  ON empty_leg_events_outbox(emitted_at ASC)
  WHERE processed_at IS NULL;

-- Lookup index for per-leg replay state (used by the
-- canary-plan verification queries in Probe 15).
CREATE INDEX IF NOT EXISTS idx_empty_leg_events_outbox_leg
  ON empty_leg_events_outbox(leg_id, emitted_at DESC);

ALTER TABLE empty_leg_events_outbox
  ENABLE ROW LEVEL SECURITY;
-- No policies: service-role-only access. The cron route +
-- match-trigger route both run service-role; no anon /
-- authenticated path reads or writes the outbox.


-- ============================================================
-- 2. publish_empty_leg_event — REAL body (was a no-op stub
--    in PR 2a per Codex iteration-2 P2 #1 fix)
--
-- Called by `publish_empty_leg`, `update_empty_leg_price`,
-- `tick_empty_leg_dutch_auction` (PR 2a) — those callers
-- have not changed; only the body is replaced here.
--
-- Phase 7 closure round-1 P1 #1 fix: PR 2a's stub declared
-- `RETURNS VOID`; this PR 2e body declares `RETURNS JSON`.
-- PostgreSQL rejects return-type changes through
-- `CREATE OR REPLACE`, so we must `DROP FUNCTION IF EXISTS`
-- first. The DROP is idempotent + safe to run on a fresh
-- database (no-op if the function never existed). This
-- makes the migration replayable on any DB state — staging
-- restore, disaster recovery, or a Phase-6.2-era snapshot
-- can replay the full Phase 7 sequence in one pass.
-- ============================================================

DROP FUNCTION IF EXISTS publish_empty_leg_event(UUID, TEXT);

CREATE OR REPLACE FUNCTION publish_empty_leg_event(
  p_leg_id     UUID,
  p_event_type TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_event_type NOT IN ('published', 'price_dropped') THEN
    RETURN json_build_object('ok', false, 'error', 'event_type_invalid');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM empty_legs WHERE id = p_leg_id) THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  INSERT INTO empty_leg_events_outbox (leg_id, event_type)
    VALUES (p_leg_id, p_event_type);

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

-- Grants are inherited from PR 2a (REVOKE PUBLIC + GRANT
-- service_role) because CREATE OR REPLACE preserves the
-- existing ACL. Re-apply explicitly for traceability:
REVOKE ALL ON FUNCTION publish_empty_leg_event(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_empty_leg_event(UUID, TEXT) TO service_role;


-- ============================================================
-- 3. expire_empty_leg_window — 12th SECURITY DEFINER public
--
-- Called by `/api/cron/empty-legs/expire-windows`. Flips
-- `status = 'expired'` ONLY for legs still `available` whose
-- `auction_window_end_at <= NOW()`. Idempotent: a leg already
-- in any non-`available` state returns `{ ok: true,
-- no_op: true }` without mutating anything.
--
-- No outbox event fires on expiry — the matching engine has
-- nothing useful to do for an expired leg, and the public
-- detail page surfaces the expired copy via the
-- getPublicLegByNumber expansion shipped in PR 2d's Codex
-- round-1 P2 #1 fix.
-- ============================================================

CREATE OR REPLACE FUNCTION expire_empty_leg_window(
  p_leg_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status        empty_leg_status;
  v_window_end    TIMESTAMPTZ;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, auction_window_end_at
    INTO v_status, v_window_end
    FROM empty_legs WHERE id = p_leg_id;

  -- Idempotent no-op for any leg already past the
  -- available state. The cron claim filter scopes to
  -- `status = 'available'`, but defense in depth.
  IF v_status <> 'available' THEN
    RETURN json_build_object('ok', true, 'leg_id', p_leg_id, 'no_op', true);
  END IF;

  -- Defense in depth alongside the cron filter.
  IF v_window_end IS NULL OR v_window_end > NOW() THEN
    RETURN json_build_object('ok', true, 'leg_id', p_leg_id, 'no_op', true);
  END IF;

  UPDATE empty_legs
    SET status = 'expired'
    WHERE id = p_leg_id;

  RETURN json_build_object('ok', true, 'leg_id', p_leg_id);
END;
$$;

REVOKE ALL ON FUNCTION expire_empty_leg_window(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_empty_leg_window(UUID) TO service_role;


-- ============================================================
-- Migration complete. Total surface added:
--   - 1 new table (empty_leg_events_outbox) + 2 indexes + RLS
--   - 1 new public RPC (expire_empty_leg_window)
--   - 1 RPC body replacement (publish_empty_leg_event was a
--     PR 2a stub; now writes to the outbox)
--
-- Production rollout: run this migration BEFORE the PR 2e
-- code deploy. The synchronous match-trigger fire-and-forget
-- in adminPublishEmptyLeg / operatorPublishEmptyLeg posts
-- to the new internal route, which expects the outbox table
-- to exist. Without the migration, the publish flow would
-- still succeed (the RPC body INSERTs to the outbox; if the
-- outbox table is missing, the INSERT raises and the publish
-- itself rolls back). So the migration is gate #1 for the
-- canary plan.
-- ============================================================
