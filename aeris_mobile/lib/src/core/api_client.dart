import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_exception.dart';
import 'env.dart';
import 'token_store.dart';

/// Thin Dio wrapper for the `/api/v1/mobile/*` contract.
///
/// Responsibilities:
///   - inject `Authorization: Bearer <token>` from secure storage
///     on requests flagged `auth: true`,
///   - normalise the `{ ok, error }` envelope + HTTP status into a
///     typed [AppException] (so the UI never parses raw responses),
///   - map transport/timeout faults to `network_error`.
class ApiClient {
  ApiClient({required String baseUrl, required TokenStore tokenStore})
    : _tokenStore = tokenStore,
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

  Future<Map<String, dynamic>> getJson(String path, {bool auth = true}) {
    return _send(() => _dio.get<dynamic>(path, options: _opts(auth)));
  }

  Future<Map<String, dynamic>> postJson(
    String path,
    Map<String, dynamic> body, {
    bool auth = true,
  }) {
    return _send(
      () => _dio.post<dynamic>(path, data: body, options: _opts(auth)),
    );
  }

  Options _opts(bool auth) => Options(extra: {'auth': auth});

  Future<Map<String, dynamic>> _send(
    Future<Response<dynamic>> Function() run,
  ) async {
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
  );
});
