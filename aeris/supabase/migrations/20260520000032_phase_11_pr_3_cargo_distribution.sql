-- =============================================================
-- Phase 11 PR 3 — cargo distribution + outbox + cron drain
-- =============================================================
--
-- Migration adds:
--   §1 cargo_dispatch_events_outbox table (Phase 7 mirror)
--   §2 publish_cargo_dispatch_event RPC (called by trigger + admin)
--   §3 cargo_requests AFTER INSERT trigger → auto-emit 'initial'
--   §4 claim_cargo_dispatch_events RPC (Round 2 PR #72 P1 #1 —
--      atomic UPDATE+RETURNING+SKIP LOCKED inside SECURITY DEFINER
--      so the supabase-js client can call via .rpc())
--   §5 cargo_requests.founder_batch_alerted_at column (Round 1
--      PR #72 P2 #4 — per-request throttle for the founder batch
--      alert; atomic conditional UPDATE inside the §4.2 helper)
--
-- Companion to docs/PHASE-11-PR-3-SPEC.md (merged in #72 at
-- 2160adc). The spec is the binding contract; this migration is
-- the implementation. Inline comments cite the spec sections
-- that govern each block.
--
-- Replay safety (Phase 9 convention):
--   - CREATE TABLE / INDEX IF NOT EXISTS
--   - CREATE OR REPLACE FUNCTION (for both RPCs + trigger fn)
--   - DROP TRIGGER IF EXISTS before CREATE TRIGGER
--   - ADD COLUMN IF NOT EXISTS for the cargo_requests delta
--   - REVOKE + GRANT idempotent across replays
-- =============================================================


