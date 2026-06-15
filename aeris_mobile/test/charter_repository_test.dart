import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/charter/charter_repository.dart';
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

CharterRepository repoWith(int status, Map<String, dynamic> body) {
  return CharterRepository(
    ApiClient(
      baseUrl: 'http://test.local',
      tokenStore: _FakeTokenStore(),
      adapter: _StubAdapter(status, body),
    ),
  );
}

void main() {
  group('listRequests', () {
    test('parses the requests array', () async {
      final repo = repoWith(200, {
        'ok': true,
        'requests': [
          {'id': 'r1', 'request_number': 'TR-1', 'status': 'pending'},
          {'id': 'r2', 'request_number': 'TR-2', 'status': 'offered'},
        ],
      });
      final list = await repo.listRequests();
      expect(list.length, 2);
      expect(list.first.id, 'r1');
    });

    test('empty when requests absent', () async {
      expect(await repoWith(200, {'ok': true}).listRequests(), isEmpty);
    });

    test('propagates a server fault', () async {
      await expectLater(
        repoWith(502, {'ok': false, 'error': 'rpc_failed'}).listRequests(),
        throwsA(isA<AppException>().having((e) => e.code, 'code', 'rpc_failed')),
      );
    });
  });

  group('create', () {
    test('returns the new trip_request_id', () async {
      final repo = repoWith(201, {
        'ok': true,
        'trip_request_id': 'new-123',
        'request_number': 'TR-9',
      });
      final id = await repo.create(
        const CreateTripRequestInput(
          departureIata: 'RUH',
          arrivalIata: 'JED',
          departureDateIso: '2026-08-01T12:00:00Z',
          passengers: 2,
        ),
      );
      expect(id, 'new-123');
    });

    test('propagates validation_failed (with the typed code)', () async {
      await expectLater(
        repoWith(400, {'ok': false, 'error': 'validation_failed'}).create(
          const CreateTripRequestInput(
            departureIata: 'RUH',
            arrivalIata: 'JED',
            departureDateIso: '2026-08-01T12:00:00Z',
            passengers: 2,
          ),
        ),
        throwsA(
          isA<AppException>().having((e) => e.code, 'code', 'validation_failed'),
        ),
      );
    });
  });

  group('detail', () {
    test('parses request + offers', () async {
      final repo = repoWith(200, {
        'ok': true,
        'request': {'id': 'r9', 'request_number': 'TR-9', 'status': 'offered'},
        'offers': [
          {'id': 'o1', 'source': 'phase4', 'status': 'pending'},
        ],
      });
      final rec = await repo.detail('r9');
      expect(rec.request.id, 'r9');
      expect(rec.offers.length, 1);
      expect(rec.offers.first.id, 'o1');
    });

    test('empty offers list when absent', () async {
      final repo = repoWith(200, {
        'ok': true,
        'request': {'id': 'r9', 'status': 'pending'},
      });
      final rec = await repo.detail('r9');
      expect(rec.offers, isEmpty);
    });

    test('maps a 404 to request_not_found', () async {
      await expectLater(
        repoWith(404, {'ok': false, 'error': 'request_not_found'}).detail('x'),
        throwsA(
          isA<AppException>().having((e) => e.code, 'code', 'request_not_found'),
        ),
      );
    });
  });

  group('actions (4b)', () {
    test('acceptOffer / declineOffer / cancelRequest succeed on ok:true',
        () async {
      await repoWith(200, {'ok': true})
          .acceptOffer(offerId: 'o1', source: 'phase4');
      await repoWith(200, {'ok': true})
          .declineOffer(offerId: 'o1', source: 'phase4');
      await repoWith(200, {'ok': true}).cancelRequest('r1');
      // no throw == success
    });

    test('acceptOffer propagates a 409 conflict code', () async {
      await expectLater(
        repoWith(409, {'ok': false, 'error': 'offer_not_pending'})
            .acceptOffer(offerId: 'o1', source: 'phase4'),
        throwsA(
          isA<AppException>().having((e) => e.code, 'code', 'offer_not_pending'),
        ),
      );
    });

    test('cancelRequest propagates cancel_not_allowed', () async {
      await expectLater(
        repoWith(409, {'ok': false, 'error': 'cancel_not_allowed'})
            .cancelRequest('r1'),
        throwsA(
          isA<AppException>().having((e) => e.code, 'code', 'cancel_not_allowed'),
        ),
      );
    });

    test('an action surfaces rate_limited WITH retry_after seconds', () async {
      try {
        await repoWith(429, {
          'ok': false,
          'error': 'rate_limited',
          'retry_after': 30,
        }).acceptOffer(offerId: 'o1', source: 'phase4');
        fail('expected an AppException');
      } on AppException catch (e) {
        expect(e.code, 'rate_limited');
        expect(e.retryAfterSeconds, 30);
      }
    });
  });
}
