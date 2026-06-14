import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/app_exception.dart';
import '../core/env.dart';
import '../core/token_store.dart';
import 'session.dart';

/// Auth operations against the mobile API. Owns token persistence:
/// login stores the Bearer token, logout revokes + wipes it.
class AuthRepository {
  AuthRepository(this._api, this._tokens);

  final ApiClient _api;
  final TokenStore _tokens;

  Future<ClientSession> login({
    required String email,
    required String password,
    bool rememberMe = true,
  }) async {
    final res = await _api.postJson(
      '${ApiEnv.apiPrefix}/auth/login',
      {'email': email, 'password': password, 'remember_me': rememberMe},
      auth: false,
    );
    final token = res['token'];
    if (token is! String || token.isEmpty) {
      throw const AppException('unknown');
    }
    await _tokens.write(token);
    try {
      // Login is atomic: only keep the token once the session is
      // confirmed. If /me/session fails (even transient network),
      // drop the just-written token so the app never holds an
      // unvalidated credential while the form reports failure.
      return await fetchSession();
    } catch (_) {
      await _tokens.clear();
      rethrow;
    }
  }

  Future<ClientSession> fetchSession() async {
    // silent: the AuthController owns session-error handling for this
    // explicit lifecycle call, so the global session hook is suppressed.
    final res = await _api.getJson(
      '${ApiEnv.apiPrefix}/me/session',
      silent: true,
    );
    final session = res['session'];
    if (session is! Map) throw const AppException('invalid_session');
    return ClientSession.fromJson(Map<String, dynamic>.from(session));
  }

  /// Unlock path for the `password_must_change` lockout. Throws an
  /// [AppException] on failure — notably `current_password_invalid`,
  /// which is NOT a session death (the token stays put).
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _api.postJson('${ApiEnv.apiPrefix}/auth/change-password', {
      'current_password': currentPassword,
      'new_password': newPassword,
    });
  }

  Future<void> logout() async {
    try {
      await _api.postJson('${ApiEnv.apiPrefix}/auth/logout', const {});
    } catch (_) {
      // Logout is best-effort server-side; always clear locally.
    }
    await _tokens.clear();
  }

  Future<bool> hasToken() async {
    final t = await _tokens.read();
    return t != null && t.isNotEmpty;
  }

  Future<void> clearToken() => _tokens.clear();
}

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(
    ref.read(apiClientProvider),
    ref.read(tokenStoreProvider),
  );
});
