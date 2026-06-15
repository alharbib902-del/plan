import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/bookings/bookings_repository.dart';
import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';

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

BookingsRepository repoWith(int status, Map<String, dynamic> body) {
  return BookingsRepository(
    ApiClient(
      baseUrl: 'http://test.local',
      tokenStore: _FakeTokenStore(),
      adapter: _StubAdapter(status, body),
    ),
  );
}

void main() {
  group('BookingsRepository.list', () {
    test('parses the bookings array', () async {
      final repo = repoWith(200, {
        'ok': true,
        'bookings': [
          {'id': 'b1', 'booking_number': 'BK-1', 'flight_status': 'completed'},
          {'id': 'b2', 'booking_number': 'BK-2', 'flight_status': 'confirmed'},
        ],
      });
      final list = await repo.list();
      expect(list.length, 2);
      expect(list.first.id, 'b1');
    });

    test('returns empty when bookings is absent/not a list', () async {
      final repo = repoWith(200, {'ok': true});
      expect(await repo.list(), isEmpty);
    });

    test('propagates a server fault as AppException', () async {
      final repo = repoWith(502, {'ok': false, 'error': 'rpc_failed'});
      await expectLater(
        repo.list(),
        throwsA(isA<AppException>().having((e) => e.code, 'code', 'rpc_failed')),
      );
    });
  });

  group('BookingsRepository.detail', () {
    test('parses a single booking', () async {
      final repo = repoWith(200, {
        'ok': true,
        'booking': {'id': 'b9', 'booking_number': 'BK-9'},
      });
      final b = await repo.detail('b9');
      expect(b.id, 'b9');
      expect(b.bookingNumber, 'BK-9');
    });

    test('maps a 404 to booking_not_found', () async {
      final repo = repoWith(404, {'ok': false, 'error': 'booking_not_found'});
      await expectLater(
        repo.detail('missing'),
        throwsA(
          isA<AppException>().having((e) => e.code, 'code', 'booking_not_found'),
        ),
      );
    });
  });
}
