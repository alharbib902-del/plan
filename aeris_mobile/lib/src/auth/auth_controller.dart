import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/app_exception.dart';
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
      // Invalid/expired/revoked token → drop it, land on login.
      if (_isSessionError(e.code)) {
        await _repo.clearToken();
        return const Unauthenticated();
      }
      rethrow; // genuine transient fault surfaces as AsyncError
    }
  }

  /// Returns the resolved status on success, or null on failure
  /// (the error is available via `state.error` for the form).
  /// Deliberately does NOT flip to AsyncLoading so the router
  /// doesn't bounce to /splash mid-submit — the form tracks its
  /// own submitting state.
  Future<AuthStatus?> login({
    required String email,
    required String password,
    bool rememberMe = true,
  }) async {
    final result = await AsyncValue.guard(() async {
      return _statusFor(
        await _repo.login(
          email: email,
          password: password,
          rememberMe: rememberMe,
        ),
      );
    });
    state = result;
    return result.valueOrNull;
  }

  Future<void> logout() async {
    await _repo.logout();
    state = const AsyncData(Unauthenticated());
  }

  AuthStatus _statusFor(ClientSession s) =>
      s.passwordMustChange ? MustChangePassword(s) : Authenticated(s);

  bool _isSessionError(String code) {
    return code == 'missing_token' ||
        code == 'invalid_session' ||
        code == 'session_expired' ||
        code == 'expired' ||
        code == 'invalid_token_hash' ||
        code == 'account_not_active' ||
        code == 'flag_disabled';
  }
}

final authControllerProvider =
    AsyncNotifierProvider<AuthController, AuthStatus>(AuthController.new);
