-- ============================================================
-- Phase 9 PR 4 — Auto-distribution engine
--
-- Wires the existing Phase 5 multi-operator dispatch round
-- into an automatic trigger off PR 2's
-- create_authenticated_trip_request RPC (gated by
-- ENABLE_TRIP_AUTO_DISTRIBUTION env in the Server Action).
--
-- Scope of this migration:
--   §1   trip_dispatch_rounds.closed_reason CHECK extension
--        (Phase 9 spec §3.8 — Codex round 5 P2 #1 + round 6
--        P1 #2 fix: pin the allowed list + 'stale_timeout')
--   §2   trip_distribution_log table (§3.8 — Codex round 3
--        P1 #2: target-scoped uniqueness)
--   §3   operator_cron_tick_history CHECK extension
--        (§3.9 PR 4 boundary — adds 4th job
--        'redispatch_stale_trip_requests')
--   §4   score_operators_for_trip RPC (§4.3 — eligibility
--        filter per Codex round 3 P1 #1)
--   §5   auto_dispatch_trip_request RPC (§4.3 — phone
--        dedupe per Codex round 4 P2 #2 + insufficient_
--        unique_operators contract per Codex round 6 P2 #1)
--   §6   redispatch_stale_trip_requests RPC (§4.4 + state-
--        cleanup contract per Codex round 3 P2 #2)
--   §7   REVOKE/GRANT discipline (Phase 8 PR #53 lesson)
--
-- Lessons applied (carry-forward from earlier PR rounds):
--   #1  NO Functions map entries for the new RPCs.
--   #3  REVOKE/GRANT explicit after every CREATE OR REPLACE.
--   #6  Opaque error contracts; no information leak.
--   #8  Mirror existing patterns (open_phase5_dispatch_round
--       reused for the actual round + targets INSERTs).
--   #9  Field-shape validation per parameter.
-- ============================================================


-- ============================================================
-- §1 — trip_dispatch_rounds.closed_reason CHECK extension
-- ============================================================
--
-- Phase 5 stored closed_reason as unbounded text; PR 4 needs
-- 'stale_timeout' AND we want a CHECK so future drift is
-- caught at the schema layer. Audit existing rows first
-- (Codex spec round 6 P1 #2 — the audit allowlist MUST
-- include 'stale_timeout' so a replay AFTER the new RPC
-- has written its first row does not fail).

DO $$
DECLARE
  v_offending_count INT;
BEGIN
  SELECT COUNT(*) INTO v_offending_count
    FROM trip_dispatch_rounds
   WHERE closed_reason IS NOT NULL
     AND closed_reason NOT IN (
       'offer_accepted',
       'redispatched',
       'admin_cancel',
       'stale_timeout'
     );
  IF v_offending_count > 0 THEN
    RAISE EXCEPTION 'PR 4 migration: trip_dispatch_rounds has % rows with unexpected closed_reason values; manual cleanup required before CHECK can be added',
      v_offending_count;
  END IF;
END $$;

ALTER TABLE trip_dispatch_rounds
  DROP CONSTRAINT IF EXISTS trip_dispatch_rounds_closed_reason_check;

ALTER TABLE trip_dispatch_rounds
  ADD CONSTRAINT trip_dispatch_rounds_closed_reason_check
  CHECK (
    closed_reason IS NULL
    OR closed_reason IN (
      'offer_accepted',
      'redispatched',
      'admin_cancel',
      'stale_timeout'
    )
  );


-- ============================================================
-- §2 — trip_distribution_log
-- ============================================================
--
-- One row per (trip × round × operator) triple. Round-scoped
-- uniqueness on dispatch_target_id (Codex spec round 3 P1 #2):
-- a stale-timeout redispatch may legitimately choose the same
-- top-ranked operator in a fresh round, AND
-- adminForceAutoDispatch re-fires the dispatcher; both would
-- have hit the cross-round (trip_request_id, operator_id)
-- uniqueness violation if we used that key instead.

CREATE TABLE IF NOT EXISTS trip_distribution_log (
  id                   BIGSERIAL PRIMARY KEY,
  trip_request_id      UUID NOT NULL
                         REFERENCES trip_requests(id) ON DELETE CASCADE,
  operator_id          UUID NOT NULL
                         REFERENCES operators(id) ON DELETE CASCADE,
  dispatched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score                DECIMAL(5,2) NOT NULL,
  rank                 INT NOT NULL,
  dispatch_target_id   UUID NOT NULL
                         REFERENCES trip_dispatch_targets(id) ON DELETE CASCADE,
  notification_channel TEXT NOT NULL DEFAULT 'whatsapp_link'
    CHECK (notification_channel IN ('whatsapp_link', 'email', 'sms')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dispatch_target_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_distribution_log_trip
  ON trip_distribution_log (trip_request_id, dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_distribution_log_op
  ON trip_distribution_log (operator_id, dispatched_at DESC);

ALTER TABLE trip_distribution_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE trip_distribution_log IS
  'Phase 9 PR 4: observability for auto_dispatch_trip_request. One row per (trip, round, operator) triple. service_role only.';


-- ============================================================
-- §3 — operator_cron_tick_history CHECK extension
-- ============================================================
--
-- PR 1 §3.9 already added the 3 client-cleanup names. PR 4
-- adds the 4th: redispatch_stale_trip_requests.

ALTER TABLE operator_cron_tick_history
  DROP CONSTRAINT IF EXISTS operator_cron_tick_history_job_name_check;

ALTER TABLE operator_cron_tick_history
  ADD CONSTRAINT operator_cron_tick_history_job_name_check
  CHECK (job_name IN (
    -- Phase 8 PR 2e jobs (existing on production)
    'cleanup_expired_otp_tokens',
    'cleanup_expired_password_reset_tokens',
    'cleanup_expired_operator_sessions',
    'cleanup_old_operator_signup_attempts',
    -- Phase 9 PR 1 (already on production after PR 1 activation)
    'cleanup_expired_client_sessions',
    'cleanup_expired_client_password_reset_tokens',
    'cleanup_old_client_signup_attempts',
    -- Phase 9 PR 4 (this migration)
    'redispatch_stale_trip_requests'
  ));


-- ============================================================
-- §4 — score_operators_for_trip
-- ============================================================
--
-- Pure read. Returns top-5 (or fewer) eligible operators
-- ordered by computed score desc.
--
-- Eligibility filter (Codex round 3 P1 #1 fix on spec):
--   signup_status = 'approved'
--   AND contact_phone IS NOT NULL
--   AND TRIM(contact_phone) <> ''
-- Anything else (pending / suspended / rejected; missing or
-- blank phone) is excluded so auto-dispatch never routes to
-- an unverified operator OR generates a malformed wa.me URL.
--
-- Score formula (CLAUDE.md "Trip Distribution Engine" weights:
-- rating 40 / response time 30 / price 20 / location 10):
--   rating_score   = COALESCE(rating, 0) * 20.0          -- 0..100  (rating 0..5 → 0..100)
--   response_score = GREATEST(0, 100 - COALESCE(response_time_avg, 60))  -- 0..100 (cap at 60 min)
--   price_score    = GREATEST(0, 100 - (COALESCE(commission_rate, 8) * 10))  -- 0..100 (commission % → inverse score; 0% → 100, 10% → 0)
--   location_score = CASE WHEN base_airport = p_departure_iata THEN 100 ELSE 0 END
--   score          = rating_score * 0.40
--                  + response_score * 0.30
--                  + price_score * 0.20
--                  + location_score * 0.10
--
-- "price" is interpreted as commission_rate proxy: lower
-- commission → cheaper for the buyer side via the
-- marketplace. The actual aircraft price isn't known until
-- the operator submits an offer, so commission_rate is the
-- closest pre-offer proxy in the operators schema today.
--
-- Contract:
--   IN  p_trip_request_id  UUID
--   OUT JSON:
--       { ok: true, count, operators: [
--           { operator_id, contact_phone, score, rank }, …
--         ] }                                           on success
--       { ok: false, error: 'trip_not_found' }          missing trip
--       { ok: false, error: 'no_eligible_operators' }   filter empty

CREATE OR REPLACE FUNCTION score_operators_for_trip(
  p_trip_request_id UUID
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_departure_iata TEXT;
  v_payload        JSON;
  v_count          INT;
BEGIN
  -- Step 1: read the trip's departure airport for the
  -- location_score branch. Trip lookup also doubles as the
  -- "trip exists" check.
  SELECT departure_airport
    INTO v_departure_iata
    FROM trip_requests
   WHERE id = p_trip_request_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_found');
  END IF;

  -- Step 2: score + rank + filter top-5. Ties on score are
  -- broken deterministically by operator_id (asc) so a
  -- replay returns the same ordering — matters for
  -- redispatch determinism + probe assertions.
  WITH scored AS (
    SELECT
      o.id                          AS operator_id,
      TRIM(o.contact_phone)         AS contact_phone,
      ROUND(
        (COALESCE(o.rating, 0)::NUMERIC * 20.0) * 0.40
        + GREATEST(0, 100 - COALESCE(o.response_time_avg, 60)) * 0.30
        + GREATEST(0, 100 - (COALESCE(o.commission_rate, 8)::NUMERIC * 10.0)) * 0.20
        + (CASE WHEN o.base_airport = v_departure_iata THEN 100 ELSE 0 END) * 0.10
      , 2) AS score
    FROM operators o
    WHERE o.signup_status = 'approved'
      AND o.contact_phone IS NOT NULL
      AND TRIM(o.contact_phone) <> ''
  ),
  ranked AS (
    SELECT
      operator_id, contact_phone, score,
      ROW_NUMBER() OVER (ORDER BY score DESC, operator_id ASC) AS rank
    FROM scored
  )
  SELECT
    COUNT(*),
    COALESCE(json_agg(
      json_build_object(
        'operator_id', operator_id,
        'contact_phone', contact_phone,
        'score', score,
        'rank', rank
      )
      ORDER BY rank
    ), '[]'::json)
    INTO v_count, v_payload
    FROM ranked
   WHERE rank <= 5;

  IF v_count = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'no_eligible_operators');
  END IF;

  RETURN json_build_object(
    'ok', true,
    'count', v_count,
    'operators', v_payload
  );
END;
$$;


-- ============================================================
-- §5 — auto_dispatch_trip_request
-- ============================================================
--
-- Orchestrates: scoring → phone dedupe → fanout floor check
-- → builds Phase 5 targets payload → calls the existing
-- open_phase5_dispatch_round RPC → INSERTs trip_distribution_log
-- rows. Returns the dispatched count + round id + per-target
-- summary so the calling endpoint can log structured.
--
-- Phone dedupe (Codex spec round 4 P2 #2 fix): two operators
-- sharing the same contact_phone would cause the SECOND target
-- INSERT to fail Phase 5's UNIQUE (dispatch_round_id,
-- target_phone) constraint, aborting the whole transaction.
-- We dedupe by normalised phone BEFORE building the payload:
-- group → keep the highest-ranked (lowest rank) → re-rank
-- 1..N so trip_distribution_log.rank stays contiguous.
--
-- Fanout floor (Codex spec round 6 P2 #1 fix): if dedupe
-- collapses below PHASE_9_MIN_DISPATCH_FANOUT (default 2),
-- return insufficient_unique_operators with dispatched_count:0
-- and DO NOT open a round. The trip stays 'pending' for admin
-- review. NO parallel audit table — the structured RPC return
-- + a console.error in the calling endpoint are the only
-- signals (admin canary picks up zero-log-rows trips via the
-- same observable as auto-dispatch being disabled).
--
-- Token contract: each target row needs id + nonce +
-- target_phone + sent_at + expires_at. The nonce is a 32-char
-- hex string from `encode(gen_random_bytes(16), 'hex')` — same
-- contract Phase 5 admin dispatch uses, so wa.me URLs accept
-- the existing /operator/offer/[token] handler with no code
-- change (Codex spec round 1 P1 #4).
--
-- Contract:
--   IN  p_trip_request_id  UUID
--   OUT JSON:
--       { ok: true, dispatched_count, round_id,
--         targets: [ { operator_id, target_id, target_phone, score, rank } ] }
--       { ok: false, error: 'trip_not_found' }
--       { ok: false, error: 'no_eligible_operators' }
--       { ok: false, error: 'insufficient_unique_operators',
--         dispatched_count: 0, unique_phone_count }
--       { ok: false, error: 'open_round_failed', detail }
--   IN env: PHASE_9_MIN_DISPATCH_FANOUT (configured at the
--           Server Action layer; this RPC accepts the floor
--           via the optional p_min_fanout argument so the
--           SQL is testable with a deterministic value).

CREATE OR REPLACE FUNCTION auto_dispatch_trip_request(
  p_trip_request_id UUID,
  p_min_fanout      INT DEFAULT 2
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_now             TIMESTAMPTZ := NOW();
  v_score_result    JSON;
  v_score_ok        BOOLEAN;
  v_score_error     TEXT;
  v_targets_payload JSONB;
  v_unique_count    INT;
  v_open_result     JSON;
  v_open_ok         BOOLEAN;
  v_open_error      TEXT;
  v_round_id        UUID;
  v_log_payload     JSON;
BEGIN
  IF p_min_fanout IS NULL OR p_min_fanout < 1 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_min_fanout');
  END IF;

  -- Step 1: score the operators. Pass-through any failure
  -- (trip_not_found / no_eligible_operators).
  v_score_result := score_operators_for_trip(p_trip_request_id);
  v_score_ok    := (v_score_result->>'ok')::BOOLEAN;
  IF NOT v_score_ok THEN
    v_score_error := v_score_result->>'error';
    RETURN json_build_object('ok', false, 'error', v_score_error);
  END IF;

  -- Step 2: phone dedupe. Group the scoring output by
  -- normalised phone, keep the highest-ranked (lowest rank
  -- value) per group, re-rank 1..N. We mint id + nonce +
  -- expires_at HERE so the targets payload matches Phase 5's
  -- contract verbatim.
  WITH scored AS (
    SELECT
      (e->>'operator_id')::UUID AS operator_id,
      e->>'contact_phone'       AS contact_phone,
      (e->>'score')::DECIMAL    AS score,
      (e->>'rank')::INT         AS orig_rank
    FROM jsonb_array_elements((v_score_result->'operators')::JSONB) AS e
  ),
  deduped AS (
    -- Keep the row with the lowest orig_rank per phone; ties
    -- broken by operator_id asc for determinism.
    SELECT DISTINCT ON (contact_phone)
      operator_id, contact_phone, score, orig_rank
    FROM scored
    ORDER BY contact_phone, orig_rank ASC, operator_id ASC
  ),
  reranked AS (
    SELECT
      operator_id,
      contact_phone,
      score,
      ROW_NUMBER() OVER (ORDER BY score DESC, operator_id ASC)::INT AS new_rank
    FROM deduped
  )
  SELECT
    COUNT(*),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',           uuid_generate_v4(),
        'operator_id',  operator_id,
        'target_phone', contact_phone,
        'nonce',        encode(gen_random_bytes(16), 'hex'),
        'sent_at',      v_now,
        'expires_at',   v_now + INTERVAL '4 hours',
        'score',        score,
        'rank',         new_rank
      )
      ORDER BY new_rank
    ), '[]'::jsonb)
    INTO v_unique_count, v_targets_payload
    FROM reranked;

  -- Step 3: fanout floor check. Anything below
  -- p_min_fanout (default 2) is "not enough competition" →
  -- decline + leave the trip pending for admin review.
  IF v_unique_count < p_min_fanout THEN
    RETURN json_build_object(
      'ok', false,
      'error', 'insufficient_unique_operators',
      'dispatched_count', 0,
      'unique_phone_count', v_unique_count
    );
  END IF;

  -- Step 4: hand the deduped + freshly-minted targets payload
  -- to Phase 5's open_phase5_dispatch_round. Phase 5 strips
  -- the trailing fields it does not know about (operator_id,
  -- score, rank); only id/target_phone/nonce/sent_at/
  -- expires_at flow into trip_dispatch_targets.
  v_open_result := open_phase5_dispatch_round(
    p_trip_request_id,
    v_targets_payload
  );
  v_open_ok := (v_open_result->>'ok')::BOOLEAN;
  IF NOT v_open_ok THEN
    v_open_error := v_open_result->>'error';
    RETURN json_build_object(
      'ok', false,
      'error', 'open_round_failed',
      'detail', v_open_error
    );
  END IF;

  v_round_id := (v_open_result->>'round_id')::UUID;

  -- Step 5: INSERT trip_distribution_log rows. One row per
  -- (trip, round, operator) triple. dispatch_target_id is the
  -- newly-INSERTed target row's id (which we minted in step 2
  -- so we already have it in v_targets_payload).
  INSERT INTO trip_distribution_log (
    trip_request_id, operator_id, dispatched_at,
    score, rank, dispatch_target_id, notification_channel
  )
  SELECT
    p_trip_request_id,
    (t->>'operator_id')::UUID,
    v_now,
    (t->>'score')::DECIMAL,
    (t->>'rank')::INT,
    (t->>'id')::UUID,
    'whatsapp_link'
  FROM jsonb_array_elements(v_targets_payload) AS t;

  -- Step 6: build the per-target return summary so the
  -- endpoint can log structured + the canary read can show
  -- per-row provenance.
  SELECT json_agg(
    json_build_object(
      'operator_id',  t->>'operator_id',
      'target_id',    t->>'id',
      'target_phone', t->>'target_phone',
      'score',        (t->>'score')::DECIMAL,
      'rank',         (t->>'rank')::INT
    )
    ORDER BY (t->>'rank')::INT
  ) INTO v_log_payload
   FROM jsonb_array_elements(v_targets_payload) AS t;

  RETURN json_build_object(
    'ok', true,
    'dispatched_count', v_unique_count,
    'round_id', v_round_id,
    'targets', v_log_payload
  );
END;
$$;


-- ============================================================
-- §6 — redispatch_stale_trip_requests
-- ============================================================
--
-- Cron-driven. Finds trips dispatched > 4 hours ago whose
-- current dispatch round received zero offers, runs the full
-- state-cleanup contract per Codex spec round 3 P2 #2:
--   1. cancel still-pending targets in the stale round
--   2. close the stale round with closed_reason='stale_timeout'
--   3. NULL trip_requests.current_dispatch_round_id so the
--      trip is re-pickable
-- Then re-attempts auto_dispatch_trip_request for each.
--
-- Contract:
--   IN  (none)
--   OUT JSON:
--       { ok: true, scanned, redispatched, declined, errors }
--
-- "scanned" = trips matching the staleness predicate.
-- "redispatched" = successful auto_dispatch_trip_request.
-- "declined" = insufficient_unique_operators.
-- "errors" = trip_not_found / open_round_failed / etc.

CREATE OR REPLACE FUNCTION redispatch_stale_trip_requests()
  RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_now            TIMESTAMPTZ := NOW();
  v_trip           RECORD;
  v_dispatch_res   JSON;
  v_scanned        INT := 0;
  v_redispatched   INT := 0;
  v_declined       INT := 0;
  v_errors         INT := 0;
BEGIN
  FOR v_trip IN
    SELECT t.id AS trip_id, t.current_dispatch_round_id AS round_id
      FROM trip_requests t
     WHERE t.status IN ('distributed', 'offered')
       AND t.current_dispatch_round_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM phase5_operator_offers o
          WHERE o.trip_request_id = t.id
            AND o.dispatch_target_id IN (
              SELECT id FROM trip_dispatch_targets
               WHERE dispatch_round_id = t.current_dispatch_round_id
            )
       )
       AND EXISTS (
         SELECT 1 FROM trip_dispatch_rounds r
          WHERE r.id = t.current_dispatch_round_id
            AND r.status = 'open'
            AND r.opened_at < v_now - INTERVAL '4 hours'
       )
  LOOP
    v_scanned := v_scanned + 1;

    -- State cleanup (Codex spec round 3 P2 #2):
    UPDATE trip_dispatch_targets
       SET status = 'cancelled'
     WHERE dispatch_round_id = v_trip.round_id
       AND status = 'pending';

    UPDATE trip_dispatch_rounds
       SET status = 'closed',
           closed_reason = 'stale_timeout',
           closed_at = v_now
     WHERE id = v_trip.round_id
       AND status = 'open';

    UPDATE trip_requests
       SET current_dispatch_round_id = NULL
     WHERE id = v_trip.trip_id;

    -- Re-attempt dispatch.
    BEGIN
      v_dispatch_res := auto_dispatch_trip_request(v_trip.trip_id);
      IF (v_dispatch_res->>'ok')::BOOLEAN THEN
        v_redispatched := v_redispatched + 1;
      ELSIF v_dispatch_res->>'error' = 'insufficient_unique_operators' THEN
        v_declined := v_declined + 1;
      ELSE
        v_errors := v_errors + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  -- Record the tick for the canary.
  INSERT INTO operator_cron_tick_history (job_name, last_tick_at, error_label)
    VALUES ('redispatch_stale_trip_requests', v_now,
            CASE WHEN v_errors > 0
                 THEN format('errors=%s scanned=%s', v_errors, v_scanned)
                 ELSE NULL
            END)
    ON CONFLICT (job_name)
    DO UPDATE SET last_tick_at = EXCLUDED.last_tick_at,
                  error_label  = EXCLUDED.error_label;

  RETURN json_build_object(
    'ok', true,
    'scanned',      v_scanned,
    'redispatched', v_redispatched,
    'declined',     v_declined,
    'errors',       v_errors
  );
END;
$$;


-- ============================================================
-- §7 — REVOKE/GRANT discipline
-- ============================================================

REVOKE ALL ON FUNCTION score_operators_for_trip(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION score_operators_for_trip(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION score_operators_for_trip(UUID) TO service_role;

REVOKE ALL ON FUNCTION auto_dispatch_trip_request(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION auto_dispatch_trip_request(UUID, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION auto_dispatch_trip_request(UUID, INT) TO service_role;

REVOKE ALL ON FUNCTION redispatch_stale_trip_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION redispatch_stale_trip_requests() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION redispatch_stale_trip_requests() TO service_role;

COMMENT ON FUNCTION score_operators_for_trip(UUID) IS
  'Phase 9 PR 4 §4.3: pure read; top-5 eligible operators for a trip; service_role only.';
COMMENT ON FUNCTION auto_dispatch_trip_request(UUID, INT) IS
  'Phase 9 PR 4 §4.3: scoring → dedupe → Phase 5 round + log writes; service_role only.';
COMMENT ON FUNCTION redispatch_stale_trip_requests() IS
  'Phase 9 PR 4 §4.4: cron RPC; rescues stale 4h+ trips with no offers + records tick.';
