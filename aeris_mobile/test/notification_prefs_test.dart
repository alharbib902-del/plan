import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/notifications/notification_prefs.dart';

void main() {
  group('NotificationPrefs.fromJson', () {
    test('reads nested empty_legs (incl. push) + marketing', () {
      final p = NotificationPrefs.fromJson({
        'empty_legs': {'email': true, 'wa_link': false, 'push': true},
        'marketing': true,
      });
      expect(p.emptyLegsEmail, isTrue);
      expect(p.emptyLegsWaLink, isFalse);
      expect(p.emptyLegsPush, isTrue);
      expect(p.marketing, isTrue);
    });

    test('defaults every flag to false on a missing/partial payload', () {
      final p = NotificationPrefs.fromJson(const {});
      expect(p.emptyLegsEmail, isFalse);
      expect(p.emptyLegsWaLink, isFalse);
      expect(p.emptyLegsPush, isFalse);
      expect(p.marketing, isFalse);
    });

    test('push absent → false (server applies the opt-out default; the model '
        'just reflects it)', () {
      final p = NotificationPrefs.fromJson({
        'empty_legs': {'email': true, 'wa_link': true},
      });
      expect(p.emptyLegsPush, isFalse);
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

  group('NotificationPrefs.toJson — FULL REPLACEMENT (incl. push)', () {
    test('ALWAYS emits the full shape incl. push, never a partial patch', () {
      final json = const NotificationPrefs(
        emptyLegsEmail: true,
        emptyLegsWaLink: false,
        emptyLegsPush: true,
        marketing: false,
      ).toJson();
      expect(json.keys.toSet(), {'empty_legs', 'marketing'});
      final el = json['empty_legs'] as Map;
      expect(el.keys.toSet(), {'email', 'wa_link', 'push'});
      expect(el['email'], true);
      expect(el['wa_link'], false);
      expect(el['push'], true);
      expect(json['marketing'], false);
    });

    test('round-trips fromJson → toJson identically', () {
      const src = {
        'empty_legs': {'email': false, 'wa_link': true, 'push': true},
        'marketing': true,
      };
      expect(NotificationPrefs.fromJson(src).toJson(), src);
    });
  });

  group('copyWith + equality', () {
    test('toggling push keeps the others (full object preserved)', () {
      const base = NotificationPrefs(
          emptyLegsEmail: true, emptyLegsWaLink: true, marketing: true);
      final flipped = base.copyWith(emptyLegsPush: true);
      expect(flipped.emptyLegsEmail, isTrue);
      expect(flipped.emptyLegsWaLink, isTrue);
      expect(flipped.emptyLegsPush, isTrue);
      expect(flipped.marketing, isTrue);
    });

    test('value equality (incl. push) drives dirty tracking', () {
      const a = NotificationPrefs(emptyLegsPush: true);
      const b = NotificationPrefs(emptyLegsPush: true);
      const c = NotificationPrefs(emptyLegsPush: false);
      expect(a, b);
      expect(a == c, isFalse);
    });
  });
}
