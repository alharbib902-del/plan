/// Referral models, mirroring `serializeReferralForMobile` + the
/// `/api/v1/mobile/referrals` envelope.
///
/// PRIVACY — the referee's identity (referee_client_id / referee_name /
/// referee_email) is deliberately NOT exposed by the server and is NOT
/// modelled here; `fromJson` reads only the allowlisted keys. The reward is
/// reported by the server ONLY when status == 'rewarded' (it arrives null
/// otherwise), so this client never sees a pre-finalization amount.
class Referral {
  const Referral({
    required this.id,
    required this.status,
    this.referrerRewardSar,
    this.createdAt,
    this.rewardedAt,
  });

  final String id;
  final String status;
  final num? referrerRewardSar;
  final String? createdAt;
  final String? rewardedAt;

  factory Referral.fromJson(Map<String, dynamic> j) {
    num? number(dynamic v) =>
        v is num ? v : (v is String ? num.tryParse(v) : null);
    String? str(dynamic v) => v == null ? null : '$v';
    return Referral(
      id: '${j['id'] ?? ''}',
      status: '${j['status'] ?? ''}',
      referrerRewardSar: number(j['referrer_reward_sar']),
      createdAt: str(j['created_at']),
      rewardedAt: str(j['rewarded_at']),
    );
  }
}

/// The referrals screen payload: the client's code (get-or-create; may be
/// null on a soft RPC failure), its share link, and the client's referrals.
class ReferralsSummary {
  const ReferralsSummary({
    this.code,
    this.shareUrl,
    this.referrals = const [],
  });

  final String? code;
  final String? shareUrl;
  final List<Referral> referrals;

  factory ReferralsSummary.fromJson(Map<String, dynamic> j) {
    final raw = j['referrals'];
    return ReferralsSummary(
      code: j['code'] is String ? j['code'] as String : null,
      shareUrl: j['share_url'] is String ? j['share_url'] as String : null,
      referrals: raw is List
          ? raw
              .whereType<Map>()
              .map((m) => Referral.fromJson(Map<String, dynamic>.from(m)))
              .toList()
          : const [],
    );
  }
}

const Map<String, String> _referralStatusAr = {
  'signed_up': 'سجّل (بانتظار المكافأة)',
  'rewarded': 'تمّت المكافأة',
};

/// Arabic label for a referral status code; unknown codes fall back to the
/// raw code rather than a misleading guess.
String referralStatusAr(String code) => _referralStatusAr[code] ?? code;
