-- ============================================
-- AERIS — Empty Legs price alerts (client-defined subscriptions)
-- Migration: 20260531000004  (forward-only)
-- ============================================
-- Client-driven complement to the existing platform matcher: a client saves an
-- alert ("RUH -> JED under X SAR, in this date window") and the price-alerts cron
-- notifies them when a matching `available` empty leg appears. Dedup is per
-- (alert, leg) so a client is alerted once per leg.
--
-- Discipline (Phase 8/9): deny-all RLS; all access via service-role — client
-- mutations through the SECURITY DEFINER RPCs below (identity from the session),
-- reads + the cron through the service-role client.

-- ---- tables -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_empty_leg_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  origin_iata VARCHAR(3) NOT NULL,
  destination_iata VARCHAR(3) NOT NULL,
  max_price_sar NUMERIC,                       -- NULL = any price
  date_from DATE,                              -- NULL = no lower bound
  date_to DATE,                                -- NULL = no upper bound
  channels TEXT[] NOT NULL DEFAULT ARRAY['email']::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT client_empty_leg_alerts_route_distinct CHECK (origin_iata <> destination_iata)
);

CREATE INDEX IF NOT EXISTS idx_client_empty_leg_alerts_client
  ON client_empty_leg_alerts (client_id);
CREATE INDEX IF NOT EXISTS idx_client_empty_leg_alerts_match
  ON client_empty_leg_alerts (is_active, origin_iata, destination_iata);

CREATE TABLE IF NOT EXISTS empty_leg_alert_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID NOT NULL REFERENCES client_empty_leg_alerts(id) ON DELETE CASCADE,
  empty_leg_id UUID NOT NULL REFERENCES empty_legs(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email',
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT empty_leg_alert_deliveries_unique UNIQUE (alert_id, empty_leg_id)
);

ALTER TABLE client_empty_leg_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE empty_leg_alert_deliveries ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: deny-all for anon/authenticated. Access is via the
-- service-role client (RPCs + cron) only.
REVOKE ALL ON client_empty_leg_alerts FROM anon, authenticated;
REVOKE ALL ON empty_leg_alert_deliveries FROM anon, authenticated;

-- ---- RPC: create_client_empty_leg_alert -------------------------------------
CREATE OR REPLACE FUNCTION create_client_empty_leg_alert(
  p_client_id UUID,
  p_origin VARCHAR,
  p_destination VARCHAR,
  p_max_price NUMERIC,
  p_date_from DATE,
  p_date_to DATE,
  p_channels TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_o VARCHAR;
  v_d VARCHAR;
BEGIN
  v_o := upper(trim(COALESCE(p_origin, '')));
  v_d := upper(trim(COALESCE(p_destination, '')));
  -- 3-letter IATA, distinct route, non-negative price.
  IF length(v_o) <> 3 OR length(v_d) <> 3 OR v_o = v_d THEN
    RETURN NULL;
  END IF;
  IF p_max_price IS NOT NULL AND p_max_price < 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO client_empty_leg_alerts (
    client_id, origin_iata, destination_iata, max_price_sar, date_from, date_to, channels
  )
  VALUES (
    p_client_id, v_o, v_d, p_max_price, p_date_from, p_date_to,
    COALESCE(NULLIF(p_channels, ARRAY[]::TEXT[]), ARRAY['email']::TEXT[])
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---- RPC: delete_client_empty_leg_alert (ownership by client_id) ------------
CREATE OR REPLACE FUNCTION delete_client_empty_leg_alert(
  p_alert_id UUID,
  p_client_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  DELETE FROM client_empty_leg_alerts
  WHERE id = p_alert_id AND client_id = p_client_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

-- ---- RPC: set_client_empty_leg_alert_active (ownership by client_id) --------
CREATE OR REPLACE FUNCTION set_client_empty_leg_alert_active(
  p_alert_id UUID,
  p_client_id UUID,
  p_active BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  UPDATE client_empty_leg_alerts
  SET is_active = COALESCE(p_active, is_active), updated_at = NOW()
  WHERE id = p_alert_id AND client_id = p_client_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

-- ---- RPC: record_empty_leg_alert_delivery (race-safe dedup; cron uses it) ----
CREATE OR REPLACE FUNCTION record_empty_leg_alert_delivery(
  p_alert_id UUID,
  p_empty_leg_id UUID,
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
  INSERT INTO empty_leg_alert_deliveries (alert_id, empty_leg_id, channel)
  VALUES (p_alert_id, p_empty_leg_id, COALESCE(NULLIF(trim(p_channel), ''), 'email'))
  ON CONFLICT (alert_id, empty_leg_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;  -- NULL when this (alert, leg) was already delivered
END;
$$;

-- ---- grants — service_role ONLY ---------------------------------------------
REVOKE ALL ON FUNCTION create_client_empty_leg_alert(UUID, VARCHAR, VARCHAR, NUMERIC, DATE, DATE, TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_client_empty_leg_alert(UUID, VARCHAR, VARCHAR, NUMERIC, DATE, DATE, TEXT[])
  TO service_role;

REVOKE ALL ON FUNCTION delete_client_empty_leg_alert(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_client_empty_leg_alert(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION set_client_empty_leg_alert_active(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_client_empty_leg_alert_active(UUID, UUID, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION record_empty_leg_alert_delivery(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_empty_leg_alert_delivery(UUID, UUID, TEXT) TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
