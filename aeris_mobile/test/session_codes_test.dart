import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/core/session_codes.dart';

void main() {
  group('invalidatesSession (founder non-negotiable)', () {
    test('clears the session for EXACTLY the three session-death codes', () {
      expect(invalidatesSession('missing_token'), isTrue);
      expect(invalidatesSession('invalid_session'), isTrue);
      expect(invalidatesSession('session_expired'), isTrue);
      // The set has no other members — nothing else clears the session.
      expect(kSessionInvalidatingCodes, {
        'missing_token',
        'invalid_session',
        'session_expired',
      });
    });

    test('NEVER clears the session for current_password_invalid', () {
      // The wrong-current-password failure on /auth/change-password is a
      // 401-by-status credential error, not a dead session. A locked user
      // mistyping their old password must stay logged in.
      expect(invalidatesSession('current_password_invalid'), isFalse);
    });

    test('does not clear for state / flag / input / dependency errors', () {
      for (final code in const [
        'flag_disabled',
        'account_not_active',
        'client_not_active',
        'password_change_required',
        'validation_failed',
        'rate_limited',
        'rpc_error',
        'network_error',
        'invalid_credentials',
        'expired', // backend normalises this to session_expired before the wire
        'invalid_token_hash',
        'unknown',
        '',
      ]) {
        expect(
          invalidatesSession(code),
          isFalse,
          reason: '$code must not wipe the session',
        );
      }
    });
  });
}
