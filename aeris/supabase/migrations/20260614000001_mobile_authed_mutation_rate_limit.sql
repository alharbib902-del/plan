-- Mobile authenticated mutation rate-limit bucket.
--
-- PR2 uses the existing public_action_attempts ledger for Bearer-token
-- mutations (create/cancel trip request, accept/decline offer). The app
-- stores an HMAC fingerprint derived from the session token hash, not the
-- raw token/hash, so the limiter is per token without leaking credential
-- material.

ALTER TABLE public_action_attempts
  DROP CONSTRAINT IF EXISTS public_action_attempts_action_check;
ALTER TABLE public_action_attempts
  ADD CONSTRAINT public_action_attempts_action_check CHECK (
    action IN (
      'flight_request',
      'empty_leg_reserve',
      'cargo_intake',
      'medevac_intake',
      'client_login',
      'operator_login',
      'client_authed_mutation'
    )
  );

COMMENT ON TABLE public_action_attempts IS
  'Public-action + login + mobile authed mutation rate-limit ledger. Stores HMAC actor fingerprints, not raw IP addresses or session token hashes. Cleaned to 7 days by cleanup_old_public_action_attempts().';
