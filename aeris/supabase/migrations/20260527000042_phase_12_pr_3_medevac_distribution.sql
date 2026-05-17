-- =============================================================
-- Phase 12 PR 3 — medevac distribution + outbox + cron drain
-- =============================================================
--
-- Migration adds:
--   §1 medevac_dispatch_events_outbox table (Phase 7 / Phase 11
--      cargo mirror — claim_id + processed_at + dispatch_result)
--   §2 publish_medevac_dispatch_event RPC (called by trigger +
--      admin manual dispatch)
--   §3 medevac_requests AFTER INSERT trigger → auto-emit
--      'initial' for is_covered=false rows ONLY (covered J5
--      rows self-book via §4.7 and skip the outbox entirely)
--   §4 claim_medevac_dispatch_events RPC (atomic UPDATE +
--      RETURNING + FOR UPDATE SKIP LOCKED + 5-min lease)
--   §5 medevac_operator_last_dispatch_map RPC (per-operator
--      last_dispatched_at lookup for distribution recency)
--   §6 medevac_requests.founder_batch_alerted_at column
--      (per-request throttle for the founder batch alert)
--
-- Spec: aeris/docs/PHASE-12-MEDEVAC-SPEC.md
-- (PR #75 merged at 082d90a, 16 Codex review rounds).
-- PR 1 (#76 merged at d5abe81) + PR 2 (#77 merged at a4fc076)
-- shipped tables + 11 RPCs. PR 3 wires distribution + cron.
--
-- All RPCs mirror Phase 11 cargo PR 3 patterns exactly with
-- `cargo_` → `medevac_` rename, EXCEPT the AFTER INSERT trigger
-- which filters out is_covered=true rows (Shield events
-- self-book per §4.7 and do NOT enter the outbox dispatch loop).
--
-- Replay safety (Phase 9 convention):
--   - CREATE TABLE / INDEX IF NOT EXISTS
--   - CREATE OR REPLACE FUNCTION (RPCs + trigger fn)
--   - DROP TRIGGER IF EXISTS before CREATE TRIGGER
--   - ADD COLUMN IF NOT EXISTS for the medevac_requests delta
--   - REVOKE + GRANT idempotent across replays
-- =============================================================


-- =============================================================
-- §1 medevac_dispatch_events_outbox table (per spec §3.10)
-- =============================================================
--
-- Each row is a durable record of "this medevac_request needs
-- to be dispatched to operators." Same shape as cargo PR 3 §1
-- (Phase 7 outbox + claim_id columns) so the cron-side claim
-- logic is byte-identical.

CREATE TABLE IF NOT EXISTS medevac_dispatch_events_outbox (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  medevac_request_id UUID NOT NULL
                       REFERENCES medevac_requests(id) ON DELETE CASCADE,
  event_type         TEXT NOT NULL
                       CHECK (event_type IN ('initial', 'manual_redispatch')),
  emitted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Claim-before-send columns. Stamped by
  -- claim_medevac_dispatch_events (§4). The mark-processed
  -- UPDATE in the cron route guards on `claim_id = <RUN_CLAIM_ID>`
  -- so a reclaim-worker can't be clobbered.
  claim_id           UUID,
  claimed_at         TIMESTAMPTZ,
  processed_at       TIMESTAMPTZ,
  -- Per-attempt metadata. Same shape as cargo PR 3:
  --   dispatched: { dispatched_operator_ids, skipped_operator_ids,
  --                 skip_reasons, founder_alerted, whatsapp_links }
  --   request-level abort: { error: 'request_not_actionable' }
  dispatch_result    JSONB,
  attempt_count      INT NOT NULL DEFAULT 0
);

-- Drain partial index: pending rows ordered by emitted_at. The
-- claim RPC's inner SELECT reads from this.
CREATE INDEX IF NOT EXISTS idx_medevac_dispatch_outbox_pending
  ON medevac_dispatch_events_outbox(emitted_at ASC)
  WHERE processed_at IS NULL;

-- Per-request replay index.
CREATE INDEX IF NOT EXISTS idx_medevac_dispatch_outbox_request
  ON medevac_dispatch_events_outbox(medevac_request_id, emitted_at DESC);

ALTER TABLE medevac_dispatch_events_outbox ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- §2 publish_medevac_dispatch_event RPC (per spec §3.10)
-- =============================================================
--
-- Mirror of Phase 11 publish_cargo_dispatch_event. Called by:
--   - the INSERT trigger (§3) on medevac_requests for
--     is_covered=false rows (event_type='initial')
--   - the admin manual dispatch Server Action
--     (event_type='manual_redispatch')

CREATE OR REPLACE FUNCTION publish_medevac_dispatch_event(
  p_medevac_request_id UUID,
  p_event_type         TEXT
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
    SELECT 1 FROM medevac_requests WHERE id = p_medevac_request_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'medevac_request_not_found');
  END IF;

  INSERT INTO medevac_dispatch_events_outbox (medevac_request_id, event_type)
    VALUES (p_medevac_request_id, p_event_type);

  RETURN json_build_object(
    'ok', true,
    'medevac_request_id', p_medevac_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION publish_medevac_dispatch_event(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION publish_medevac_dispatch_event(UUID, TEXT)
  TO service_role;


-- =============================================================
-- §3 Trigger on medevac_requests INSERT (per spec §3.10 item 5)
-- =============================================================
--
-- Auto-emit 'initial' event when a NON-COVERED medevac request
-- is created (guest §4.1 or authed §4.2 — both INSERT into the
-- same table). Covered J5 rows (is_covered=true / status='covered')
-- SKIP the outbox entirely — they self-book via §4.7
-- consume_aeris_shield_event and already carry their dispatched
-- operator via the booking row. Sending them through the
-- distribution loop would double-notify operators.
--
-- AFTER INSERT so the request row is fully committed before
-- the outbox row appears (downstream join in distribution.ts
-- is safe).

CREATE OR REPLACE FUNCTION medevac_requests_dispatch_trigger()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- Skip covered Shield events (they're already booked via §4.7).
  IF NEW.is_covered = true OR NEW.status = 'covered' THEN
    RETURN NEW;
  END IF;
  -- Only emit for actionable statuses (defense against future
  -- callers that might insert with pre-set status).
  IF NEW.status IN ('pending', 'offers_received') THEN
    PERFORM publish_medevac_dispatch_event(NEW.id, 'initial');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medevac_requests_dispatch_trigger
  ON medevac_requests;
CREATE TRIGGER medevac_requests_dispatch_trigger
  AFTER INSERT ON medevac_requests
  FOR EACH ROW EXECUTE FUNCTION medevac_requests_dispatch_trigger();


-- =============================================================
-- §4 claim_medevac_dispatch_events RPC (Phase 11 PR 3 pattern)
-- =============================================================
--
-- Atomic UPDATE+RETURNING+SKIP LOCKED claim. supabase-js
-- .update() builder cannot express this pattern, so the cron
-- route invokes via .rpc(). FOR UPDATE SKIP LOCKED guarantees
-- two concurrent workers see disjoint sets; 5-minute lease
-- recovery prevents leaked claims from a crashed worker.

CREATE OR REPLACE FUNCTION claim_medevac_dispatch_events(
  p_claim_id UUID,
  p_limit    INT
) RETURNS TABLE (
  id                 UUID,
  medevac_request_id UUID,
  event_type         TEXT
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 20;
  ELSIF p_limit > 100 THEN
    p_limit := 100;
  END IF;

  RETURN QUERY
    UPDATE medevac_dispatch_events_outbox AS o
       SET claim_id      = p_claim_id,
           claimed_at    = NOW(),
           attempt_count = o.attempt_count + 1
     WHERE o.id IN (
       SELECT pending_row.id
         FROM medevac_dispatch_events_outbox AS pending_row
        WHERE pending_row.processed_at IS NULL
          AND (pending_row.claimed_at IS NULL
               OR pending_row.claimed_at < NOW() - INTERVAL '5 minutes')
        ORDER BY pending_row.emitted_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
     )
     RETURNING o.id, o.medevac_request_id, o.event_type;
END;
$$;

REVOKE ALL ON FUNCTION claim_medevac_dispatch_events(UUID, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_medevac_dispatch_events(UUID, INT)
  TO service_role;


-- =============================================================
-- §5 medevac_operator_last_dispatch_map RPC (recency lookup)
-- =============================================================
--
-- Per-operator last_dispatched_at for distribution recency
-- scoring. Same TEXT-match-before-UUID-cast resilience pattern
-- as Phase 11 cargo PR 3 §5 (Round 2 PR #73 P1 #1 fix) so a
-- malformed historical operator_id in dispatch_result JSONB
-- can't loop the drain.

CREATE OR REPLACE FUNCTION medevac_operator_last_dispatch_map(
  p_operator_ids UUID[]
) RETURNS TABLE (
  operator_id        UUID,
  last_dispatched_at TIMESTAMPTZ
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_text_ids TEXT[];
BEGIN
  v_text_ids := ARRAY(SELECT id::TEXT FROM unnest(p_operator_ids) AS id);

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
      FROM medevac_dispatch_events_outbox AS o
      WHERE o.processed_at IS NOT NULL
        AND o.dispatch_result -> 'dispatched_operator_ids' IS NOT NULL
        AND jsonb_typeof(
              o.dispatch_result -> 'dispatched_operator_ids'
            ) = 'array'
    ) AS expanded
    WHERE expanded.operator_id = ANY(v_text_ids)
    GROUP BY expanded.operator_id;
END;
$$;

REVOKE ALL ON FUNCTION medevac_operator_last_dispatch_map(UUID[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION medevac_operator_last_dispatch_map(UUID[])
  TO service_role;


-- =============================================================
-- §6 medevac_requests.founder_batch_alerted_at column
-- =============================================================
--
-- Per-request throttle flag for sendFounderMedevacBatchAlert
-- (lib/medevac/notifications.ts). The helper uses an atomic
-- conditional UPDATE (.is('founder_batch_alerted_at', null))
-- that returns the row iff the helper wins the claim. Multiple
-- concurrent workers + manual redispatches are throttled
-- per-request.
--
-- Note: sla_escalated_at column already exists on
-- medevac_requests (PR 1 §3.1 line 341) and is the per-request
-- throttle for the founder SLA escalation alert (different
-- concern than the dispatch batch). PR 1 inventory item #25
-- documents this; the cron-side sla-escalation drain uses it
-- with the same atomic conditional UPDATE pattern.

ALTER TABLE medevac_requests
  ADD COLUMN IF NOT EXISTS founder_batch_alerted_at TIMESTAMPTZ;


-- =============================================================
-- End of Phase 12 PR 3 migration
-- =============================================================
