import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';
import 'package:aeris_mobile/src/empty_legs/guest_empty_legs_repository.dart';

class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.statusCode, this.body, {this.onFetch});
  final int statusCode;
  final Map<String, dynamic> body;
  final void Function(RequestOptions)? onFetch;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    onFetch?.call(options);
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _FakeTokenStore implements TokenStore {
  @override
  Future<String?> read() async => 'tok'; // present, but guest calls auth:false
  @override
  Future<void> write(String token) async {}
  @override
  Future<void> clear() async {}
}

GuestEmptyLegsRepository repoWith(
  int status,
  Map<String, dynamic> body, {
  void Function(RequestOptions)? onFetch,
}) {
  return GuestEmptyLegsRepository(
    ApiClient(
      baseUrl: 'http://test.local',
      tokenStore: _FakeTokenStore(),
      adapter: _StubAdapter(status, body, onFetch: onFetch),
    ),
  );
}

void main() {
  group('listLegs (public)', () {
    test('parses the legs array', () async {
      final legs = await repoWith(200, {
        'ok': true,
        'pricing_visible': true,
        'legs': [
          {'id': 'el-1', 'leg_number': 'EL-1', 'status': 'available'},
          {'id': 'el-2', 'leg_number': 'EL-2', 'status': 'sold'},
        ],
      }).listLegs();
      expect(legs.length, 2);
      expect(legs.first.legNumber, 'EL-1');
    });

    test('NO Authorization header is sent (guest = auth:false)', () async {
      RequestOptions? seen;
      await repoWith(200, {'ok': true, 'legs': []},
          onFetch: (o) => seen = o).listLegs();
      expect(seen, isNotNull);
      // header keys are lower-cased by dio; assert none is authorization
      final hasAuth = seen!.headers.keys
          .any((k) => k.toLowerCase() == 'authorization');
      expect(hasAuth, isFalse);
    });

    test('empty when legs absent', () async {
      expect(await repoWith(200, {'ok': true}).listLegs(), isEmpty);
    });

    test('propagates flag_disabled (public marketplace off)', () async {
      await expectLater(
        repoWith(403, {'ok': false, 'error': 'flag_disabled'}).listLegs(),
        throwsA(
            isA<AppException>().having((e) => e.code, 'code', 'flag_disabled')),
      );
    });

    test('a session-invalidating code on a GUEST call NEVER fires '
        'onSessionInvalid (auth:false disarms the guard — no token clear)',
        () async {
      var cleared = false;
      final repo = GuestEmptyLegsRepository(
        ApiClient(
          baseUrl: 'http://test.local',
          tokenStore: _FakeTokenStore(),
          onSessionInvalid: () async => cleared = true,
          // Even if the server somehow returns a session-death code on the
          // public route, the guest call must not touch auth state.
          adapter: _StubAdapter(401, {'ok': false, 'error': 'session_expired'}),
        ),
      );
      await expectLater(
        repo.listLegs(),
        throwsA(isA<AppException>()
            .having((e) => e.code, 'code', 'session_expired')),
      );
      // RED if a guest call were ever switched to auth:true.
      expect(cleared, isFalse);
    });
  });

  group('legDetail (public)', () {
    test('parses the leg', () async {
      final leg = await repoWith(200, {
        'ok': true,
        'pricing_visible': false,
        'leg': {'id': 'el-5', 'leg_number': 'EL-5', 'status': 'expired'},
      }).legDetail('EL-5');
      expect(leg.legNumber, 'EL-5');
      expect(leg.status, 'expired');
    });

    test('maps a 404 to leg_not_found', () async {
      await expectLater(
        repoWith(404, {'ok': false, 'error': 'leg_not_found'}).legDetail('EL-X'),
        throwsA(
            isA<AppException>().having((e) => e.code, 'code', 'leg_not_found')),
      );
    });
  });
}
