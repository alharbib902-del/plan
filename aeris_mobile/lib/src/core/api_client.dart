import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import 'app_exception.dart';
import 'env.dart';
import 'session_codes.dart';
import 'token_store.dart';

/// Thin Dio wrapper for the `/api/v1/mobile/*` contract.
///
/// Responsibilities:
///   - inject `Authorization: Bearer <token>` from secure storage
///     on requests flagged `auth: true`,
///   - normalise the `{ ok, error }` envelope + HTTP status into a
///     typed [AppException] (so the UI never parses raw responses),
///   - map transport/timeout faults to `network_error`,
///   - on a *session-invalidating* code (see [invalidatesSession]) from
///     any non-silent authed request, fire [onSessionInvalid] so the
///     app drops the token + returns to /login — the global, app-wide
///     "401 by error code, not status" guard.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required TokenStore tokenStore,
    this.onSessionInvalid,
    @visibleForTesting HttpClientAdapter? adapter,
  })  : _tokenStore = tokenStore,
      _dio = Dio(
        BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 15),
          // Inspect the body ourselves rather than throwing on 4xx.
          validateStatus: (_) => true,
          headers: const {'content-type': 'application/json'},
        ),
      ) {
    // Tests inject a stub transport to drive canned {ok,error}+status
    // responses through the real envelope/session-guard logic.
    if (adapter != null) _dio.httpClientAdapter = adapter;
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.extra['auth'] == true) {
            final token = await _tokenStore.read();
            if (token != null && token.isNotEmpty) {
              options.headers['authorization'] = 'Bearer $token';
            }
          }
          handler.next(options);
        },
      ),
    );
  }

  final Dio _dio;
  final TokenStore _tokenStore;

  /// Invoked when a non-silent authed request reports a
  /// session-invalidating code. Wired to drop the token + flip auth
  /// state to unauthenticated. Returns a Future and is AWAITED before
  /// the request's exception surfaces, so the token is guaranteed
  /// cleared (and auth state flipped) by the time the caller handles
  /// the error — no fire-and-forget race.
  final Future<void> Function()? onSessionInvalid;

  /// [silent] = true for the explicit session-lifecycle call
  /// (`/me/session`): the caller ([AuthController]) handles its own
  /// session errors there, so the global [onSessionInvalid] hook is
  /// suppressed (it would otherwise reentrantly mutate auth state
  /// during launch/login).
  Future<Map<String, dynamic>> getJson(
    String path, {
    bool auth = true,
    bool silent = false,
  }) {
    return _send(
      () => _dio.get<dynamic>(path, options: _opts(auth)),
      notify: auth && !silent,
    );
  }

  Future<Map<String, dynamic>> postJson(
    String path,
    Map<String, dynamic> body, {
    bool auth = true,
    bool silent = false,
  }) {
    return _send(
      () => _dio.post<dynamic>(path, data: body, options: _opts(auth)),
      notify: auth && !silent,
    );
  }

  Options _opts(bool auth) => Options(extra: {'auth': auth});

  Future<Map<String, dynamic>> _send(
    Future<Response<dynamic>> Function() run, {
    required bool notify,
  }) async {
    final Response<dynamic> res;
    try {
      res = await run();
    } on DioException catch (_) {
      throw const AppException('network_error');
    }

    final data = res.data;
    final map = data is Map
        ? Map<String, dynamic>.from(data)
        : <String, dynamic>{};
    final status = res.statusCode ?? 0;

    if (status >= 200 && status < 300 && map['ok'] == true) {
      return map;
    }

    final code = map['error'] is String ? map['error'] as String : 'unknown';
    // App-wide session guard: a dead-session code on a normal authed
    // request drops the token + bounces to /login. Awaited so the clear
    // completes before the exception surfaces. By construction this never
    // fires for current_password_invalid / flag_disabled / etc.
    // Best-effort (like logout()'s local clear): a storage/platform fault
    // in the clear must NOT replace the canonical session error below —
    // the caller always receives the typed AppException(code).
    if (notify && invalidatesSession(code)) {
      try {
        await onSessionInvalid?.call();
      } catch (_) {
        // swallow — AppException(code) is the source of truth
      }
    }
    final retry = map['retry_after'];
    final fieldErrors = map['field_errors'];
    throw AppException(
      code,
      retryAfterSeconds: retry is int ? retry : null,
      fieldErrors: fieldErrors is Map
          ? fieldErrors.map((k, v) => MapEntry('$k', '$v'))
          : null,
    );
  }
}

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    baseUrl: ApiEnv.baseUrl,
    tokenStore: ref.read(tokenStoreProvider),
    // Lazy callback: read at request time (auth is already built by
    // then), so wiring it here creates no provider-construction cycle.
    onSessionInvalid: () =>
        ref.read(authControllerProvider.notifier).invalidate(),
  );
});
