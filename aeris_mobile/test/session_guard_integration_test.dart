import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/auth/auth_controller.dart';
import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';

/// Routes by path: /me/session succeeds (so launch resolves to
/// Authenticated with the token retained), every other authed request
/// returns a dead-session 401 (so we can drive the mid-session guard).
class _RoutingStubAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final isSession = options.path.contains('/me/session');
    final body = isSession
        ? {
            'ok': true,
            'session': {
              'client_id': 'c1',
              'full_name': 'عميل',
              'contact_phone': '+966500000000',
              'expires_at': '2026-07-01T00:00:00Z',
              'password_must_change': false,
            },
          }
        : {'ok': false, 'error': 'session_expired'};
    return ResponseBody.fromString(
      jsonEncode(body),
      isSession ? 200 : 401,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _FakeTokenStore implements TokenStore {
  String? _t = 'tok';
  @override
  Future<String?> read() async => _t;
  @override
  Future<void> write(String token) async => _t = token;
  @override
  Future<void> clear() async {
    // Yield a real event-loop turn before mutating — faithfully models the
    // async platform-channel FlutterSecureStorage.delete(). This is what
    // makes the test PROVE the await: with a fire-and-forget guard the
    // token would still read 'tok' at the catch site, turning this test red.
    await Future<void>.delayed(Duration.zero);
    _t = null;
  }
}

void main() {
  test(
      'mid-session dead-session 401 on a data request clears the token + logs out (full real wiring)',
      () async {
    final tokenStore = _FakeTokenStore();
    final container = ProviderContainer(
      overrides: [
        tokenStoreProvider.overrideWithValue(tokenStore),
        // Real ApiClient with the real onSessionInvalid -> AuthController
        // wiring, only the transport stubbed.
        apiClientProvider.overrideWith(
          (ref) => ApiClient(
            baseUrl: 'http://test.local',
            tokenStore: ref.read(tokenStoreProvider),
            onSessionInvalid: () =>
                ref.read(authControllerProvider.notifier).invalidate(),
            adapter: _RoutingStubAdapter(),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    // Launch: /me/session -> 200 -> Authenticated, token retained.
    final status = await container.read(authControllerProvider.future);
    expect(status, isA<Authenticated>());
    expect(await tokenStore.read(), 'tok');

    // A normal authed data request hits a dead session.
    await expectLater(
      container.read(apiClientProvider).getJson('/bookings'),
      throwsA(
        isA<AppException>().having((e) => e.code, 'code', 'session_expired'),
      ),
    );

    // The AWAITED global guard cleared the token AND flipped auth state.
    expect(await tokenStore.read(), isNull);
    expect(
      container.read(authControllerProvider).valueOrNull,
      isA<Unauthenticated>(),
    );
  });
}
