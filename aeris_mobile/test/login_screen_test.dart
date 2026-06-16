import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/config/app_config.dart';
import 'package:aeris_mobile/src/screens/login_screen.dart';

const _guestEntry = 'تصفّح الرحلات الفارغة كضيف';

Widget _app(AppConfig config) => ProviderScope(
      overrides: [appConfigProvider.overrideWith((ref) => config)],
      child: const MaterialApp(
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: LoginScreen(),
        ),
      ),
    );

void main() {
  testWidgets('guest-browse entry is SHOWN when public_marketplace is on',
      (tester) async {
    await tester.pumpWidget(
      _app(AppConfig.fromJson({
        'flags': {'public_marketplace': true},
      })),
    );
    await tester.pumpAndSettle();
    expect(find.text(_guestEntry), findsOneWidget);
  });

  testWidgets('guest-browse entry is HIDDEN when public_marketplace is off '
      '(fail-closed)', (tester) async {
    await tester.pumpWidget(_app(AppConfig.failClosed()));
    await tester.pumpAndSettle();
    expect(find.text(_guestEntry), findsNothing);
  });
}
