import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/profile/profile.dart';

void main() {
  group('ClientProfile.fromJson', () {
    test('reads the 4-field allowlist; hostile columns never surface', () {
      final p = ClientProfile.fromJson({
        'full_name': 'محمد العتيبي',
        'contact_phone': '+966500000000',
        'auth_email': 'm@example.com',
        'marketing_opt_in': true,
        // hostile extras — must NOT be modelled / reachable:
        'password_hash': 'HASH_SECRET',
        'privilege_tier': 'platinum',
        'cashback_balance_sar': '9999.00',
        'id': 'client-SECRET',
      });
      expect(p.fullName, 'محمد العتيبي');
      expect(p.contactPhone, '+966500000000');
      expect(p.authEmail, 'm@example.com');
      expect(p.marketingOptIn, isTrue);

      final reachable = <String>[p.fullName, p.contactPhone, p.authEmail];
      for (final s in ['HASH_SECRET', 'platinum', '9999.00', 'client-SECRET']) {
        expect(reachable.contains(s), isFalse, reason: 'leaked "$s"');
      }
    });

    test('safe defaults on a partial/empty payload', () {
      final p = ClientProfile.fromJson(const {});
      expect(p.fullName, '');
      expect(p.contactPhone, '');
      expect(p.authEmail, '');
      expect(p.marketingOptIn, isFalse);
    });

    test('marketing_opt_in coerces strictly to bool', () {
      expect(
          ClientProfile.fromJson({'marketing_opt_in': 'true'}).marketingOptIn,
          isFalse); // a string is NOT true
      expect(ClientProfile.fromJson({'marketing_opt_in': false}).marketingOptIn,
          isFalse);
    });
  });

  group('UpdateProfileInput.toJson', () {
    test('sends EXACTLY full_name/phone/marketing_opt_in (phone, NOT '
        'contact_phone; no auth_email)', () {
      final json = const UpdateProfileInput(
        fullName: 'سارة',
        phone: '0500000000',
        marketingOptIn: false,
      ).toJson();
      expect(json['full_name'], 'سارة');
      expect(json['phone'], '0500000000'); // PATCH key is `phone`
      expect(json['marketing_opt_in'], false);
      expect(json.keys.toSet(),
          {'full_name', 'phone', 'marketing_opt_in'});
      // never send the read-only / GET-only keys
      expect(json.containsKey('contact_phone'), isFalse);
      expect(json.containsKey('auth_email'), isFalse);
    });

    test('marketing_opt_in is always present (explicit, never omitted)', () {
      final json = const UpdateProfileInput(
        fullName: 'x',
        phone: '123456',
        marketingOptIn: true,
      ).toJson();
      expect(json.containsKey('marketing_opt_in'), isTrue);
      expect(json['marketing_opt_in'], true);
    });
  });
}