-- =============================================================
-- §1 cargo_dispatch_events_outbox table (per spec §2.1)
-- =============================================================
--
-- Each row is a durable record of "this cargo_request needs to be
-- dispatched to operators." Phase 7 empty_leg_events_outbox is the
-- canonical mirror; cargo adds claim_id/claimed_at columns for the
-- claim-before-send pattern (Round 1 PR #72 P1 #2 fix) — those
-- prevent two concurrent cron workers from notifying the same
-- operators by ensuring each worker only iterates the rows it
-- successfully claimed.

CREATE TABLE IF NOT EXISTS cargo_dispatch_events_outbox (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_request_id  UUID NOT NULL
                      REFERENCES cargo_requests(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL
                      CHECK (event_type IN ('initial', 'manual_redispatch')),
  emitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Claim-before-send columns. Stamped by claim_cargo_dispatch_events
  -- (§4). The mark-processed UPDATE in the cron route guards on
  -- `claim_id = <RUN_CLAIM_ID>` so a reclaim-worker can't be
  -- clobbered.
  claim_id          UUID,
  claimed_at        TIMESTAMPTZ,
  processed_at      TIMESTAMPTZ,
  -- Per-attempt metadata. Shape (per spec §3.3):
  --   dispatched: { dispatched_operator_ids, skipped_operator_ids,
  --                 skip_reasons, founder_alerted }
  --   request-level abort: { error: 'request_not_actionable' }
  dispatch_result   JSONB,
  attempt_count     INT NOT NULL DEFAULT 0
);

-- Drain partial index: pending rows ordered by emitted_at. The
-- claim RPC's inner SELECT reads from this.
CREATE INDEX IF NOT EXISTS idx_cargo_dispatch_outbox_pending
  ON cargo_dispatch_events_outbox(emitted_at ASC)
  WHERE processed_at IS NULL;

-- Per-request replay index (used by canary metric + probe 32).
CREATE INDEX IF NOT EXISTS idx_cargo_dispatch_outbox_request
  ON cargo_dispatch_events_outbox(cargo_request_id, emitted_at DESC);

-- Service-role-only access (cron + admin actions). No policies
-- needed — RLS just blocks anon/authenticated.
ALTER TABLE cargo_dispatch_events_outbox ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- §2 publish_cargo_dispatch_event RPC (per spec §2.2)
-- =============================================================
--
-- Mirror of Phase 7 publish_empty_leg_event. Called by:
--   - the INSERT trigger (§3) on cargo_requests (event_type='initial')
--   - the manual dispatch admin Server Action
--     (event_type='manual_redispatch')

CREATE OR REPLACE FUNCTION publish_cargo_dispatch_event(
  p_cargo_request_id UUID,
  p_event_type       TEXT
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_event_type NOT IN ('initial', 'manual_redispatch') THEN
    RETURN json_build_object('ok', false, 'error', 'event_type_invalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cargo_requests WHERE id = p_cargo_request_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'cargo_request_not_found');
  END IF;

  INSERT INTO cargo_dispatch_events_outbox (cargo_request_id, event_type)
    VALUES (p_cargo_request_id, p_event_type);

  RETURN json_build_object('ok', true, 'cargo_request_id', p_cargo_request_id);
END;
$$;

REVOKE ALL ON FUNCTION publish_cargo_dispatch_event(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION publish_cargo_dispatch_event(UUID, TEXT)
  TO service_role;


-- =============================================================
-- §3 Trigger on cargo_requests INSERT (per spec §2.3)
-- =============================================================
--
-- Auto-emit 'initial' event when any cargo request is created
-- (guest §4.1 or authed §4.2 — both INSERT into the same table).
-- The cron picks up + scores eligible operators + dispatches.
-- AFTER INSERT so the request row is fully committed before the
-- outbox row appears (downstream join in distribution.ts is safe).

CREATE OR REPLACE FUNCTION cargo_requests_dispatch_trigger()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only emit for actionable statuses. Pre-cancelled or
  -- pre-expired inserts (shouldn't happen via the §4.1/§4.2
  -- RPCs but defensive against future paths) skip the outbox.
  IF NEW.status IN ('pending', 'offers_received') THEN
    PERFORM publish_cargo_dispatch_event(NEW.id, 'initial');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cargo_requests_dispatch_trigger ON cargo_requests;
CREATE TRIGGER cargo_requests_dispatch_trigger
  AFTER INSERT ON cargo_requests
  FOR EACH ROW EXECUTE FUNCTION cargo_requests_dispatch_trigger();


-- =============================================================
-- §4 claim_cargo_dispatch_events RPC (per spec §2.5, Round 2 P1 #1)
-- =============================================================
--
-- Atomic UPDATE+RETURNING+SKIP LOCKED claim. supabase-js .update()
-- builder cannot express this pattern, so the cron route invokes
-- this RPC via .rpc(). The atomic semantics live IN THE DB layer
-- where they belong; the route just iterates the returned rows.
--
-- Why this is safe under concurrent cron runs:
--   - FOR UPDATE SKIP LOCKED in the inner SELECT makes worker B
--     see a disjoint set from worker A (PG guarantees row-level
--     locks aren't visible to skip-locked readers).
--   - claim_id stamped at claim time + checked at mark-processed
--     time so a reclaim-worker can't clobber the row.
--   - 5-minute lease recovery: a crashed worker's claim becomes
--     reclaimable so rows don't stick forever.
--
-- Round 3 PR #72 P1 #1 — subquery alias is `pending_row`, NOT
-- `inner` (INNER is a SQL keyword in the JOIN grammar; using it
-- as a table alias risks a parse error on some PG versions).

CREATE OR REPLACE FUNCTION claim_cargo_dispatch_events(
  p_claim_id UUID,
  p_limit    INT
) RETURNS TABLE (
  id                UUID,
  cargo_request_id  UUID,
  event_type        TEXT
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- Defensive: cap p_limit so a buggy caller can't drain the
  -- whole outbox into a single serverless invocation that then
  -- times out mid-loop and leaks claims.
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 20;
  ELSIF p_limit > 100 THEN
    p_limit := 100;
  END IF;

  RETURN QUERY
    UPDATE cargo_dispatch_events_outbox AS o
       SET claim_id      = p_claim_id,
           claimed_at    = NOW(),
           attempt_count = o.attempt_count + 1
     WHERE o.id IN (
       SELECT pending_row.id
         FROM cargo_dispatch_events_outbox AS pending_row
        WHERE pending_row.processed_at IS NULL
          AND (pending_row.claimed_at IS NULL
               OR pending_row.claimed_at < NOW() - INTERVAL '5 minutes')
        ORDER BY pending_row.emitted_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
     )
     RETURNING o.id, o.cargo_request_id, o.event_type;
END;
$$;

REVOKE ALL ON FUNCTION claim_cargo_dispatch_events(UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_cargo_dispatch_events(UUID, INT)
  TO service_role;


-- =============================================================
-- §5 cargo_operator_last_dispatch_map RPC
--    (Round 1 PR #73 P1 #1 fix)
-- =============================================================
--
-- Per-operator last_dispatched_at lookup for the distribution
-- recency check. Without this, the spec §3.1 recency_score would
-- always be 1.0 (every operator looks first-time forever) and
-- the `recently_dispatched` short-circuit would never fire — same
-- operators would receive every cargo request unbounded.
--
-- Implementation: scan processed outbox rows, expand the
-- dispatched_operator_ids JSONB array via jsonb_array_elements_text,
-- and aggregate the MAX(processed_at) per operator. Filtered to
-- the operator_ids the caller cares about so the JSONB unnest only
-- touches relevant rows.
--
-- Returns rows ONLY for operators that have at least one prior
-- dispatch; the caller treats missing keys as NULL → first-time
-- boost (recency_score=1.0).

CREATE OR REPLACE FUNCTION cargo_operator_last_dispatch_map(
  p_operator_ids UUID[]
) RETURNS TABLE (
  operator_id        UUID,
  last_dispatched_at TIMESTAMPTZ
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT
      expanded.operator_id::UUID AS operator_id,
      MAX(expanded.processed_at) AS last_dispatched_at
    FROM (
      SELECT
        jsonb_array_elements_text(
          o.dispatch_result -> 'dispatched_operator_ids'
        ) AS operator_id,
        o.processed_at
      FROM cargo_dispatch_events_outbox AS o
      WHERE o.processed_at IS NOT NULL
        AND o.dispatch_result -> 'dispatched_operator_ids' IS NOT NULL
        AND jsonb_typeof(
              o.dispatch_result -> 'dispatched_operator_ids'
            ) = 'array'
    ) AS expanded
    WHERE expanded.operator_id::UUID = ANY(p_operator_ids)
    GROUP BY expanded.operator_id;
END;
$$;

REVOKE ALL ON FUNCTION cargo_operator_last_dispatch_map(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cargo_operator_last_dispatch_map(UUID[])
  TO service_role;


-- =============================================================
-- §6 cargo_requests.founder_batch_alerted_at column
--    (per spec §2.6, Round 1 P2 #4)
-- =============================================================
--
-- Per-request throttle flag for sendFounderCargoBatchAlert (§4.2
-- in spec). The helper uses an atomic conditional UPDATE
-- (.is('founder_batch_alerted_at', null)) that returns the row
-- iff the helper wins the claim. Multiple concurrent workers +
-- manual redispatches are all naturally throttled per-request.
--
-- No CHECK constraint needed — column is purely informational +
-- serves as the throttle predicate. Replay-safe via IF NOT EXISTS.

ALTER TABLE cargo_requests
  ADD COLUMN IF NOT EXISTS founder_batch_alerted_at TIMESTAMPTZ;


-- =============================================================
-- End of Phase 11 PR 3 migration
-- =============================================================
