-- ============================================================
-- P0 fix — extend guest empty-leg reservation hold 10 → 60 min
--
-- Forward-only + idempotent: CREATE OR REPLACE the full
-- `reserve_empty_leg` body copied verbatim from
-- `20260510000011_phase_7_empty_legs_rpcs.sql` with ONE
-- behavioral change — the hold ceiling moves from
-- INTERVAL '10 minutes' to INTERVAL '60 minutes' (still
-- bounded by departure_window_start via LEAST). SECURITY
-- DEFINER / search_path / REVOKE / GRANT are preserved
-- exactly; the function signature is unchanged so no
-- app-side callsite changes are needed.
--
-- The application-side reservation token TTL is extended in
-- lockstep (lib/empty-legs/reservation-token.ts
-- DEFAULT_TTL_SECONDS 600 → 3600) so the HMAC token and the
-- DB hold always expire together.
--
-- Applied via the external migration runner — never
-- `supabase db push`.
-- ============================================================


-- ============================================================
-- reserve_empty_leg — public reserve (60-minute hold)
--
-- Called by the public marketplace's reserve Server Action
-- after the customer fills the form. The reservation token
-- itself is HMAC-signed and minted application-side
-- (`lib/empty-legs/reservation-token.ts`); the RPC receives
-- only the sha256 hash + expiry. Mirror Phase 6.2's
-- `bookings.checkout_token_hash` pattern (DB never sees the
-- raw token).
-- ============================================================

CREATE OR REPLACE FUNCTION reserve_empty_leg(
  p_leg_id          UUID,
  p_token_hash      VARCHAR(64),
  p_expires_at      TIMESTAMPTZ,
  p_customer_name   VARCHAR(120),
  p_customer_phone  VARCHAR(20)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now           TIMESTAMPTZ := NOW();
  v_status        empty_leg_status;
  v_window_end    TIMESTAMPTZ;
  v_dep_window    TIMESTAMPTZ;
  v_max_expiry    TIMESTAMPTZ;
BEGIN
  PERFORM 1 FROM empty_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_found');
  END IF;

  SELECT status, auction_window_end_at, departure_window_start
    INTO v_status, v_window_end, v_dep_window
    FROM empty_legs WHERE id = p_leg_id;

  IF v_status <> 'available' THEN
    RETURN json_build_object('ok', false, 'error', 'leg_not_available');
  END IF;

  IF v_window_end IS NOT NULL AND v_window_end <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'leg_window_closed');
  END IF;

  IF p_token_hash IS NULL OR LENGTH(p_token_hash) < 16 THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_token_invalid');
  END IF;

  -- Bound the reservation hold to the spec-mandated 60-minute
  -- window AND ensure it does not stretch past the leg's
  -- departure_window_start (Codex round-1 P2 #2 fix). Without
  -- this, a buggy or crafted Server Action call could reserve
  -- an empty leg for hours/days, blocking availability past
  -- the intended hold. The Server Action mints tokens with
  -- a 60-minute TTL, so the bounded ceiling here is defense
  -- in depth at the DB layer.
  v_max_expiry := LEAST(v_now + INTERVAL '60 minutes', v_dep_window);
  IF p_expires_at IS NULL OR p_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_expiry_invalid');
  END IF;
  IF p_expires_at > v_max_expiry THEN
    RETURN json_build_object('ok', false, 'error', 'reservation_expiry_too_far');
  END IF;

  IF NULLIF(TRIM(p_customer_name), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_name_missing');
  END IF;

  IF NULLIF(TRIM(p_customer_phone), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_phone_missing');
  END IF;

  UPDATE empty_legs
    SET status = 'reserved',
        reservation_token_hash = p_token_hash,
        reservation_expires_at = p_expires_at,
        reservation_customer_name_snapshot = TRIM(p_customer_name),
        reservation_customer_phone_snapshot = TRIM(p_customer_phone)
    WHERE id = p_leg_id;

  RETURN json_build_object(
    'ok', true,
    'leg_id', p_leg_id,
    'reservation_expires_at', p_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION reserve_empty_leg(
  UUID, VARCHAR, TIMESTAMPTZ, VARCHAR, VARCHAR
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_empty_leg(
  UUID, VARCHAR, TIMESTAMPTZ, VARCHAR, VARCHAR
) TO service_role;
