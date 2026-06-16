import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/auth/auth_controller.dart';
import 'package:aeris_mobile/src/auth/session.dart';
import 'package:aeris_mobile/src/router/app_router.dart';

const _session = ClientSession(
  clientId: 'c1',
  fullName: 'عميل',
  contactPhone: '+966500000000',
  expiresAt: '2026-07-01T00:00:00Z',
  passwordMustChange: false,
);

void main() {
  group('isGuestLocation — VERY narrow allowlist (founder condition)', () {
    test('matches ONLY the public list + its :legNumber detail', () {
      expect(isGuestLocation('/guest/empty-legs'), isTrue);
      expect(isGuestLocation('/guest/empty-legs/EL-1001'), isTrue);
    });
    test('rejects any other /guest/* path', () {
      expect(isGuestLocation('/guest'), isFalse);
      expect(isGuestLocation('/guest/foo'), isFalse);
      expect(isGuestLocation('/guest/empty-legsX'), isFalse); // not the prefix
      expect(isGuestLocation('/home'), isFalse);
      expect(isGuestLocation('/empty-legs'), isFalse);
    });
  });

  group('redirectForAuth — UNAUTHENTICATED', () {
    const auth = AsyncData<AuthStatus>(Unauthenticated());

    test('allows /login and the two guest routes (null = stay)', () {
      expect(redirectForAuth(auth, '/login'), isNull);
      expect(redirectForAuth(auth, '/guest/empty-legs'), isNull);
      expect(redirectForAuth(auth, '/guest/empty-legs/EL-9'), isNull);
    });

    test('sends EVERY other route (incl. a non-allowlisted /guest/*) to /login',
        () {
      for (final loc in [
        '/home',
        '/bookings',
        '/empty-legs',
        '/privilege',
        '/profile',
        '/guest',
        '/guest/foo',
      ]) {
        expect(redirectForAuth(auth, loc), '/login', reason: loc);
      }
    });
  });

  group('redirectForAuth — AUTHENTICATED (never mix with guest)', () {
    const auth = AsyncData<AuthStatus>(Authenticated(_session));

    test('bounces guest routes + pre-auth screens to /home', () {
      expect(redirectForAuth(auth, '/guest/empty-legs'), '/home');
      expect(redirectForAuth(auth, '/guest/empty-legs/EL-9'), '/home');
      expect(redirectForAuth(auth, '/login'), '/home');
      expect(redirectForAuth(auth, '/splash'), '/home');
      expect(redirectForAuth(auth, '/change-password'), '/home');
      expect(redirectForAuth(auth, '/error'), '/home');
    });

    test('allows the authed surfaces (null)', () {
      expect(redirectForAuth(auth, '/home'), isNull);
      expect(redirectForAuth(auth, '/empty-legs'), isNull);
      expect(redirectForAuth(auth, '/profile'), isNull);
    });
  });

  group('redirectForAuth — OTHER states', () {
    test('must-change-password locks to /change-password (even off guest)', () {
      const auth = AsyncData<AuthStatus>(MustChangePassword(_session));
      expect(redirectForAuth(auth, '/guest/empty-legs'), '/change-password');
      expect(redirectForAuth(auth, '/home'), '/change-password');
      expect(redirectForAuth(auth, '/change-password'), isNull);
    });

    test('loading → /splash; resolved error → /error', () {
      const loading = AsyncLoading<AuthStatus>();
      expect(redirectForAuth(loading, '/home'), '/splash');
      expect(redirectForAuth(loading, '/splash'), isNull);
      final err = AsyncError<AuthStatus>(Exception('x'), StackTrace.empty);
      expect(redirectForAuth(err, '/home'), '/error');
      expect(redirectForAuth(err, '/error'), isNull);
    });
  });
}
