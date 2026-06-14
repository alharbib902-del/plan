import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';

/// Stub transport: returns one canned {status, body} for every request,
/// so the real envelope + session-guard logic runs against a known wire
/// response.
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
  String? _t = 'tok';
  @override
  Future<String?> read() async => _t;
  @override
  Future<void> write(String token) async => _t = token;
  @override
  Future<void> clear() async => _t = null;
}

void main() {
  ApiClient make(
    int status,
    Map<String, dynamic> body,
    void Function() onInvalid,
  ) {
    return ApiClient(
      baseUrl: 'http://test.local',
      tokenStore: _FakeTokenStore(),
      onSessionInvalid: onInvalid,
      adapter: _StubAdapter(status, body),
    );
  }

  group('ApiClient session guard (founder non-negotiable, at the seam)', () {
    test('fires onSessionInvalid for a death code on an authed request', () async {
      for (final code in const [
        'missing_token',
        'invalid_session',
        'session_expired',
      ]) {
        var fired = false;
        final api = make(401, {'ok': false, 'error': code}, () => fired = true);
        await expectLater(
          api.getJson('/me/bookings'),
          throwsA(isA<AppException>()),
        );
        expect(fired, isTrue, reason: '$code must fire the guard');
      }
    });

    test('NEVER fires for current_password_invalid (401 by status; code decides)',
        () async {
      var fired = false;
      final api = make(
        401,
        {'ok': false, 'error': 'current_password_invalid'},
        () => fired = true,
      );
      await expectLater(
        api.postJson('/auth/change-password', const {}),
        throwsA(
          isA<AppException>().having(
            (e) => e.code,
            'code',
            'current_password_invalid',
          ),
        ),
      );
      expect(fired, isFalse);
    });

    test('does NOT fire on the silent /me/session lifecycle call', () async {
      var fired = false;
      final api = make(
        401,
        {'ok': false, 'error': 'session_expired'},
        () => fired = true,
      );
      await expectLater(
        api.getJson('/me/session', silent: true),
        throwsA(isA<AppException>()),
      );
      expect(fired, isFalse);
    });

    test('does NOT fire for unauthenticated (auth:false) requests', () async {
      var fired = false;
      final api = make(
        401,
        {'ok': false, 'error': 'session_expired'},
        () => fired = true,
      );
      await expectLater(
        api.getJson('/config', auth: false),
        throwsA(isA<AppException>()),
      );
      expect(fired, isFalse);
    });

    test('returns the parsed body on success', () async {
      final api = make(200, {'ok': true, 'value': 7}, () {});
      final res = await api.getJson('/me/session', silent: true);
      expect(res['ok'], isTrue);
      expect(res['value'], 7);
    });
  });
}
