import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/env.dart';
import 'referral.dart';

/// Reads the client's referral code + share link + referrals from
/// `GET /api/v1/mobile/referrals` (read-only). Referrals are NOT flag-gated
/// (only requireClientBearer applies). A dead-session 401 is handled
/// app-wide; an RPC failure surfaces as AppException('rpc_failed').
class ReferralsRepository {
  ReferralsRepository(this._api);

  final ApiClient _api;

  Future<ReferralsSummary> summary() async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/referrals');
    return ReferralsSummary.fromJson(res);
  }
}

final referralsRepositoryProvider = Provider<ReferralsRepository>(
  (ref) => ReferralsRepository(ref.read(apiClientProvider)),
);

/// The client's referral summary (code + share link + referrals).
final referralsSummaryProvider = FutureProvider.autoDispose<ReferralsSummary>(
  (ref) => ref.read(referralsRepositoryProvider).summary(),
);
