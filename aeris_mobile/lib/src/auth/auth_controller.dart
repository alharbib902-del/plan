import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/app_exception.dart';
import '../core/session_codes.dart';
import 'auth_repository.dart';
import 'session.dart';

/// Resolved authentication status the router redirects on.
sealed class AuthStatus {
  const AuthStatus();
}

class Unauthenticated extends AuthStatus {
  const Unauthenticated();
}

class Authenticated extends AuthStatus {
  const Authenticated(this.session);
  final ClientSession session;
}

class MustChangePassword extends AuthStatus {
  const MustChangePassword(this.session);
  final ClientSession session;
}

/// Drives the auth lifecycle. `build()` validates the stored token
/// on launch via `/me/session` (the single revocation-detection
/// point). Login/logout mutate the state, which the router watches.
class AuthController extends AsyncNotifier<AuthStatus> {
  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  Future<AuthStatus> build() async {
    if (!await _repo.hasToken()) return const Unauthenticated();
    try {
      return _statusFor(await _repo.fetchSession());
    } on AppException catch (e) {
      // Dead-session token → drop it, land on login. Anything else
      // (flag_disabled, account_not_active, transient faults) keeps the
      // token and surfaces as AsyncError — see session_codes.dart.
      if (invalidatesSession(e.code)) {
        await _repo.clearToken();
        return const Unauthenticated();
      }
      rethrow; // genuine transient/state fault surfaces as AsyncError
    }
  }

  /// Returns null on success (the router redirects on the new state), or
  /// the typed error for the form on failure. On failure the controller
  /// stays `AsyncData(Unauthenticated)` — NEVER `AsyncError` — so the
  /// router keeps the user on /login with an inline error instead of
  /// bouncing to /error (which is reserved for launch/refresh faults).
  /// Never flips to AsyncLoading, so the router doesn't bounce to
  /// /splash mid-submit — the form tracks its own submitting state.
  Future<AppException?> login({
    required String email,
    required String password,
    bool rememberMe = true,
  }) async {
    try {
      state = AsyncData(
        _statusFor(
          await _repo.login(
            email: email,
            password: password,
            rememberMe: rememberMe,
          ),
        ),
      );
      return null;
    } on AppException catch (e) {
      state = const AsyncData(Unauthenticated());
      return e;
    }
  }

  Future<void> logout() async {
    await _repo.logout();
    state = const AsyncData(Unauthenticated());
  }

  /// Drop the token + return to unauthenticated. Called by the global
  /// session guard (ApiClient.onSessionInvalid) when any authed request
  /// reports a dead-session code mid-session. Idempotent.
  Future<void> invalidate() async {
    await _repo.clearToken();
    state = const AsyncData(Unauthenticated());
  }

  /// Re-validate the stored token against `/me/session` (e.g. pull to
  /// refresh, or to confirm an unlock). A dead-session error drops the
  /// token; any other fault surfaces as AsyncError without a wipe.
  Future<void> refresh() async {
    try {
      state = AsyncData(_statusFor(await _repo.fetchSession()));
    } on AppException catch (e, st) {
      if (invalidatesSession(e.code)) {
        await invalidate();
      } else {
        state = AsyncError(e, st);
      }
    }
  }

  /// Unlock path for `password_must_change`. Returns the typed error for
  /// the form on failure (the session is NEVER cleared for
  /// `current_password_invalid`); on success it re-resolves the session
  /// via [refresh] (the single re-fetch implementation), so a dead
  /// session clears the token and a transient fault surfaces as an
  /// error/retry — never a silent logout — instead of stranding a token.
  Future<AppException?> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      await _repo.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
    } on AppException catch (e) {
      return e;
    }
    await refresh();
    return null;
  }

  AuthStatus _statusFor(ClientSession s) =>
      s.passwordMustChange ? MustChangePassword(s) : Authenticated(s);
}

final authControllerProvider =
    AsyncNotifierProvider<AuthController, AuthStatus>(AuthController.new);
