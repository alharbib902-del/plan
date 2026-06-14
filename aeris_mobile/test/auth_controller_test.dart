import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:aeris_mobile/src/auth/auth_controller.dart';
import 'package:aeris_mobile/src/auth/auth_repository.dart';
import 'package:aeris_mobile/src/auth/session.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

ClientSession _session({bool mustChange = false}) => ClientSession(
      clientId: 'c1',
      fullName: 'عميل',
      contactPhone: '+966500000000',
      expiresAt: '2026-07-01T00:00:00Z',
      passwordMustChange: mustChange,
    );

ProviderContainer _containerWith(MockAuthRepository repo) {
  final c = ProviderContainer(
    overrides: [authRepositoryProvider.overrideWithValue(repo)],
  );
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('AuthController session-clearing (founder non-negotiable, wired)', () {
    test('build clears the token + lands Unauthenticated for each death code',
        () async {
      for (final code in const [
        'missing_token',
        'invalid_session',
        'session_expired',
      ]) {
        final repo = MockAuthRepository();
        when(() => repo.hasToken()).thenAnswer((_) async => true);
        when(() => repo.fetchSession()).thenThrow(AppException(code));
        when(() => repo.clearToken()).thenAnswer((_) async {});

        final c = _containerWith(repo);
        final status = await c.read(authControllerProvider.future);

        expect(status, isA<Unauthenticated>(), reason: code);
        verify(() => repo.clearToken()).called(1);
      }
    });

    test('build does NOT clear the token for non-death faults', () async {
      for (final code in const [
        'flag_disabled',
        'account_not_active',
        'network_error',
      ]) {
        final repo = MockAuthRepository();
        when(() => repo.hasToken()).thenAnswer((_) async => true);
        when(() => repo.fetchSession()).thenThrow(AppException(code));
        when(() => repo.clearToken()).thenAnswer((_) async {});

        final c = _containerWith(repo);
        await expectLater(
          c.read(authControllerProvider.future),
          throwsA(isA<AppException>()),
          reason: code,
        );
        verifyNever(() => repo.clearToken());
      }
    });

    test(
        'changePassword returns the error and KEEPS the session on current_password_invalid',
        () async {
      final repo = MockAuthRepository();
      when(() => repo.hasToken()).thenAnswer((_) async => true);
      when(() => repo.fetchSession())
          .thenAnswer((_) async => _session(mustChange: true));
      when(() => repo.changePassword(
            currentPassword: any(named: 'currentPassword'),
            newPassword: any(named: 'newPassword'),
          )).thenThrow(const AppException('current_password_invalid'));
      when(() => repo.clearToken()).thenAnswer((_) async {});

      final c = _containerWith(repo);
      await c.read(authControllerProvider.future); // settle → MustChangePassword

      final err = await c.read(authControllerProvider.notifier).changePassword(
            currentPassword: 'wrong',
            newPassword: 'NewPassw0rd',
          );

      expect(err, isA<AppException>());
      expect(err!.code, 'current_password_invalid');
      verifyNever(() => repo.clearToken());
      // Still locked, NOT logged out.
      expect(
        c.read(authControllerProvider).valueOrNull,
        isA<MustChangePassword>(),
      );
    });

    test('changePassword success re-resolves to Authenticated (unlock)',
        () async {
      var unlocked = false;
      final repo = MockAuthRepository();
      when(() => repo.hasToken()).thenAnswer((_) async => true);
      when(() => repo.fetchSession())
          .thenAnswer((_) async => _session(mustChange: !unlocked));
      when(() => repo.changePassword(
            currentPassword: any(named: 'currentPassword'),
            newPassword: any(named: 'newPassword'),
          )).thenAnswer((_) async => unlocked = true);

      final c = _containerWith(repo);
      await c.read(authControllerProvider.future); // MustChangePassword

      final err = await c.read(authControllerProvider.notifier).changePassword(
            currentPassword: 'old',
            newPassword: 'NewPassw0rd',
          );

      expect(err, isNull);
      expect(c.read(authControllerProvider).valueOrNull, isA<Authenticated>());
    });

    test('a successful change then a dead-session refetch clears the token',
        () async {
      var changed = false;
      final repo = MockAuthRepository();
      when(() => repo.hasToken()).thenAnswer((_) async => true);
      // Before change: locked. After change: the refetch finds the session dead.
      when(() => repo.fetchSession()).thenAnswer((_) async {
        if (changed) throw const AppException('session_expired');
        return _session(mustChange: true);
      });
      when(() => repo.changePassword(
            currentPassword: any(named: 'currentPassword'),
            newPassword: any(named: 'newPassword'),
          )).thenAnswer((_) async => changed = true);
      when(() => repo.clearToken()).thenAnswer((_) async {});

      final c = _containerWith(repo);
      await c.read(authControllerProvider.future); // MustChangePassword

      final err = await c.read(authControllerProvider.notifier).changePassword(
            currentPassword: 'old',
            newPassword: 'NewPassw0rd',
          );

      expect(err, isNull); // the change itself succeeded
      verify(() => repo.clearToken()).called(1); // refresh() cleared the dead token
      expect(
        c.read(authControllerProvider).valueOrNull,
        isA<Unauthenticated>(),
      );
    });

    test(
        'failed login stays Unauthenticated (NOT AsyncError) and returns the error',
        () async {
      // Regression pin: an AsyncError state would make the router bounce
      // the user to the full-screen /error page instead of showing the
      // inline error on the login form.
      final repo = MockAuthRepository();
      when(() => repo.hasToken()).thenAnswer((_) async => false);
      when(() => repo.login(
            email: any(named: 'email'),
            password: any(named: 'password'),
            rememberMe: any(named: 'rememberMe'),
          )).thenThrow(const AppException('invalid_credentials'));

      final c = _containerWith(repo);
      await c.read(authControllerProvider.future); // settle → Unauthenticated

      final err = await c.read(authControllerProvider.notifier).login(
            email: 'a@b.co',
            password: 'wrong',
          );

      expect(err, isA<AppException>());
      expect(err!.code, 'invalid_credentials');
      final state = c.read(authControllerProvider);
      expect(state.hasError, isFalse,
          reason: 'AsyncError would wrongly bounce to /error');
      expect(state.valueOrNull, isA<Unauthenticated>());
    });

    test('successful login resolves to Authenticated', () async {
      final repo = MockAuthRepository();
      when(() => repo.hasToken()).thenAnswer((_) async => false);
      when(() => repo.login(
            email: any(named: 'email'),
            password: any(named: 'password'),
            rememberMe: any(named: 'rememberMe'),
          )).thenAnswer((_) async => _session(mustChange: false));

      final c = _containerWith(repo);
      await c.read(authControllerProvider.future);

      final err = await c.read(authControllerProvider.notifier).login(
            email: 'a@b.co',
            password: 'right',
          );

      expect(err, isNull);
      expect(c.read(authControllerProvider).valueOrNull, isA<Authenticated>());
    });
  });
}
