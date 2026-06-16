import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/app_exception.dart';
import '../core/env.dart';
import 'empty_leg.dart';

/// Guest (no-token) empty-legs browse via `/api/v1/mobile/public/empty-legs*`.
///
/// Every call is `auth: false`: no Bearer token is attached AND the global
/// session guard is NOT armed, so a guest read can never clear a token or
/// touch auth state — even if a signed-in user somehow reached a guest route.
/// Read-only: there is no reserve/release/alerts here (those are authed). The
/// server gates this behind ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE
/// (flag_disabled when off) and strips prices when pricing is hidden.
class GuestEmptyLegsRepository {
  GuestEmptyLegsRepository(this._api);

  final ApiClient _api;

  Future<List<EmptyLeg>> listLegs() async {
    final res = await _api.getJson(
      '${ApiEnv.apiPrefix}/public/empty-legs',
      auth: false,
    );
    final raw = res['legs'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((m) => EmptyLeg.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<EmptyLeg> legDetail(String legNumber) async {
    final res = await _api.getJson(
      '${ApiEnv.apiPrefix}/public/empty-legs/$legNumber',
      auth: false,
    );
    final l = res['leg'];
    if (l is! Map) throw const AppException('leg_not_found');
    return EmptyLeg.fromJson(Map<String, dynamic>.from(l));
  }
}

final guestEmptyLegsRepositoryProvider = Provider<GuestEmptyLegsRepository>(
  (ref) => GuestEmptyLegsRepository(ref.read(apiClientProvider)),
);

/// Public empty-legs list (guest browse).
final guestEmptyLegsListProvider = FutureProvider.autoDispose<List<EmptyLeg>>(
  (ref) => ref.read(guestEmptyLegsRepositoryProvider).listLegs(),
);

/// A single public leg by leg_number (guest detail / shared link).
final guestEmptyLegDetailProvider =
    FutureProvider.autoDispose.family<EmptyLeg, String>(
  (ref, legNumber) =>
      ref.read(guestEmptyLegsRepositoryProvider).legDetail(legNumber),
);
