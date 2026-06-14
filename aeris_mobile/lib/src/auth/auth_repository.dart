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
    return fetchSession();
  }

  Future<ClientSession> fetchSession() async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/me/session');
    final session = res['session'];
    if (session is! Map) throw const AppException('invalid_session');
    return ClientSession.fromJson(Map<String, dynamic>.from(session));
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
