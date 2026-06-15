import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/app_exception.dart';
import '../core/env.dart';
import 'empty_leg.dart';

/// Reads empty-leg data from `/api/v1/mobile/empty-legs*` (all authed +
/// gated by ENABLE_CLIENT_EMPTY_LEGS_PORTAL → a `flag_disabled` AppException
/// when off). Slice 5a is read-only; reserve/release + alerts land in 5b.
class EmptyLegsRepository {
  EmptyLegsRepository(this._api);

  final ApiClient _api;

  Future<List<EmptyLeg>> listLegs() async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/empty-legs');
    final raw = res['legs'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((m) => EmptyLeg.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<List<MatchedLeg>> matches() async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/empty-legs/matches');
    final raw = res['matches'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((m) => MatchedLeg.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<EmptyLeg> legDetail(String legNumber) async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/empty-legs/$legNumber');
    final leg = res['leg'];
    if (leg is! Map) throw const AppException('leg_not_found');
    return EmptyLeg.fromJson(Map<String, dynamic>.from(leg));
  }
}

final emptyLegsRepositoryProvider = Provider<EmptyLegsRepository>(
  (ref) => EmptyLegsRepository(ref.read(apiClientProvider)),
);

/// Browse-all empty legs (the "تصفّح الكل" tab).
final emptyLegsListProvider = FutureProvider.autoDispose<List<EmptyLeg>>(
  (ref) => ref.read(emptyLegsRepositoryProvider).listLegs(),
);

/// The client's matched empty legs (the "مطاباتي" tab).
final emptyLegMatchesProvider = FutureProvider.autoDispose<List<MatchedLeg>>(
  (ref) => ref.read(emptyLegsRepositoryProvider).matches(),
);

/// A single empty leg's detail, keyed by leg_number (EL-XXXX).
final emptyLegDetailProvider =
    FutureProvider.autoDispose.family<EmptyLeg, String>(
  (ref, legNumber) =>
      ref.read(emptyLegsRepositoryProvider).legDetail(legNumber),
);
