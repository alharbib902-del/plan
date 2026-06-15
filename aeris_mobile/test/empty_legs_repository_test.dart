import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';
import 'package:aeris_mobile/src/empty_legs/empty_legs_repository.dart';

class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.statusCode, this.body);
  final int statusCode;
  final Map<String, dynamic> body;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
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
  Future<String?> read() async => 'tok';
  @override
  Future<void> write(String token) async {}
  @override
  Future<void> clear() async {}
}

EmptyLegsRepository repoWith(int status, Map<String, dynamic> body) {
  return EmptyLegsRepository(
    ApiClient(
      baseUrl: 'http://test.local',
      tokenStore: _FakeTokenStore(),
      adapter: _StubAdapter(status, body),
    ),
  );
}

void main() {
  group('listLegs', () {
    test('parses the legs array', () async {
      final legs = await repoWith(200, {
        'ok': true,
        'pricing_visible': true,
        'legs': [
          {'id': 'el-1', 'leg_number': 'EL-1', 'status': 'available'},
          {'id': 'el-2', 'leg_number': 'EL-2', 'status': 'reserved'},
        ],
      }).listLegs();
      expect(legs.length, 2);
      expect(legs.first.legNumber, 'EL-1');
    });

    test('empty when legs absent', () async {
      expect(await repoWith(200, {'ok': true}).listLegs(), isEmpty);
    });

    test('propagates flag_disabled (portal off)', () async {
      await expectLater(
        repoWith(403, {'ok': false, 'error': 'flag_disabled'}).listLegs(),
        throwsA(isA<AppException>().having((e) => e.code, 'code', 'flag_disabled')),
      );
    });
  });

  group('matches', () {
    test('parses the matches array', () async {
      final matches = await repoWith(200, {
        'ok': true,
        'pricing_visible': false,
        'matches': [
          {
            'notification': {'id': 'n1', 'event_type': 'new_match'},
            'leg': {'id': 'el-9', 'leg_number': 'EL-9', 'status': 'available'},
          },
        ],
      }).matches();
      expect(matches.length, 1);
      expect(matches.first.leg.legNumber, 'EL-9');
    });

    test('empty when matches absent', () async {
      expect(await repoWith(200, {'ok': true}).matches(), isEmpty);
    });
  });

  group('legDetail', () {
    test('parses the leg', () async {
      final leg = await repoWith(200, {
        'ok': true,
        'pricing_visible': true,
        'leg': {'id': 'el-5', 'leg_number': 'EL-5', 'status': 'available'},
      }).legDetail('EL-5');
      expect(leg.legNumber, 'EL-5');
    });

    test('maps a 404 to leg_not_found', () async {
      await expectLater(
        repoWith(404, {'ok': false, 'error': 'leg_not_found'}).legDetail('EL-X'),
        throwsA(isA<AppException>().having((e) => e.code, 'code', 'leg_not_found')),
      );
    });
  });
}
