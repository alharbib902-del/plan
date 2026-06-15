import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/config/app_config.dart';
import 'package:aeris_mobile/src/screens/dashboard_sections.dart';

void main() {
  group('visibleSections (flag-gated dashboard)', () {
    test('fail-closed config hides empty-legs + privilege', () {
      final s = visibleSections(AppConfig.failClosed());
      expect(s, isNot(contains(DashboardSection.emptyLegs)));
      expect(s, isNot(contains(DashboardSection.privilege)));
    });

    test('flags on reveal empty-legs + privilege', () {
      final s = visibleSections(AppConfig.fromJson({
        'flags': {'client_empty_legs_portal': true, 'privilege': true},
      }));
      expect(s, contains(DashboardSection.emptyLegs));
      expect(s, contains(DashboardSection.privilege));
    });

    test('core sections are always shown regardless of flags', () {
      for (final config in [
        AppConfig.failClosed(),
        AppConfig.fromJson({
          'flags': {'client_empty_legs_portal': true, 'privilege': true},
        }),
      ]) {
        expect(
          visibleSections(config),
          containsAll([
            DashboardSection.bookings,
            DashboardSection.charter,
            DashboardSection.referrals,
            DashboardSection.profile,
          ]),
        );
      }
    });
  });
}
