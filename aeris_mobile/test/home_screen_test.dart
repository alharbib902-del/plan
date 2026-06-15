import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:aeris_mobile/src/auth/auth_controller.dart';
import 'package:aeris_mobile/src/auth/session.dart';
import 'package:aeris_mobile/src/config/app_config.dart';
import 'package:aeris_mobile/src/screens/home_screen.dart';

class _StubAuthController extends AuthController {
  @override
  Future<AuthStatus> build() async => const Authenticated(
        ClientSession(
          clientId: 'c1',
          fullName: 'عميل',
          contactPhone: '+966500000000',
          expiresAt: '2026-07-01T00:00:00Z',
          passwordMustChange: false,
        ),
      );
}

void main() {
  testWidgets(
      'home dashboard renders without overflow at narrow phone widths (all cards)',
      (tester) async {
    addTearDown(tester.view.reset);
    for (final width in [320.0, 360.0, 375.0]) {
      tester.view.physicalSize = Size(width, 800);
      tester.view.devicePixelRatio = 1.0;

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authControllerProvider.overrideWith(_StubAuthController.new),
            // All flags on → all 6 cards (the densest, worst-case layout).
            appConfigProvider.overrideWith(
              (ref) => AppConfig.fromJson({
                'flags': {
                  'client_empty_legs_portal': true,
                  'privilege': true,
                },
              }),
            ),
          ],
          child: const MaterialApp(
            home: Directionality(
              textDirection: TextDirection.rtl,
              child: HomeScreen(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        tester.takeException(),
        isNull,
        reason: 'RenderFlex overflow at ${width}px',
      );
    }
  });

  testWidgets('shows the limited-mode banner when /config fails (S9)',
      (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_StubAuthController.new),
          // /config resolved-but-FAILED → AsyncError → fail-closed + banner.
          appConfigProvider.overrideWith(
            (ref) => Future<AppConfig>.error(Exception('config down')),
          ),
        ],
        child: const MaterialApp(
          home: Directionality(
            textDirection: TextDirection.rtl,
            child: HomeScreen(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('وضع محدود'), findsOneWidget);
  });

  testWidgets('NO limited-mode banner while /config is still loading (S9)',
      (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_StubAuthController.new),
          // Never completes → perpetual AsyncLoading (hasError == false).
          appConfigProvider.overrideWith((ref) => Completer<AppConfig>().future),
        ],
        child: const MaterialApp(
          home: Directionality(
            textDirection: TextDirection.rtl,
            child: HomeScreen(),
          ),
        ),
      ),
    );
    await tester.pump(); // one frame — do NOT settle (future never completes)

    expect(find.textContaining('وضع محدود'), findsNothing);
  });

  testWidgets('tapping the "حجوزاتي" card navigates to /bookings',
      (tester) async {
    // Minimal router: home at '/', a sentinel at '/bookings' so we assert
    // the navigation happened without standing up the real bookings stack.
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
        GoRoute(
          path: '/bookings',
          builder: (_, _) => const Directionality(
            textDirection: TextDirection.rtl,
            child: Text('BOOKINGS_SENTINEL'),
          ),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_StubAuthController.new),
          appConfigProvider.overrideWith((ref) => AppConfig.failClosed()),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('حجوزاتي'));
    await tester.pumpAndSettle();

    expect(find.text('BOOKINGS_SENTINEL'), findsOneWidget);
  });

  testWidgets('tapping the "رحلة خاصة" card navigates to /requests',
      (tester) async {
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
        GoRoute(
          path: '/requests',
          builder: (_, _) => const Directionality(
            textDirection: TextDirection.rtl,
            child: Text('REQUESTS_SENTINEL'),
          ),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_StubAuthController.new),
          appConfigProvider.overrideWith((ref) => AppConfig.failClosed()),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('رحلة خاصة'));
    await tester.pumpAndSettle();

    expect(find.text('REQUESTS_SENTINEL'), findsOneWidget);
  });
}
