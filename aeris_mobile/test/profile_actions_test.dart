import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:aeris_mobile/src/core/app_exception.dart';
import 'package:aeris_mobile/src/profile/profile.dart';
import 'package:aeris_mobile/src/profile/profile_repository.dart';
import 'package:aeris_mobile/src/screens/profile_screen.dart';

class MockProfileRepository extends Mock implements ProfileRepository {}

const _profile = ClientProfile(
  fullName: 'محمد',
  contactPhone: '0500000000',
  authEmail: 'm@example.com',
  marketingOptIn: false,
);

Widget _app(ProfileRepository repo) => ProviderScope(
      overrides: [profileRepositoryProvider.overrideWithValue(repo)],
      child: const MaterialApp(
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: ProfileScreen(),
        ),
      ),
    );

void main() {
  setUpAll(() => registerFallbackValue(
        const UpdateProfileInput(
            fullName: '', phone: '', marketingOptIn: false),
      ));

  testWidgets(
      'save: sends the full payload ONCE (no double-submit), disables the '
      'button while in flight, then refreshes', (tester) async {
    final repo = MockProfileRepository();
    // 1st read = original; the post-save re-read returns the saved value
    // (realistic: the server echoes the persisted profile on GET).
    var reads = 0;
    when(() => repo.getProfile()).thenAnswer((_) async {
      reads++;
      return reads == 1
          ? _profile
          : const ClientProfile(
              fullName: 'محمد الجديد',
              contactPhone: '0500000000',
              authEmail: 'm@example.com',
              marketingOptIn: false,
            );
    });
    final gate = Completer<void>();
    when(() => repo.updateProfile(any())).thenAnswer((_) => gate.future);

    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();
    verify(() => repo.getProfile()).called(1); // initial load

    // Save is disabled until something changes.
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNull,
    );

    // Edit the name → Save enables.
    await tester.enterText(find.byType(TextField).first, 'محمد الجديد');
    await tester.pump();
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNotNull,
    );

    await tester.tap(find.widgetWithText(ElevatedButton, 'حفظ'));
    await tester.pump(); // save starts; gate pending

    // PRIMARY double-submit defense: the button is disabled while in flight.
    // (This assertion is RED if `!_saving` is dropped from onPressed.)
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNull,
    );
    // A second tap on the now-disabled button is swallowed by the framework.
    await tester.tap(find.byType(ElevatedButton));
    await tester.pump();

    verify(() => repo.updateProfile(any())).called(1); // exactly once

    gate.complete(); // success → refresh
    await tester.pumpAndSettle();
    verify(() => repo.getProfile()).called(1); // the re-read
  });

  testWidgets(
      'save failure keeps the edits and shows the rate_limited retry seconds',
      (tester) async {
    final repo = MockProfileRepository();
    when(() => repo.getProfile()).thenAnswer((_) async => _profile);
    when(() => repo.updateProfile(any())).thenAnswer(
      (_) async => throw const AppException('rate_limited',
          retryAfterSeconds: 45),
    );

    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'اسم معدّل');
    await tester.pump();
    await tester.tap(find.widgetWithText(ElevatedButton, 'حفظ'));
    await tester.pumpAndSettle();

    // Edits preserved (not reset on failure).
    expect(find.text('اسم معدّل'), findsOneWidget);
    // Error surfaces the retry seconds.
    expect(find.textContaining('45'), findsOneWidget);
    // No refresh happened — only the initial load.
    verify(() => repo.getProfile()).called(1);
    verify(() => repo.updateProfile(any())).called(1);
  });

  testWidgets('client-side validation blocks the request (name too short)',
      (tester) async {
    final repo = MockProfileRepository();
    when(() => repo.getProfile()).thenAnswer((_) async => _profile);
    when(() => repo.updateProfile(any())).thenAnswer((_) async {});

    await tester.pumpWidget(_app(repo));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'م'); // 1 char < min 2
    await tester.pump();
    await tester.tap(find.widgetWithText(ElevatedButton, 'حفظ'));
    await tester.pump();

    // Field error shows and the repo is NEVER hit (would be called if the
    // client-side _validate were removed).
    expect(find.text('الاسم الكامل قصير جداً'), findsOneWidget);
    verifyNever(() => repo.updateProfile(any()));
  });
}
