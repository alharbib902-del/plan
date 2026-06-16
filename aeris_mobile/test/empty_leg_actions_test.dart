import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:aeris_mobile/src/empty_legs/alert.dart';
import 'package:aeris_mobile/src/empty_legs/empty_leg.dart';
import 'package:aeris_mobile/src/empty_legs/empty_legs_repository.dart';
import 'package:aeris_mobile/src/screens/empty_leg_detail_screen.dart';
import 'package:aeris_mobile/src/screens/empty_legs_screen.dart';

class MockEmptyLegsRepository extends Mock implements EmptyLegsRepository {}

EmptyLeg _availableLeg() => const EmptyLeg(
      id: 'el-1',
      legNumber: 'EL-1',
      status: 'available',
      departureIata: 'RUH',
      arrivalIata: 'JED',
      isReserved: false,
      isReservedByMe: false,
    );

void main() {
  testWidgets(
      'reserve: confirm runs reserveLeg ONCE (no double-submit), disables the '
      'button while in flight, then refreshes the detail', (tester) async {
    final repo = MockEmptyLegsRepository();
    when(() => repo.legDetail(any())).thenAnswer((_) async => _availableLeg());
    final gate = Completer<void>();
    when(() => repo.reserveLeg(any())).thenAnswer((_) => gate.future);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [emptyLegsRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(
          home: Directionality(
            textDirection: TextDirection.rtl,
            child: EmptyLegDetailScreen(legNumber: 'EL-1'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    verify(() => repo.legDetail(any())).called(1); // initial fetch

    await tester.tap(find.widgetWithText(ElevatedButton, 'احجز الآن'));
    await tester.pumpAndSettle(); // confirm dialog
    await tester.tap(find.widgetWithText(TextButton, 'احجز')); // confirm
    await tester.pump(); // action starts; gate pending

    // Button disabled while in flight.
    final btn = tester
        .widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'احجز الآن'));
    expect(btn.onPressed, isNull);

    // Second tap must be swallowed.
    await tester.tap(find.widgetWithText(ElevatedButton, 'احجز الآن'));
    await tester.pump();

    verify(() => repo.reserveLeg('el-1')).called(1); // exactly once

    gate.complete(); // success → refresh
    await tester.pumpAndSettle();
    verify(() => repo.legDetail(any())).called(1); // the refresh
    verifyNoMoreInteractions(repo); // no stray list/matches refetch, etc.
  });

  testWidgets(
      'alerts: a SUCCESSFUL delete leaves the tab interactive (regression: the '
      'shared _busy must reset since the State is not torn down)',
      (tester) async {
    final repo = MockEmptyLegsRepository();
    when(() => repo.listLegs()).thenAnswer((_) async => const []);
    when(() => repo.matches()).thenAnswer((_) async => const []);
    when(() => repo.listAlerts()).thenAnswer((_) async => const [
          Alert(id: 'a1', originIata: 'RUH', destinationIata: 'JED'),
          Alert(id: 'a2', originIata: 'DMM', destinationIata: 'JED'),
        ]);
    when(() => repo.deleteAlert(any())).thenAnswer((_) async {});

    await tester.pumpWidget(
      ProviderScope(
        overrides: [emptyLegsRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(
          home: Directionality(
            textDirection: TextDirection.rtl,
            child: EmptyLegsScreen(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Go to the "تنبيهاتي" tab.
    await tester.tap(find.text('تنبيهاتي'));
    await tester.pumpAndSettle();
    expect(find.byType(Switch), findsNWidgets(2));

    // Delete the first alert and confirm.
    await tester.tap(find.byIcon(Icons.delete_outline).first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'حذف'));
    await tester.pumpAndSettle();

    verify(() => repo.deleteAlert('a1')).called(1);

    // The tab must NOT be locked: the new-alert button and the surviving
    // rows' switches stay enabled. (Pre-fix, _busy stayed true forever.)
    // ElevatedButton.icon yields a subtype, so match by predicate, not byType.
    final newAlertBtn = tester.widget<ElevatedButton>(
      find.ancestor(
        of: find.text('تنبيه سعر جديد'),
        matching: find.byWidgetPredicate((w) => w is ElevatedButton),
      ),
    );
    expect(newAlertBtn.onPressed, isNotNull);
    final anySwitch = tester.widget<Switch>(find.byType(Switch).first);
    expect(anySwitch.onChanged, isNotNull);
  });
}
