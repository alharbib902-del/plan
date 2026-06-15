import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

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
}
