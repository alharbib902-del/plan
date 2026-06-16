import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';
import 'package:aeris_mobile/src/referrals/referrals_repository.dart';

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

ReferralsRepository repoWith(int status, Map<String, dynamic> body) {
  return ReferralsRepository(
    ApiClient(
      baseUrl: 'http://test.local',
      tokenStore: _FakeTokenStore(),
      adapter: _StubAdapter(status, body),
    ),
  );
}

void main() {
  group('summary', () {
    test('parses code + share_url + referrals', () async {
      final s = await repoWith(200, {
        'ok': true,
        'code': 'AB12CD',
        'share_url': 'https://aeris.sa/signup?ref=AB12CD',
        'referrals': [
          {'id': 'ref-1', 'status': 'rewarded', 'referrer_reward_sar': 500},
        ],
      }).summary();
      expect(s.code, 'AB12CD');
      expect(s.shareUrl, 'https://aeris.sa/signup?ref=AB12CD');
      expect(s.referrals.single.status, 'rewarded');
      expect(s.referrals.single.referrerRewardSar, 500);
    });

    test('tolerates a null code (soft RPC failure on get-or-create)', () async {
      final s = await repoWith(200, {
        'ok': true,
        'code': null,
        'share_url': null,
        'referrals': [],
      }).summary();
      expect(s.code, isNull);
      expect(s.shareUrl, isNull);
      expect(s.referrals, isEmpty);
    });

    test('propagates rpc_failed', () async {
      await expectLater(
        repoWith(502, {'ok': false, 'error': 'rpc_failed'}).summary(),
        throwsA(
            isA<AppException>().having((e) => e.code, 'code', 'rpc_failed')),
      );
    });
  });
}
