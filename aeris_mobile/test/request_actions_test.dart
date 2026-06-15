import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:aeris_mobile/src/charter/charter_repository.dart';
import 'package:aeris_mobile/src/charter/offer.dart';
import 'package:aeris_mobile/src/charter/trip_request.dart';
import 'package:aeris_mobile/src/screens/request_detail_screen.dart';

class MockCharterRepository extends Mock implements CharterRepository {}

({TripRequest request, List<Offer> offers}) _record({
  bool canCancel = false,
  List<Offer> offers = const [],
}) =>
    (
      request: TripRequest(
        id: 'r1',
        requestNumber: 'TR-1',
        status: 'offered',
        canCancel: canCancel,
        canAcceptOffers: true,
      ),
      offers: offers,
    );

const _acceptableOffer = Offer(
  id: 'o1',
  source: 'phase4',
  status: 'pending',
  operatorName: 'Skybridge',
  totalPriceSar: 100000,
  canAccept: true,
  canDecline: true,
);

Future<void> _pump(WidgetTester tester, MockCharterRepository repo) {
  return tester.pumpWidget(
    ProviderScope(
      overrides: [charterRepositoryProvider.overrideWithValue(repo)],
      child: const MaterialApp(
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: RequestDetailScreen(id: 'r1'),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets(
      'accept: confirm runs acceptOffer ONCE (no double-submit), disables the '
      'button while in flight, then refreshes the detail', (tester) async {
    final repo = MockCharterRepository();
    when(() => repo.detail(any()))
        .thenAnswer((_) async => _record(offers: const [_acceptableOffer]));
    final gate = Completer<void>();
    when(() => repo.acceptOffer(
          offerId: any(named: 'offerId'),
          source: any(named: 'source'),
        )).thenAnswer((_) => gate.future);

    await _pump(tester, repo);
    await tester.pumpAndSettle();
    verify(() => repo.detail(any())).called(1); // initial fetch

    await tester.tap(find.widgetWithText(ElevatedButton, 'قبول'));
    await tester.pumpAndSettle(); // confirm dialog
    await tester.tap(find.widgetWithText(TextButton, 'قبول')); // confirm
    await tester.pump(); // action starts; gate still pending

    // Button is disabled while in flight.
    final btn = tester
        .widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'قبول'));
    expect(btn.onPressed, isNull);

    // Drive a SECOND submit attempt — the disabled button must swallow it.
    await tester.tap(find.widgetWithText(ElevatedButton, 'قبول'));
    await tester.pump();

    // Exactly ONE acceptOffer despite two taps → no double-submit.
    verify(() => repo.acceptOffer(offerId: 'o1', source: 'phase4')).called(1);

    gate.complete(); // action resolves → success → refresh
    await tester.pumpAndSettle();
    verify(() => repo.detail(any())).called(1); // ONE more fetch = the refresh
    verifyNoMoreInteractions(repo);
  });

  testWidgets('cancel: confirm runs cancelRequest once then refreshes',
      (tester) async {
    final repo = MockCharterRepository();
    when(() => repo.detail(any()))
        .thenAnswer((_) async => _record(canCancel: true));
    when(() => repo.cancelRequest(any())).thenAnswer((_) async {});

    await _pump(tester, repo);
    await tester.pumpAndSettle();
    verify(() => repo.detail(any())).called(1);

    await tester.tap(find.widgetWithText(OutlinedButton, 'إلغاء الطلب'));
    await tester.pumpAndSettle(); // confirm dialog
    await tester.tap(find.widgetWithText(TextButton, 'إلغاء الطلب')); // confirm
    await tester.pumpAndSettle();

    verify(() => repo.cancelRequest('r1')).called(1);
    verify(() => repo.detail(any())).called(1); // the refresh
  });
}
