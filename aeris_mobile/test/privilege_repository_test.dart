import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/core/api_client.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/core/token_store.dart';
import 'package:aeris_mobile/src/privilege/privilege_repository.dart';

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

PrivilegeRepository repoWith(int status, Map<String, dynamic> body) {
  return PrivilegeRepository(
    ApiClient(
      baseUrl: 'http://test.local',
      tokenStore: _FakeTokenStore(),
      adapter: _StubAdapter(status, body),
    ),
  );
}

void main() {
  group('dashboard', () {
    test('parses the dashboard tree', () async {
      final d = await repoWith(200, {
        'ok': true,
        'dashboard': {
          'full_name': 'محمد',
          'privilege': {
            'privilege_tier': 'gold',
            'cashback_balance_sar': '1200.00',
            'two_factor_enabled': false,
          },
          'recent_ledger': [
            {'id': 'led-1', 'event_type': 'earn', 'amount_sar': '300.00'},
          ],
          'recent_change_log': [
            {
              'id': 'chg-1',
              'from_tier': 'silver',
              'to_tier': 'gold',
              'reason': 'auto_upgrade',
            },
          ],
        },
      }).dashboard();
      expect(d.fullName, 'محمد');
      expect(d.privilege.tier, 'gold');
      expect(d.privilege.cashbackBalanceSar, 1200.0);
      expect(d.recentLedger.single.eventType, 'earn');
      expect(d.recentChangeLog.single.toTier, 'gold');
    });

    test('throws rpc_failed when the dashboard object is missing', () async {
      await expectLater(
        repoWith(200, {'ok': true}).dashboard(),
        throwsA(isA<AppException>().having((e) => e.code, 'code', 'rpc_failed')),
      );
    });

    test('propagates flag_disabled (ENABLE_PRIVILEGE off)', () async {
      await expectLater(
        repoWith(403, {'ok': false, 'error': 'flag_disabled'}).dashboard(),
        throwsA(
            isA<AppException>().having((e) => e.code, 'code', 'flag_disabled')),
      );
    });
  });

  group('history', () {
    test('parses the ledger array', () async {
      final ledger = await repoWith(200, {
        'ok': true,
        'ledger': [
          {'id': 'led-1', 'event_type': 'earn', 'amount_sar': '300.00'},
          {'id': 'led-2', 'event_type': 'redeem', 'amount_sar': '-100.00'},
        ],
      }).history();
      expect(ledger.length, 2);
      expect(ledger.first.eventType, 'earn');
      expect(ledger[1].amountSar, -100.0);
    });

    test('empty when ledger absent', () async {
      expect(await repoWith(200, {'ok': true}).history(), isEmpty);
    });

    test('propagates flag_disabled', () async {
      await expectLater(
        repoWith(403, {'ok': false, 'error': 'flag_disabled'}).history(),
        throwsA(
            isA<AppException>().having((e) => e.code, 'code', 'flag_disabled')),
      );
    });
  });
}
