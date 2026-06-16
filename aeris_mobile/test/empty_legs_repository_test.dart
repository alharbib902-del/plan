import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';
import 'package:aeris_mobile/src/empty_legs/alert.dart';
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

  group('actions (5b)', () {
    test('reserve/release/createAlert/toggle/delete succeed on ok', () async {
      await repoWith(200, {'ok': true}).reserveLeg('leg-1');
      await repoWith(200, {'ok': true}).releaseLeg('leg-1');
      await repoWith(201, {'ok': true}).createAlert(
        const CreateAlertInput(originIata: 'RUH', destinationIata: 'JED'),
      );
      await repoWith(200, {'ok': true}).toggleAlert('a1', false);
      await repoWith(200, {'ok': true}).deleteAlert('a1');
      // no throw == success
    });

    test('reserve propagates a 409 conflict (leg_already_reserved)', () async {
      await expectLater(
        repoWith(409, {'ok': false, 'error': 'leg_already_reserved'})
            .reserveLeg('l'),
        throwsA(isA<AppException>()
            .having((e) => e.code, 'code', 'leg_already_reserved')),
      );
    });

    test('release propagates cancel_not_allowed', () async {
      await expectLater(
        repoWith(409, {'ok': false, 'error': 'cancel_not_allowed'})
            .releaseLeg('l'),
        throwsA(isA<AppException>()
            .having((e) => e.code, 'code', 'cancel_not_allowed')),
      );
    });

    test('createAlert propagates validation_failed', () async {
      await expectLater(
        repoWith(400, {'ok': false, 'error': 'validation_failed'}).createAlert(
          const CreateAlertInput(originIata: 'RUH', destinationIata: 'JED'),
        ),
        throwsA(isA<AppException>()
            .having((e) => e.code, 'code', 'validation_failed')),
      );
    });

    test('an action surfaces rate_limited WITH retry_after', () async {
      try {
        await repoWith(429, {
          'ok': false,
          'error': 'rate_limited',
          'retry_after': 45,
        }).reserveLeg('l');
        fail('expected an AppException');
      } on AppException catch (e) {
        expect(e.code, 'rate_limited');
        expect(e.retryAfterSeconds, 45);
      }
    });

    test('listAlerts parses the alerts array', () async {
      final alerts = await repoWith(200, {
        'ok': true,
        'alerts': [
          {
            'id': 'a1',
            'origin_iata': 'RUH',
            'destination_iata': 'JED',
            'max_price_sar': 50000,
            'is_active': true,
            'channels': ['whatsapp'],
          },
        ],
      }).listAlerts();
      expect(alerts.length, 1);
      expect(alerts.first.originIata, 'RUH');
      expect(alerts.first.maxPriceSar, 50000);
      expect(alerts.first.isActive, isTrue);
    });
  });
}
