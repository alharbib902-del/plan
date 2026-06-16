import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/privilege/privilege.dart';

// Hostile values that the raw admin audit rows carry but the mobile
// serializer strips — they must NEVER be reachable through the Flutter model.
const _adminFp = 'ADMIN_COOKIE_FP_SECRET';
const _adminReason = 'internal admin note — do not show';
const _clientId = 'client-SECRET-ID';
const _srcChange = 'chg-internal';
const _srcSub = 'sub-internal';

const _secrets = [_adminFp, _adminReason, _clientId, _srcChange, _srcSub];

void main() {
  group('LedgerEntry.fromJson', () {
    test('reads the allowlist, coerces NUMERIC strings, drops admin/internal',
        () {
      final e = LedgerEntry.fromJson({
        'id': 'led-1',
        'event_type': 'earn',
        'amount_sar': '1500.00',
        'balance_after_sar': '3200.00',
        'booking_id': 'bk-1',
        'cashback_expiry_at': '2027-06-01T00:00:00Z',
        'created_at': '2026-06-01T00:00:00Z',
        // hostile extras — present in the raw row, must not surface:
        'client_id': _clientId,
        'source_change_log_id': _srcChange,
        'source_subscription_id': _srcSub,
        'admin_actor_cookie_fingerprint': _adminFp,
        'admin_reason': _adminReason,
      });
      expect(e.id, 'led-1');
      expect(e.eventType, 'earn');
      expect(e.amountSar, 1500.0);
      expect(e.balanceAfterSar, 3200.0);
      expect(e.bookingId, 'bk-1');

      // MAINTENANCE: any new string getter added to LedgerEntry MUST be
      // appended here — this list is the leak-guard's coverage. (Dart can't
      // reflect over getters; the server serializer key-pin in
      // privilege-serializer.test.ts is the authoritative second guard.)
      final reachable = <String?>[
        e.id,
        e.eventType,
        e.bookingId,
        e.cashbackExpiryAt,
        e.createdAt,
      ];
      for (final s in _secrets) {
        expect(reachable.contains(s), isFalse, reason: 'leaked "$s"');
      }
    });
  });

  group('TierChangeEntry.fromJson', () {
    test('reads the allowlist (structured reason kept), drops admin fields', () {
      final c = TierChangeEntry.fromJson({
        'id': 'chg-1',
        'from_tier': 'gold',
        'to_tier': 'platinum',
        'reason': 'auto_upgrade',
        'qualified_spend_12m_sar': '250000.00',
        'grace_started_at': null,
        'lock_until': null,
        'source_booking_id': 'bk-2',
        'created_at': '2026-05-01T00:00:00Z',
        'client_id': _clientId,
        'admin_actor_cookie_fingerprint': _adminFp,
        'admin_reason': _adminReason,
      });
      expect(c.fromTier, 'gold');
      expect(c.toTier, 'platinum');
      expect(c.reason, 'auto_upgrade'); // structured reason is client-facing
      expect(c.qualifiedSpend12mSar, 250000.0);
      expect(c.sourceBookingId, 'bk-2');

      final reachable = <String?>[
        c.id,
        c.fromTier,
        c.toTier,
        c.reason,
        c.graceStartedAt,
        c.lockUntil,
        c.sourceBookingId,
        c.createdAt,
      ];
      for (final s in _secrets) {
        expect(reachable.contains(s), isFalse, reason: 'leaked "$s"');
      }
    });
  });

  group('PrivilegeColumns.fromJson', () {
    test('reads tier + cashback (NUMERIC strings) + 2FA', () {
      final p = PrivilegeColumns.fromJson({
        'privilege_tier': 'platinum',
        'privilege_tier_assigned_at': '2026-05-01T00:00:00Z',
        'qualified_spend_12m_sar': '250000.00',
        'below_threshold_since': null,
        'tier_locked_until': null,
        'cashback_balance_sar': '3200.00',
        'two_factor_enabled': true,
      });
      expect(p.tier, 'platinum');
      expect(p.cashbackBalanceSar, 3200.0);
      expect(p.qualifiedSpend12mSar, 250000.0);
      expect(p.twoFactorEnabled, isTrue);
    });

    test('two_factor defaults false; money null when absent', () {
      final p = PrivilegeColumns.fromJson({'privilege_tier': 'silver'});
      expect(p.twoFactorEnabled, isFalse);
      expect(p.cashbackBalanceSar, isNull);
    });
  });

  group('PrivilegeDashboard.fromJson', () {
    test('builds the full tree; NO admin/PII reachable anywhere', () {
      final d = PrivilegeDashboard.fromJson({
        'full_name': 'محمد',
        'privilege': {
          'privilege_tier': 'platinum',
          'cashback_balance_sar': '3200.00',
          'client_id': _clientId,
        },
        'recent_ledger': [
          {
            'id': 'led-1',
            'event_type': 'earn',
            'amount_sar': '1500.00',
            'admin_reason': _adminReason,
            'admin_actor_cookie_fingerprint': _adminFp,
            'source_change_log_id': _srcChange,
          },
        ],
        'recent_change_log': [
          {
            'id': 'chg-1',
            'from_tier': 'gold',
            'to_tier': 'platinum',
            'reason': 'auto_upgrade',
            'admin_reason': _adminReason,
            'client_id': _clientId,
          },
        ],
      });
      expect(d.fullName, 'محمد');
      expect(d.privilege.tier, 'platinum');
      expect(d.recentLedger.length, 1);
      expect(d.recentChangeLog.length, 1);

      final reachable = <String?>[
        d.fullName,
        d.privilege.tier,
        d.privilege.tierAssignedAt,
        d.privilege.belowThresholdSince,
        d.privilege.tierLockedUntil,
        for (final e in d.recentLedger) ...[
          e.id,
          e.eventType,
          e.bookingId,
          e.cashbackExpiryAt,
          e.createdAt,
        ],
        for (final c in d.recentChangeLog) ...[
          c.id,
          c.fromTier,
          c.toTier,
          c.reason,
          c.graceStartedAt,
          c.lockUntil,
          c.sourceBookingId,
          c.createdAt,
        ],
      ];
      for (final s in _secrets) {
        expect(reachable.contains(s), isFalse, reason: 'leaked "$s"');
      }
    });

    test('empty lists when arrays absent', () {
      final d = PrivilegeDashboard.fromJson({
        'full_name': 'سارة',
        'privilege': {'privilege_tier': 'silver'},
      });
      expect(d.recentLedger, isEmpty);
      expect(d.recentChangeLog, isEmpty);
      expect(d.privilege.tier, 'silver');
    });
  });

  group('labels map known codes and fall back to the raw code', () {
    test('tier', () {
      expect(privilegeTierAr('silver'), 'فضي');
      expect(privilegeTierAr('diamond'), 'ماسي');
      expect(privilegeTierAr('???'), '???');
    });
    test('ledger event type', () {
      expect(ledgerEventTypeAr('earn'), 'كاش باك مكتسب');
      expect(ledgerEventTypeAr('redeem'), 'استبدال');
      expect(ledgerEventTypeAr('???'), '???');
    });
    test('tier change reason', () {
      expect(tierChangeReasonAr('auto_upgrade'), 'ترقية تلقائية');
      expect(tierChangeReasonAr('???'), '???');
    });
  });
}
