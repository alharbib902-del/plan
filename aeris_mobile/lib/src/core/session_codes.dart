/// Single source of truth for "this wire `error` code means the stored
/// session is dead — drop the token and return to /login".
///
/// NON-NEGOTIABLE (founder, 2026-06-14): this set is EXACTLY these three
/// codes. Both the launch-time check ([AuthController.build]) and the
/// global mid-session handler ([ApiClient]) gate on this one predicate,
/// so the rule lives in a single, unit-tested place.
///
/// In particular it MUST NEVER include:
///   - `current_password_invalid` — a wrong CURRENT password on
///     `/auth/change-password`. It is HTTP 401 *by status*, but it is a
///     credential failure, NOT a dead session. Wiping the session here
///     would log a locked user out the instant they fat-finger their old
///     password. The 401 status is never sufficient; the CODE decides.
///   - `flag_disabled` — the client portal is temporarily off
///     (`ENABLE_CLIENT_PORTAL`); keep the user logged in so they return
///     seamlessly when it flips back on.
///   - `account_not_active` / `client_not_active` — an account-STATE
///     error surfaced to the user, not a reason to silently erase a
///     still-valid token.
const Set<String> kSessionInvalidatingCodes = {
  'missing_token',
  'invalid_session',
  'session_expired',
};

/// True only for the codes that mean the session token is no longer
/// usable and must be cleared. See [kSessionInvalidatingCodes].
bool invalidatesSession(String code) => kSessionInvalidatingCodes.contains(code);
