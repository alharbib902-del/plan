import 'package:flutter_test/flutter_test.dart';

import 'package:aeris_mobile/src/referrals/referral.dart';

void main() {
  group('Referral.fromJson', () {
    test('reads the allowlist; referee identity (if present) never surfaces',
        () {
      final r = Referral.fromJson({
        'id': 'ref-1',
        'status': 'rewarded',
        'referrer_reward_sar': 500,
        'created_at': '2026-06-01T00:00:00Z',
        'rewarded_at': '2026-06-10T00:00:00Z',
        // hostile extras — referee identity must not be modelled:
        'referee_client_id': 'REFEREE_SECRET_ID',
        'referee_name': 'REFEREE SECRET NAME',
        'referee_email': 'referee@secret.example',
      });
      expect(r.id, 'ref-1');
      expect(r.status, 'rewarded');
      expect(r.referrerRewardSar, 500);

      final reachable = <String?>[r.id, r.status, r.createdAt, r.rewardedAt];
      for (final s in [
        'REFEREE_SECRET_ID',
        'REFEREE SECRET NAME',
        'referee@secret.example',
      ]) {
        expect(reachable.contains(s), isFalse, reason: 'leaked "$s"');
      }
    });

    test('reward is null pre-finalization (server-gated), present when rewarded',
        () {
      // The server already withholds the amount unless status==rewarded; the
      // model just reflects what arrives.
      final pending = Referral.fromJson({
        'id': 'ref-2',
        'status': 'signed_up',
        'referrer_reward_sar': null,
        'rewarded_at': null,
      });
      expect(pending.referrerRewardSar, isNull);
      expect(pending.rewardedAt, isNull);

      final done = Referral.fromJson({
        'id': 'ref-3',
        'status': 'rewarded',
        'referrer_reward_sar': 500,
      });
      expect(done.referrerRewardSar, 500);
    });

    test('coerces a NUMERIC-string reward', () {
      final r = Referral.fromJson({
        'id': 'ref-4',
        'status': 'rewarded',
        'referrer_reward_sar': '750.00',
      });
      expect(r.referrerRewardSar, 750.0);
    });
  });

  group('ReferralsSummary.fromJson', () {
    test('parses code + share_url + referrals', () {
      final s = ReferralsSummary.fromJson({
        'ok': true,
        'code': 'AB12CD',
        'share_url': 'https://aeris.sa/signup?ref=AB12CD',
        'referrals': [
          {'id': 'ref-1', 'status': 'rewarded', 'referrer_reward_sar': 500},
          {'id': 'ref-2', 'status': 'signed_up'},
        ],
      });
      expect(s.code, 'AB12CD');
      expect(s.shareUrl, 'https://aeris.sa/signup?ref=AB12CD');
      expect(s.referrals.length, 2);
      expect(s.referrals.first.id, 'ref-1');
    });

    test('tolerates a null code/share_url (soft RPC failure)', () {
      final s = ReferralsSummary.fromJson({
        'ok': true,
        'code': null,
        'share_url': null,
        'referrals': [],
      });
      expect(s.code, isNull);
      expect(s.shareUrl, isNull);
      expect(s.referrals, isEmpty);
    });

    test('empty referrals when the array is absent', () {
      final s = ReferralsSummary.fromJson({'ok': true, 'code': 'X'});
      expect(s.referrals, isEmpty);
    });
  });

  group('referralStatusAr', () {
    test('maps known codes, falls back to the raw code', () {
      expect(referralStatusAr('rewarded'), 'تمّت المكافأة');
      expect(referralStatusAr('signed_up'), 'سجّل (بانتظار المكافأة)');
      expect(referralStatusAr('???'), '???');
    });
  });
}
