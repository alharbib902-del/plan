import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';
import 'package:aeris_mobile/src/profile/profile.dart';
import 'package:aeris_mobile/src/profile/profile_repository.dart';

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

ProfileRepository repoWith(int status, Map<String, dynamic> body) {
  return ProfileRepository(
    ApiClient(
      baseUrl: 'http://test.local',
      tokenStore: _FakeTokenStore(),
      adapter: _StubAdapter(status, body),
    ),
  );
}

void main() {
  group('getProfile', () {
    test('parses the profile object', () async {
      final p = await repoWith(200, {
        'ok': true,
        'profile': {
          'full_name': 'محمد',
          'contact_phone': '0500000000',
          'auth_email': 'm@example.com',
          'marketing_opt_in': true,
        },
      }).getProfile();
      expect(p.fullName, 'محمد');
      expect(p.contactPhone, '0500000000');
      expect(p.authEmail, 'm@example.com');
      expect(p.marketingOptIn, isTrue);
    });

    test('throws client_not_found when profile is missing', () async {
      await expectLater(
        repoWith(404, {'ok': false, 'error': 'client_not_found'}).getProfile(),
        throwsA(isA<AppException>()
            .having((e) => e.code, 'code', 'client_not_found')),
      );
    });
  });

  group('updateProfile', () {
    test('succeeds on ok:true', () async {
      await repoWith(200, {'ok': true}).updateProfile(
        const UpdateProfileInput(
          fullName: 'سارة',
          phone: '0500000000',
          marketingOptIn: false,
        ),
      );
      // no throw == success
    });

    test('propagates validation_failed', () async {
      await expectLater(
        repoWith(400, {'ok': false, 'error': 'validation_failed'}).updateProfile(
          const UpdateProfileInput(
              fullName: 'x', phone: '123456', marketingOptIn: true),
        ),
        throwsA(isA<AppException>()
            .having((e) => e.code, 'code', 'validation_failed')),
      );
    });

    test('surfaces rate_limited WITH retry_after', () async {
      try {
        await repoWith(429, {
          'ok': false,
          'error': 'rate_limited',
          'retry_after': 30,
        }).updateProfile(
          const UpdateProfileInput(
              fullName: 'x', phone: '123456', marketingOptIn: true),
        );
        fail('expected an AppException');
      } on AppException catch (e) {
        expect(e.code, 'rate_limited');
        expect(e.retryAfterSeconds, 30);
      }
    });
  });
}
