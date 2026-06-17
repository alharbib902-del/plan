import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:aeris_mobile/src/config/app_config.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/notifications/notification_prefs.dart';
import 'package:aeris_mobile/src/notifications/notifications_repository.dart';
import 'package:aeris_mobile/src/screens/notifications_screen.dart';

class MockNotificationsRepository extends Mock
    implements NotificationsRepository {}

// email OFF, wa_link OFF, marketing ON — so toggling email leaves marketing
// untouched, letting us prove the PATCH still carries it (full replacement).
const _prefs = NotificationPrefs(
  emptyLegsEmail: false,
  emptyLegsWaLink: false,
  marketing: true,
);

const _pushLabel = 'إشعارات الجهاز (Push)';

Widget _app(NotificationsRepository repo, {bool pushEnabled = false}) =>
    ProviderScope(
      overrides: [
        notificationsRepositoryProvider.overrideWithValue(repo),
        // The screen now reads appConfig for the push-toggle gate; override it
        // (fail-closed by default → push toggle hidden).
        appConfigProvider.overrideWith(
          (ref) => pushEnabled
              ? AppConfig.fromJson({
                  'flags': {'push_notifications': true},
                })
              : AppConfig.failClosed(),
        ),
      ],
      child: const MaterialApp(
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: NotificationsScreen(),
        ),
      ),
    );

void main() {
  setUpAll(() => registerFallbackValue(const NotificationPrefs()));

  testWidgets(
      'save sends the FULL object (all keys, incl. the UNCHANGED marketing — '
      'not a partial patch), once, disabled in flight, then refreshes',
      (tester) async {
    final repo = MockNotificationsRepository();
    when(() => repo.getPrefs()).thenAnswer((_) async => _prefs);
    final gate = Completer<void>();
    when(() => repo.updatePrefs(any())).thenAnswer((_) => gate.future);

    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();
    verify(() => repo.getPrefs()).called(1); // initial load

    // Save disabled until something changes.
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNull,
    );

    // Toggle ONLY the email switch (the first tile).
    await tester.tap(find.byType(SwitchListTile).first);
    await tester.pump();
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNotNull,
    );

    await tester.tap(find.widgetWithText(ElevatedButton, 'حفظ'));
    await tester.pump(); // save starts; gate pending

    // Disabled while in flight (primary double-submit defense): both the Save
    // button AND every switch are locked.
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNull,
    );
    expect(
      tester.widget<SwitchListTile>(find.byType(SwitchListTile).first).onChanged,
      isNull,
    );
    await tester.tap(find.byType(ElevatedButton)); // swallowed
    await tester.pump();

    // MANDATORY: exactly one call, carrying the COMPLETE object — the changed
    // email AND the unchanged wa_link + marketing, never just the toggle.
    final captured =
        verify(() => repo.updatePrefs(captureAny())).captured;
    expect(captured.length, 1);
    final sent = (captured.single as NotificationPrefs).toJson();
    expect(sent.keys.toSet(), {'empty_legs', 'marketing'});
    // Full shape ALWAYS includes push (sent even while the toggle is hidden) —
    // the PR2 backward-compat payload.
    expect((sent['empty_legs'] as Map).keys.toSet(),
        {'email', 'wa_link', 'push'});
    expect((sent['empty_legs'] as Map)['email'], true); // the change
    expect((sent['empty_legs'] as Map)['wa_link'], false); // unchanged
    expect((sent['empty_legs'] as Map)['push'], false); // unchanged, still sent
    expect(sent['marketing'], true); // UNCHANGED, still sent

    gate.complete(); // success → refresh
    await tester.pumpAndSettle();
    verify(() => repo.getPrefs()).called(1); // the re-read
  });

  testWidgets(
      'save failure keeps the toggles and shows the rate_limited retry seconds',
      (tester) async {
    final repo = MockNotificationsRepository();
    when(() => repo.getPrefs()).thenAnswer((_) async => _prefs);
    when(() => repo.updatePrefs(any())).thenAnswer(
      (_) async =>
          throw const AppException('rate_limited', retryAfterSeconds: 45),
    );

    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(SwitchListTile).first); // email → ON
    await tester.pump();
    await tester.tap(find.widgetWithText(ElevatedButton, 'حفظ'));
    await tester.pumpAndSettle();

    // Toggle preserved (not reset on failure).
    expect(
      tester.widget<SwitchListTile>(find.byType(SwitchListTile).first).value,
      isTrue,
    );
    // Error surfaces the retry seconds.
    expect(find.textContaining('45'), findsOneWidget);
    // No refresh — only the initial load.
    verify(() => repo.getPrefs()).called(1);
    verify(() => repo.updatePrefs(any())).called(1);
  });

  testWidgets('the "Push" toggle is HIDDEN when push_notifications is off '
      '(fail-closed)', (tester) async {
    final repo = MockNotificationsRepository();
    when(() => repo.getPrefs()).thenAnswer((_) async => _prefs);
    await tester.pumpWidget(_app(repo)); // pushEnabled: false
    await tester.pumpAndSettle();
    expect(find.text(_pushLabel), findsNothing);
  });

  testWidgets('the "Push" toggle is SHOWN when push_notifications is enabled',
      (tester) async {
    final repo = MockNotificationsRepository();
    when(() => repo.getPrefs()).thenAnswer((_) async => _prefs);
    await tester.pumpWidget(_app(repo, pushEnabled: true));
    await tester.pumpAndSettle();
    expect(find.text(_pushLabel), findsOneWidget);
  });

  testWidgets(
      'toggling the Push switch ALONE enables Save and sends push:true '
      '(proves the toggle is wired to the push field)', (tester) async {
    final repo = MockNotificationsRepository();
    when(() => repo.getPrefs()).thenAnswer((_) async => _prefs); // push:false
    when(() => repo.updatePrefs(any())).thenAnswer((_) async {});

    await tester.pumpWidget(_app(repo, pushEnabled: true));
    await tester.pumpAndSettle();

    // Save disabled until something changes.
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNull,
    );

    // Toggle ONLY the Push switch.
    await tester.tap(find.widgetWithText(SwitchListTile, _pushLabel));
    await tester.pump();
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNotNull,
    );

    await tester.tap(find.widgetWithText(ElevatedButton, 'حفظ'));
    await tester.pumpAndSettle();

    final captured = verify(() => repo.updatePrefs(captureAny())).captured;
    final sent = (captured.single as NotificationPrefs).toJson();
    expect((sent['empty_legs'] as Map)['push'], true); // the push change
    expect((sent['empty_legs'] as Map)['email'], false); // unchanged
    expect(sent['marketing'], true); // unchanged
  });
}
