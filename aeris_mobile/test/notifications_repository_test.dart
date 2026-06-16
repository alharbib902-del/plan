import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';
import 'package:aeris_mobile/src/notifications/notification_prefs.dart';
import 'package:aeris_mobile/src/notifications/notifications_repository.dart';

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

NotificationsRepository repoWith(int status, Map<String, dynamic> body) {
  return NotificationsRepository(
    ApiClient(
      baseUrl: 'http://test.local',
      tokenStore: _FakeTokenStore(),
      adapter: _StubAdapter(status, body),
    ),
  );
}

void main() {
  group('getPrefs', () {
    test('parses the preferences object', () async {
      final p = await repoWith(200, {
        'ok': true,
        'preferences': {
          'empty_legs': {'email': true, 'wa_link': false},
          'marketing': true,
        },
      }).getPrefs();
      expect(p.emptyLegsEmail, isTrue);
      expect(p.emptyLegsWaLink, isFalse);
      expect(p.marketing, isTrue);
    });

    test('throws rpc_failed when preferences is missing', () async {
      await expectLater(
        repoWith(502, {'ok': false, 'error': 'rpc_failed'}).getPrefs(),
        throwsA(isA<AppException>().having((e) => e.code, 'code', 'rpc_failed')),
      );
    });
  });

  group('updatePrefs', () {
    test('succeeds on ok:true', () async {
      await repoWith(200, {'ok': true}).updatePrefs(
        const NotificationPrefs(
            emptyLegsEmail: true, emptyLegsWaLink: false, marketing: true),
      );
      // no throw == success
    });

    test('propagates invalid_input (strict validation)', () async {
      await expectLater(
        repoWith(400, {'ok': false, 'error': 'invalid_input'})
            .updatePrefs(const NotificationPrefs()),
        throwsA(
            isA<AppException>().having((e) => e.code, 'code', 'invalid_input')),
      );
    });

    test('surfaces rate_limited WITH retry_after', () async {
      try {
        await repoWith(429, {
          'ok': false,
          'error': 'rate_limited',
          'retry_after': 30,
        }).updatePrefs(const NotificationPrefs());
        fail('expected an AppException');
      } on AppException catch (e) {
        expect(e.code, 'rate_limited');
        expect(e.retryAfterSeconds, 30);
      }
    });
  });
}
