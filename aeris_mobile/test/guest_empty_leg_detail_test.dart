import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:aeris_mobile/src/empty_legs/empty_leg.dart';
import 'package:aeris_mobile/src/empty_legs/guest_empty_legs_repository.dart';
import 'package:aeris_mobile/src/screens/guest_empty_leg_detail_screen.dart';

// A fake guest repo returning an AVAILABLE leg — proving that even when a leg
// is reservable, the GUEST detail offers NO reserve action (only the login
// wall). Implements the public interface (the private _api is not part of it).
class _FakeGuestRepo implements GuestEmptyLegsRepository {
  @override
  Future<List<EmptyLeg>> listLegs() async => const [];

  @override
  Future<EmptyLeg> legDetail(String legNumber) async => const EmptyLeg(
        id: 'el-1',
        legNumber: 'EL-1',
        status: 'available',
        departureIata: 'RUH',
        arrivalIata: 'JED',
        isReserved: false,
        isReservedByMe: false,
      );
}

void main() {
  testWidgets(
      'guest detail: NO reserve button, shows the "سجّل لتحجز" login wall → /login',
      (tester) async {
    final router = GoRouter(
      initialLocation: '/guest/empty-legs/EL-1',
      routes: [
        GoRoute(
          path: '/guest/empty-legs/:legNumber',
          builder: (_, state) => GuestEmptyLegDetailScreen(
            legNumber: state.pathParameters['legNumber']!,
          ),
        ),
        GoRoute(
          path: '/login',
          builder: (_, _) => const Directionality(
            textDirection: TextDirection.rtl,
            child: Text('LOGIN_SENTINEL'),
          ),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          guestEmptyLegsRepositoryProvider
              .overrideWithValue(_FakeGuestRepo()),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    // It IS an available leg, yet the guest gets NO reserve/release action.
    expect(find.text('احجز الآن'), findsNothing);
    expect(find.text('إلغاء الحجز'), findsNothing);

    // The only CTA is the login wall.
    final cta = find.widgetWithText(ElevatedButton, 'سجّل لتحجز');
    expect(cta, findsOneWidget);

    await tester.tap(cta);
    await tester.pumpAndSettle();
    expect(find.text('LOGIN_SENTINEL'), findsOneWidget);
  });
}
