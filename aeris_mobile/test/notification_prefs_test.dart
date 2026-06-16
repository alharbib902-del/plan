import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/notifications/notification_prefs.dart';

void main() {
  group('NotificationPrefs.fromJson', () {
    test('reads nested empty_legs + marketing', () {
      final p = NotificationPrefs.fromJson({
        'empty_legs': {'email': true, 'wa_link': false},
        'marketing': true,
      });
      expect(p.emptyLegsEmail, isTrue);
      expect(p.emptyLegsWaLink, isFalse);
      expect(p.marketing, isTrue);
    });

    test('defaults every flag to false on a missing/partial payload', () {
      final p = NotificationPrefs.fromJson(const {});
      expect(p.emptyLegsEmail, isFalse);
      expect(p.emptyLegsWaLink, isFalse);
      expect(p.marketing, isFalse);
    });

    test('coerces strictly to bool (a non-true value is false) + ignores '
        'unknown keys', () {
      final p = NotificationPrefs.fromJson({
        'empty_legs': {'email': 'true', 'wa_link': 1, 'unknown': true},
        'marketing': 'yes',
        'extra': 'ignored',
      });
      expect(p.emptyLegsEmail, isFalse); // 'true' string is NOT true
      expect(p.emptyLegsWaLink, isFalse); // 1 is NOT true
      expect(p.marketing, isFalse);
    });
  });

  group('NotificationPrefs.toJson — STRICT FULL REPLACEMENT', () {
    test('ALWAYS emits all three keys, never a partial patch', () {
      final json = const NotificationPrefs(
        emptyLegsEmail: true,
        emptyLegsWaLink: false,
        marketing: false,
      ).toJson();
      expect(json.keys.toSet(), {'empty_legs', 'marketing'});
      final el = json['empty_legs'] as Map;
      expect(el.keys.toSet(), {'email', 'wa_link'});
      expect(el['email'], true);
      expect(el['wa_link'], false);
      expect(json['marketing'], false);
    });

    test('round-trips fromJson → toJson identically', () {
      const src = {
        'empty_legs': {'email': false, 'wa_link': true},
        'marketing': true,
      };
      expect(NotificationPrefs.fromJson(src).toJson(), src);
    });
  });

  group('copyWith + equality', () {
    test('toggling one flag keeps the others (full object preserved)', () {
      const base = NotificationPrefs(
          emptyLegsEmail: true, emptyLegsWaLink: true, marketing: true);
      final flipped = base.copyWith(marketing: false);
      expect(flipped.emptyLegsEmail, isTrue);
      expect(flipped.emptyLegsWaLink, isTrue);
      expect(flipped.marketing, isFalse);
    });

    test('value equality drives dirty tracking', () {
      const a = NotificationPrefs(emptyLegsEmail: true);
      const b = NotificationPrefs(emptyLegsEmail: true);
      const c = NotificationPrefs(emptyLegsEmail: false);
      expect(a, b);
      expect(a == c, isFalse);
    });
  });
}
