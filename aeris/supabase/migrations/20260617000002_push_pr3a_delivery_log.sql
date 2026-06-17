-- Push PR3a — client_push_deliveries idempotency/retry log + push ops-health
-- singleton. DB ONLY: tables + claim/mark/list RPCs. NO sender, NO FCM, NO
-- google-auth, NO wiring into enqueueClientLegNotifications (all → PR3b).
-- Forward-only + idempotent.
--
-- Idempotency key = (client_id, leg_id, event_type): ONE push per client per
-- leg per event, fanned out to all the client's devices at send time (PR3b).
--
-- Concurrency-safe + retry-aware: `claim` INSERTs a fresh row as 'claimed'
-- (in-flight). A concurrent second claim for the same key sees a non-stale
-- 'claimed' row → claimed=false (NO double-send). A row is re-claimable ONLY
-- when it is a due 'failed_transient' OR a STALE 'claimed' (a worker that died
-- mid-send, claimed_at older than the stale window). 'sent'/'failed_permanent'/
-- attempt-exhausted → claimed=false. `mark` is existence-checked and never
-- downgrades a terminal 'sent'.
--
-- Security: RLS deny-all; access via SECURITY DEFINER service_role-only RPCs.
-- =============================================================

CREATE TABLE IF NOT EXISTS client_push_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  leg_id UUID NOT NULL REFERENCES empty_legs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('published','price_dropped')),
  status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed','sent','failed_transient','failed_permanent')),
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_push_deliveries_unique
  ON client_push_deliveries (client_id, leg_id, event_type);
CREATE INDEX IF NOT EXISTS client_push_deliveries_retryable_idx
  ON client_push_deliveries (next_retry_at) WHERE status = 'failed_transient';
ALTER TABLE client_push_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_push_deliveries_deny_all ON client_push_deliveries;
CREATE POLICY client_push_deliveries_deny_all ON client_push_deliveries
  FOR ALL USING (false) WITH CHECK (false);

-- claim: fresh INSERT as 'claimed'; a conflict re-claims ONLY a due
-- 'failed_transient' OR a STALE 'claimed' (dead worker), under the attempt cap.
CREATE OR REPLACE FUNCTION claim_client_push_delivery(
  p_client_id UUID,
  p_leg_id UUID,
  p_event_type TEXT,
  p_max_attempts INT DEFAULT 5,
  p_stale_after INTERVAL DEFAULT INTERVAL '10 minutes'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_attempt INT;
BEGIN
  IF p_event_type NOT IN ('published','price_dropped') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;

  INSERT INTO client_push_deliveries
    (client_id, leg_id, event_type, status, attempt_count, claimed_at)
  VALUES (p_client_id, p_leg_id, p_event_type, 'claimed', 1, NOW())
  ON CONFLICT (client_id, leg_id, event_type) DO UPDATE
    SET attempt_count = client_push_deliveries.attempt_count + 1,
        status = 'claimed',
        claimed_at = NOW(),
        next_retry_at = NULL,
        updated_at = NOW()
    WHERE client_push_deliveries.attempt_count < p_max_attempts
      AND (
        (client_push_deliveries.status = 'failed_transient'
         AND (client_push_deliveries.next_retry_at IS NULL
              OR client_push_deliveries.next_retry_at <= NOW()))
        OR (client_push_deliveries.status = 'claimed'
            AND client_push_deliveries.claimed_at < NOW() - p_stale_after)
      )
  RETURNING id, attempt_count INTO v_id, v_attempt;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'claimed', false);
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'claimed', true, 'delivery_id', v_id, 'attempt', v_attempt);
END;
$$;
REVOKE ALL ON FUNCTION claim_client_push_delivery(UUID,UUID,TEXT,INT,INTERVAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_client_push_delivery(UUID,UUID,TEXT,INT,INTERVAL)
  TO service_role;

-- mark: existence-checked; never downgrades a terminal 'sent'.
CREATE OR REPLACE FUNCTION mark_client_push_delivery(
  p_delivery_id UUID,
  p_status TEXT,
  p_last_error TEXT DEFAULT NULL,
  p_next_retry_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('sent','failed_transient','failed_permanent') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM client_push_deliveries WHERE id = p_delivery_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'delivery_not_found');
  END IF;

  UPDATE client_push_deliveries
    SET status = p_status,
        last_error = p_last_error,
        sent_at = CASE WHEN p_status = 'sent' THEN NOW() ELSE sent_at END,
        next_retry_at =
          CASE WHEN p_status = 'failed_transient' THEN p_next_retry_at ELSE NULL END,
        updated_at = NOW()
    WHERE id = p_delivery_id
      AND NOT (status = 'sent' AND p_status <> 'sent'); -- never un-send

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION mark_client_push_delivery(UUID,TEXT,TEXT,TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_client_push_delivery(UUID,TEXT,TEXT,TIMESTAMPTZ)
  TO service_role;

-- list: due failed_transient rows under the cap (for a future retry sweep).
CREATE OR REPLACE FUNCTION list_retryable_push_deliveries(
  p_limit INT DEFAULT 100,
  p_max_attempts INT DEFAULT 5
)
RETURNS SETOF client_push_deliveries
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM client_push_deliveries
  WHERE status = 'failed_transient'
    AND attempt_count < p_max_attempts
    AND (next_retry_at IS NULL OR next_retry_at <= NOW())
  ORDER BY next_retry_at ASC NULLS FIRST
  LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION list_retryable_push_deliveries(INT,INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION list_retryable_push_deliveries(INT,INT)
  TO service_role;

-- Push ops-health singleton — SEPARATE channel from client_empty_leg_alert_status.
CREATE TABLE IF NOT EXISTS client_push_alert_status (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy','config_missing','send_failed')),
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO client_push_alert_status (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE client_push_alert_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_push_alert_status_deny_all ON client_push_alert_status;
CREATE POLICY client_push_alert_status_deny_all ON client_push_alert_status
  FOR ALL USING (false) WITH CHECK (false);

COMMENT ON TABLE client_push_deliveries IS
  'Push delivery idempotency/retry log. UNIQUE (client_id, leg_id, event_type). claim→send→mark lifecycle; concurrency-safe (in-flight ''claimed'' blocks double-send) + retry-aware (failed_transient + next_retry_at backoff, stale-claim reclaim). RLS deny-all; service_role RPCs only. PR3a: DB only (sender in PR3b).';
