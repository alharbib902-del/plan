-- DB-01 — cashback expiry FIFO must attribute consumption across ALL
-- positive credits, not just `earn` rows.
--
-- expire_old_loyalty_credits() (§4.6, originally in
-- 20260520000044) built its FIFO walk from event_type='earn' ONLY and
-- subtracted total_consumed (redeem + expire) against that earn-only
-- stream. But referral rewards (20260531000006) post positive
-- event_type='adjust' rows with cashback_expiry_at NULL that count
-- toward cashback_balance_sar and are non-expiring. With those credits
-- invisible to the walk, a `redeem` that was actually drawn from a
-- non-expiring adjust credit got mis-attributed to an OLDER expired
-- `earn` — making the earn look already-consumed, so the expired earn
-- escaped clawback (the client kept cashback past its 24-month expiry).
--
-- Fix: the FIFO consumption is now attributed across ALL positive
-- credits in creation order — `earn` rows PLUS positive `adjust` rows.
-- Positive adjust rows (NULL expiry) occupy their real FIFO position so
-- they absorb consumption, but they never contribute to the expired
-- total (the expiry sum still filters cashback_expiry_at < NOW(), which
-- NULL fails) — so an adjust credit can never itself be expired.
-- Symmetrically, NEGATIVE `adjust` rows (admin clawback) reduce the
-- balance, so they join redeem + expire in total_consumed.
--
-- Signature, security context, search_path, and grants are preserved.
-- Still emits ONE `expire` event per client per run with the
-- FIFO-correct unconsumed-expired total.
--
-- NOT YET APPLIED TO PROD — apply via the runner + refresh
-- reports/live-schema-compact.json snapshot.
-- =============================================================

CREATE OR REPLACE FUNCTION expire_old_loyalty_credits()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id        UUID;
  v_expired_amount   DECIMAL(14,2);
  v_current_balance  DECIMAL(14,2);
  v_new_balance      DECIMAL(14,2);
  v_clients_processed INT := 0;
  v_total_expired_sar DECIMAL(14,2) := 0;
  v_errors           INT := 0;
BEGIN
  -- Outer candidate filter: clients with at least one expired
  -- earn not yet superseded by a later expire event. Kept as a
  -- batch-size optimization; the FIFO recompute inside the loop
  -- is the authoritative source of v_expired_amount (a stale
  -- match here can land on a 0 result and CONTINUE).
  FOR v_client_id IN
    SELECT DISTINCT client_id
    FROM client_loyalty_ledger
    WHERE event_type = 'earn'
      AND cashback_expiry_at < NOW()
      AND NOT EXISTS (
        SELECT 1 FROM client_loyalty_ledger expired
        WHERE expired.client_id = client_loyalty_ledger.client_id
          AND expired.event_type = 'expire'
          AND expired.created_at > client_loyalty_ledger.cashback_expiry_at
      )
  LOOP
    BEGIN
      -- Lock client row (also serializes against a concurrent
      -- redeem on the same client, so total_consumed below
      -- includes a redeem that lands in this same cron tick).
      SELECT cashback_balance_sar INTO v_current_balance
      FROM clients WHERE id = v_client_id FOR UPDATE;

      IF v_current_balance IS NULL OR v_current_balance <= 0 THEN
        CONTINUE;
      END IF;

      -- FIFO walk:
      --   1. total_consumed = absolute SUM of every balance-reducing
      --      event ever posted for this client: `redeem`, `expire`,
      --      and NEGATIVE `adjust` (admin clawback). All carry a
      --      negative amount_sar, so SUM(-amount_sar) is positive.
      --   2. Window-aggregate the POSITIVE credit stream — `earn`
      --      rows AND positive `adjust` rows (referral rewards / admin
      --      grants) — ordered by (created_at, id) ASC and project a
      --      cumulative_amount column. Positive adjust rows take their
      --      real FIFO position so they absorb consumption ahead of /
      --      between earns by creation order.
      --   3. For each credit, project "remaining" =
      --        0                                       if cumulative_amount <= total_consumed
      --        amount_sar                              if cumulative_amount - amount_sar >= total_consumed
      --        cumulative_amount - total_consumed     otherwise (partial consumption)
      --   4. Sum `remaining` over EXPIRED credits only → that's the
      --      FIFO-correct amount to expire NOW. The cashback_expiry_at
      --      < NOW() filter excludes positive adjust rows (NULL expiry
      --      fails the predicate), so an adjust credit never expires.
      WITH consumption AS (
        SELECT COALESCE(SUM(-amount_sar), 0) AS total_consumed
        FROM client_loyalty_ledger
        WHERE client_id = v_client_id
          AND (
            event_type IN ('redeem', 'expire')
            OR (event_type = 'adjust' AND amount_sar < 0)
          )
      ),
      credits AS (
        SELECT
          amount_sar,
          cashback_expiry_at,
          SUM(amount_sar) OVER (
            ORDER BY created_at ASC, id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS cumulative_amount
        FROM client_loyalty_ledger
        WHERE client_id = v_client_id
          AND (
            event_type = 'earn'
            OR (event_type = 'adjust' AND amount_sar > 0)
          )
      )
      SELECT COALESCE(SUM(
        CASE
          WHEN cumulative_amount <= (SELECT total_consumed FROM consumption) THEN 0
          WHEN cumulative_amount - amount_sar >= (SELECT total_consumed FROM consumption) THEN amount_sar
          ELSE cumulative_amount - (SELECT total_consumed FROM consumption)
        END
      ), 0)
      INTO v_expired_amount
      FROM credits
      WHERE cashback_expiry_at < NOW();

      -- Defensive cap: never expire more than the current
      -- denormalized balance (catches admin-driven drift that
      -- the FIFO walk can't see).
      v_expired_amount := LEAST(v_expired_amount, v_current_balance);

      IF v_expired_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_new_balance := v_current_balance - v_expired_amount;

      INSERT INTO client_loyalty_ledger (
        client_id, event_type, amount_sar, balance_after_sar
      ) VALUES (
        v_client_id, 'expire', -v_expired_amount, v_new_balance
      );

      UPDATE clients SET cashback_balance_sar = v_new_balance
      WHERE id = v_client_id;

      v_clients_processed := v_clients_processed + 1;
      v_total_expired_sar := v_total_expired_sar + v_expired_amount;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE NOTICE 'expire_old_loyalty_credits: failed for client=%: %', v_client_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'clients_processed', v_clients_processed,
    'total_expired_sar', v_total_expired_sar,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION expire_old_loyalty_credits()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_old_loyalty_credits()
  TO service_role;
