import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';
import 'package:aeris_mobile/src/push/device_tokens_repository.dart';

/// Captures path/method/body so we verify the exact PR1 wire contract.
class _CapturingAdapter implements HttpClientAdapter {
  _CapturingAdapter(this.statusCode, this.body);
  final int statusCode;
  final Map<String, dynamic> body;
  String? capturedPath;
  String? capturedMethod;
  String? capturedBody;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    capturedPath = options.path;
    capturedMethod = options.method;
    if (requestStream != null) {
      final chunks = await requestStream.toList();
      capturedBody = utf8.decode(chunks.expand((c) => c).toList());
    }
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

({DeviceTokensRepository repo, _CapturingAdapter adapter}) makeRepo(
  int status,
  Map<String, dynamic> body,
) {
  final adapter = _CapturingAdapter(status, body);
  final repo = DeviceTokensRepository(
    ApiClient(
      baseUrl: 'http://test.local',
      tokenStore: _FakeTokenStore(),
      adapter: adapter,
    ),
  );
  return (repo: repo, adapter: adapter);
}

void main() {
  group('register', () {
    test('POSTs {token, platform} to /me/device-tokens', () async {
      final m = makeRepo(200, {'ok': true});
      await m.repo.register(token: 'abc', platform: 'android');
      expect(m.adapter.capturedMethod, 'POST');
      expect(m.adapter.capturedPath, '/api/v1/mobile/me/device-tokens');
      expect(jsonDecode(m.adapter.capturedBody!),
          {'token': 'abc', 'platform': 'android'});
    });

    test('surfaces the server error code (e.g. flag off)', () async {
      final m = makeRepo(403, {'ok': false, 'error': 'flag_disabled'});
      await expectLater(
        m.repo.register(token: 'abc', platform: 'ios'),
        throwsA(
            isA<AppException>().having((e) => e.code, 'code', 'flag_disabled')),
      );
    });
  });

  group('unregister', () {
    test('DELETEs {token} in the BODY (not the URL)', () async {
      final m = makeRepo(200, {'ok': true});
      await m.repo.unregister(token: 'abc');
      expect(m.adapter.capturedMethod, 'DELETE');
      expect(m.adapter.capturedPath, '/api/v1/mobile/me/device-tokens');
      expect(jsonDecode(m.adapter.capturedBody!), {'token': 'abc'});
      // The sensitive token must never appear in the path/query.
      expect(m.adapter.capturedPath!.contains('abc'), isFalse);
    });

    test('surfaces validation_failed', () async {
      final m = makeRepo(400, {'ok': false, 'error': 'validation_failed'});
      await expectLater(
        m.repo.unregister(token: 'abc'),
        throwsA(isA<AppException>()
            .having((e) => e.code, 'code', 'validation_failed')),
      );
    });
  });
}
