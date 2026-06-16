import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/auth/session.dart';
import 'package:aeris_mobile/src/config/app_config.dart';
import 'package:aeris_mobile/src/core/app_exception.dart';

void main() {
  group('errorMessageAr', () {
    test('maps known codes to Arabic', () {
      expect(errorMessageAr('invalid_credentials'), contains('كلمة المرور'));
      expect(errorMessageAr('rate_limited'), contains('محاولات'));
      expect(errorMessageAr('session_expired'), contains('جلست'));
    });

    test('falls back for unknown codes', () {
      expect(errorMessageAr('totally_unknown'), errorMessageAr('__missing__'));
      expect(errorMessageAr('totally_unknown'), contains('غير متوقّع'));
    });

    test('AppException.messageAr delegates to the dictionary', () {
      const e = AppException('flag_disabled');
      expect(e.messageAr, errorMessageAr('flag_disabled'));
    });

    test('maps current_password_invalid to its own message', () {
      // Must be a distinct credential message, not the generic fallback.
      expect(errorMessageAr('current_password_invalid'), contains('الحالية'));
      expect(
        errorMessageAr('current_password_invalid'),
        isNot(errorMessageAr('__missing__')),
      );
    });
  });

  group('AppConfig', () {
    test('failClosed turns every flag off', () {
      final c = AppConfig.failClosed();
      expect(c.clientPortal, isFalse);
      expect(c.privilege, isFalse);
      expect(c.payments, isFalse);
      expect(c.publicMarketplace, isFalse);
      expect(c.pricingVisible, isFalse);
      expect(c.minSupportedVersion, '1.0.0');
    });

    test('fromJson reads flags + pricing + version', () {
      final c = AppConfig.fromJson({
        'flags': {
          'client_portal': true,
          'privilege': true,
          'payments': false,
          'client_empty_legs_portal': true,
          'empty_legs_client_pricing': false,
          'public_marketplace': true,
        },
        'pricing_visible': false,
        'min_supported_version': '1.2.0',
      });
      expect(c.clientPortal, isTrue);
      expect(c.privilege, isTrue);
      expect(c.payments, isFalse);
      expect(c.clientEmptyLegsPortal, isTrue);
      expect(c.publicMarketplace, isTrue);
      expect(c.pricingVisible, isFalse);
      expect(c.minSupportedVersion, '1.2.0');
    });

    test('fromJson is fail-closed on missing flags', () {
      final c = AppConfig.fromJson(const {});
      expect(c.clientPortal, isFalse);
      expect(c.publicMarketplace, isFalse);
      expect(c.minSupportedVersion, '1.0.0');
    });
  });

  group('ClientSession', () {
    test('parses the /me/session shape', () {
      final s = ClientSession.fromJson({
        'client_id': 'c-1',
        'full_name': 'محمد',
        'contact_phone': '+966500000000',
        'expires_at': '2026-07-01T00:00:00Z',
        'password_must_change': true,
      });
      expect(s.clientId, 'c-1');
      expect(s.fullName, 'محمد');
      expect(s.passwordMustChange, isTrue);
    });

    test('defaults password_must_change to false when absent', () {
      final s = ClientSession.fromJson(const {'client_id': 'c-2'});
      expect(s.passwordMustChange, isFalse);
      expect(s.fullName, '');
    });
  });
}
