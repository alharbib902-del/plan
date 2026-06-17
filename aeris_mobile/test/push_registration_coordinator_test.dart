import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/push/device_tokens_repository.dart';
import 'package:aeris_mobile/src/push/push_registration_coordinator.dart';
import 'package:aeris_mobile/src/push/push_token_source.dart';

class _MockRepo extends Mock implements DeviceTokensRepository {}

class _MockSource extends Mock implements PushTokenSource {}

void main() {
  late _MockRepo repo;
  late _MockSource source;
  late StreamController<String> refresh;

  setUp(() {
    repo = _MockRepo();
    source = _MockSource();
    refresh = StreamController<String>.broadcast();
    when(() => source.platform).thenReturn('android');
    when(() => source.onTokenRefresh).thenAnswer((_) => refresh.stream);
    when(() => source.requestPermission()).thenAnswer((_) async => true);
    when(() => source.getToken()).thenAnswer((_) async => 'tok-1');
    when(() => repo.register(
        token: any(named: 'token'),
        platform: any(named: 'platform'))).thenAnswer((_) async {});
    when(() => repo.unregister(token: any(named: 'token')))
        .thenAnswer((_) async {});
  });

  tearDown(() => refresh.close());

  PushRegistrationCoordinator build() =>
      PushRegistrationCoordinator(repository: repo, source: source);

  group('enable (login + flag on + token present)', () {
    test('registers (token, platform)', () async {
      await build().sync(enabled: true);
      verify(() => repo.register(token: 'tok-1', platform: 'android'))
          .called(1);
    });

    test('permission denied → never registers', () async {
      when(() => source.requestPermission()).thenAnswer((_) async => false);
      await build().sync(enabled: true);
      verifyNever(() => repo.register(
          token: any(named: 'token'), platform: any(named: 'platform')));
    });

    test('null token → never registers', () async {
      when(() => source.getToken()).thenAnswer((_) async => null);
      await build().sync(enabled: true);
      verifyNever(() => repo.register(
          token: any(named: 'token'), platform: any(named: 'platform')));
    });

    test('empty token → never registers', () async {
      when(() => source.getToken()).thenAnswer((_) async => '');
      await build().sync(enabled: true);
      verifyNever(() => repo.register(
          token: any(named: 'token'), platform: any(named: 'platform')));
    });

    test('idempotent — a second enable does not re-register', () async {
      final c = build();
      await c.sync(enabled: true);
      await c.sync(enabled: true);
      verify(() => repo.register(token: 'tok-1', platform: 'android'))
          .called(1);
    });
  });

  group('disable (logout / flag off)', () {
    test('unregisters the registered token', () async {
      final c = build();
      await c.sync(enabled: true);
      await c.sync(enabled: false);
      verify(() => repo.unregister(token: 'tok-1')).called(1);
    });

    test('flag off with nothing registered → does nothing', () async {
      await build().sync(enabled: false);
      verifyNever(() => repo.unregister(token: any(named: 'token')));
    });

    test('cancels the token-refresh subscription', () async {
      final c = build();
      await c.sync(enabled: true);
      expect(refresh.hasListener, isTrue);
      await c.sync(enabled: false);
      // Proves the unsubscribe specifically (not just the _enabled guard).
      expect(refresh.hasListener, isFalse);
    });
  });

  group('concurrency (single-flight serialization)', () {
    test('enable then immediate disable (un-awaited) → ends unregistered',
        () async {
      final c = build();
      // Fire both without awaiting the first — the dangerous interleaving.
      final f1 = c.sync(enabled: true);
      final f2 = c.sync(enabled: false);
      await Future.wait<void>([f1, f2]);
      // Serialized: enable registers tok-1, THEN disable unregisters it — so
      // the device ends unregistered (no leaked live token). Without
      // serialization the disable would no-op (token still null) and the
      // register would leak.
      verify(() => repo.register(token: 'tok-1', platform: 'android'))
          .called(1);
      verify(() => repo.unregister(token: 'tok-1')).called(1);
    });
  });

  group('token refresh', () {
    test('while enabled → registers the new token', () async {
      final c = build();
      await c.sync(enabled: true);
      refresh.add('tok-2');
      await pumpEventQueue();
      verify(() => repo.register(token: 'tok-2', platform: 'android'))
          .called(1);
    });

    test('after disable → ignored', () async {
      final c = build();
      await c.sync(enabled: true);
      await c.sync(enabled: false);
      refresh.add('tok-3');
      await pumpEventQueue();
      verifyNever(() => repo.register(token: 'tok-3', platform: 'android'));
    });

    test('empty refreshed token → no register', () async {
      final c = build();
      await c.sync(enabled: true);
      refresh.add('');
      await pumpEventQueue();
      verifyNever(() => repo.register(token: '', platform: any(named: 'platform')));
    });

    test('re-subscribes after enable→disable→enable (refresh still works)',
        () async {
      final c = build();
      await c.sync(enabled: true);
      await c.sync(enabled: false);
      await c.sync(enabled: true);
      expect(refresh.hasListener, isTrue);
      refresh.add('tok-9');
      await pumpEventQueue();
      verify(() => repo.register(token: 'tok-9', platform: 'android'))
          .called(1);
    });
  });

  group('dispose', () {
    test('cancels the subscription', () async {
      final c = build();
      await c.sync(enabled: true);
      expect(refresh.hasListener, isTrue);
      c.dispose();
      expect(refresh.hasListener, isFalse);
    });
  });

  group('fail-soft (must never break login)', () {
    test('register throws → sync completes normally', () async {
      when(() => repo.register(
              token: any(named: 'token'), platform: any(named: 'platform')))
          .thenThrow(const AppException('network_error'));
      await build().sync(enabled: true); // no throw == pass
    });

    test('unregister throws → sync completes normally', () async {
      when(() => repo.unregister(token: any(named: 'token')))
          .thenThrow(const AppException('network_error'));
      final c = build();
      await c.sync(enabled: true);
      await c.sync(enabled: false); // no throw == pass
    });

    test('requestPermission throws → sync completes, no register', () async {
      when(() => source.requestPermission())
          .thenThrow(const AppException('unknown'));
      await build().sync(enabled: true);
      verifyNever(() => repo.register(
          token: any(named: 'token'), platform: any(named: 'platform')));
    });
  });
}
