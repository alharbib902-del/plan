-- Push PR1 — device_tokens registry for client push notifications.
--
-- PR1 is REGISTRATION ONLY: the table + register/unregister RPCs. NO sender,
-- NO delivery log (client_push_deliveries lands in PR3), NO FCM logic.
-- Forward-only + idempotent.
--
-- A FCM/APNs registration token identifies a DEVICE, not a user: the same
-- device can move between client accounts (logout A → login B). So the token is
-- the natural key and register UPSERTs to re-point it to the current client.
--
-- UNIQUENESS IS ON THE HASH, NOT THE RAW TOKEN: a Postgres btree index entry
-- has a hard size limit (~2.7 KB), and FCM tokens are long + unbounded over
-- time, so a UNIQUE index on the raw TEXT could fail an INSERT the app already
-- accepted. We store the plaintext `token` (un-indexed, needed to send in PR3)
-- and a fixed-width `token_sha256` (64-char hex) that carries the UNIQUE btree
-- index — mirroring the session hash-in-app convention. unregister removes only
-- the caller's OWN token (by hash + client_id).
--
-- Security: RLS deny-all; access via SECURITY DEFINER service_role-only RPCs.
-- client_id comes from the validated Bearer session, never trusted from input;
-- the RPC still guards (client must exist) — defence in depth.
-- =============================================================

CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- plaintext FCM/APNs token (un-indexed; used to send in PR3)
  token TEXT NOT NULL,
  -- sha256(token) hex — the btree-safe UNIQUE key (computed in the app)
  token_sha256 TEXT NOT NULL CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One device (by token hash) maps to one row; register re-points it to the
-- current client on conflict. The index is on the fixed 64-char hex → no btree
-- size risk.
CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_token_sha256_unique
  ON device_tokens (token_sha256);
-- Fast lookup of a client's devices at send time (PR3).
CREATE INDEX IF NOT EXISTS device_tokens_client_id_idx
  ON device_tokens (client_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_tokens_deny_all ON device_tokens;
CREATE POLICY device_tokens_deny_all ON device_tokens
  FOR ALL USING (false) WITH CHECK (false);

-- register: upsert by token hash, re-pointing it to the current client.
CREATE OR REPLACE FUNCTION register_client_device_token(
  p_client_id UUID,
  p_token TEXT,
  p_token_sha256 TEXT,
  p_platform TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_input');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  INSERT INTO device_tokens (client_id, token, token_sha256, platform)
  VALUES (p_client_id, btrim(p_token), p_token_sha256, p_platform)
  ON CONFLICT (token_sha256) DO UPDATE
    SET client_id = EXCLUDED.client_id,
        token = EXCLUDED.token,
        platform = EXCLUDED.platform,
        updated_at = NOW(),
        last_seen_at = NOW();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION register_client_device_token(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION register_client_device_token(UUID, TEXT, TEXT, TEXT)
  TO service_role;

-- unregister: remove only the caller's own token, by hash (idempotent).
CREATE OR REPLACE FUNCTION unregister_client_device_token(
  p_client_id UUID,
  p_token_sha256 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM device_tokens
  WHERE token_sha256 = p_token_sha256 AND client_id = p_client_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION unregister_client_device_token(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION unregister_client_device_token(UUID, TEXT)
  TO service_role;

COMMENT ON TABLE device_tokens IS
  'Client push-notification device registry (FCM/APNs tokens). UNIQUE is on token_sha256 (btree-safe), not the raw token; the plaintext token is stored un-indexed for sending (PR3). register re-points a token-hash to the current client. RLS deny-all; access only via service_role SECURITY DEFINER RPCs. PR1: registration only.';
