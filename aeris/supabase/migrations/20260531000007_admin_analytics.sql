-- ============================================
-- AERIS — Admin analytics summary (read-only KPIs)
-- Migration: 20260531000007  (forward-only)
-- ============================================
-- A single aggregating RPC for the admin dashboard. NO new tables.
-- Live queries over bookings / trip_requests / operators (indexed on
-- the date columns used here). Returns one jsonb envelope.
--
-- Date field PER KPI (deliberate — Codex plan review):
--   - revenue + per-operator → bookings.paid_at (money is realised
--     when paid, not when the booking row was created)
--   - bookings count + source mix → bookings.created_at
--   - requests + conversion + status mix + top routes → trip_requests.created_at
--
-- Range: half-open [from, to). Defaults to the last 30 days; rejects
-- an inverted range and anything wider than 366 days.
--
-- Security: SECURITY DEFINER + service_role-only. The admin page calls
-- it through the service-role client AFTER requireAdminSession(); anon
-- and authenticated are revoked.

CREATE OR REPLACE FUNCTION admin_analytics_summary(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to     TIMESTAMPTZ;
  v_from   TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  v_to   := COALESCE(p_to, NOW());
  v_from := COALESCE(p_from, v_to - INTERVAL '30 days');

  IF v_from >= v_to THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_range');
  END IF;
  IF v_to - v_from > INTERVAL '366 days' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'range_too_large');
  END IF;

  WITH
  -- Paid bookings realised in-range (by paid_at) — revenue + operators.
  paid AS (
    SELECT b.total_amount, b.operator_id
    FROM bookings b
    WHERE b.payment_status = 'paid'
      AND b.paid_at IS NOT NULL
      AND b.paid_at >= v_from AND b.paid_at < v_to
  ),
  -- Bookings created in-range — counts + source mix.
  bk AS (
    SELECT b.source_discriminator, b.flight_status
    FROM bookings b
    WHERE b.created_at >= v_from AND b.created_at < v_to
  ),
  -- Trip requests created in-range — funnel + routes.
  req AS (
    SELECT t.status, t.departure_airport, t.arrival_airport
    FROM trip_requests t
    WHERE t.created_at >= v_from AND t.created_at < v_to
  )
  SELECT jsonb_build_object(
    'ok', true,
    'range', jsonb_build_object('from', v_from, 'to', v_to),

    'revenue', jsonb_build_object(
      'paid_total_sar', (SELECT COALESCE(SUM(total_amount), 0) FROM paid),
      'paid_count',     (SELECT COUNT(*) FROM paid)
    ),

    'bookings', jsonb_build_object(
      'total_count',     (SELECT COUNT(*) FROM bk),
      'cancelled_count', (SELECT COUNT(*) FROM bk WHERE flight_status = 'cancelled'),
      'by_source', COALESCE((
        SELECT jsonb_object_agg(source_discriminator, cnt)
        FROM (SELECT source_discriminator, COUNT(*) AS cnt FROM bk GROUP BY source_discriminator) s
      ), '{}'::jsonb)
    ),

    'requests', jsonb_build_object(
      'total_count',  (SELECT COUNT(*) FROM req),
      'booked_count', (SELECT COUNT(*) FROM req WHERE status = 'booked'),
      'conversion_pct', (
        SELECT CASE WHEN COUNT(*) > 0
          THEN ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'booked') / COUNT(*), 1)
          ELSE 0 END
        FROM req
      ),
      'by_status', COALESCE((
        SELECT jsonb_object_agg(status::text, cnt)
        FROM (SELECT status, COUNT(*) AS cnt FROM req GROUP BY status) s
      ), '{}'::jsonb)
    ),

    'top_routes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'departure', departure_airport,
        'arrival',   arrival_airport,
        'count',     cnt
      ))
      FROM (
        SELECT departure_airport, arrival_airport, COUNT(*) AS cnt
        FROM req
        WHERE departure_airport IS NOT NULL AND arrival_airport IS NOT NULL
        GROUP BY departure_airport, arrival_airport
        ORDER BY COUNT(*) DESC
        LIMIT 10
      ) r
    ), '[]'::jsonb),

    'top_operators', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'company_name',   company_name,
        'paid_total_sar', paid_total_sar,
        'paid_count',     paid_count
      ))
      FROM (
        SELECT op.company_name,
               COALESCE(SUM(p.total_amount), 0) AS paid_total_sar,
               COUNT(*) AS paid_count
        FROM paid p
        JOIN operators op ON op.id = p.operator_id
        GROUP BY op.id, op.company_name
        ORDER BY SUM(p.total_amount) DESC
        LIMIT 10
      ) o
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ---- grant — service_role ONLY ----------------------------------------------
REVOKE ALL ON FUNCTION admin_analytics_summary(TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_analytics_summary(TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;

-- ============================================
-- END OF MIGRATION
-- ============================================
