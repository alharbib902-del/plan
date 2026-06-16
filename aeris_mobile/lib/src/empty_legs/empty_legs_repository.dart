import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/app_exception.dart';
import '../core/env.dart';
import 'alert.dart';
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

  // ── Actions (slice 5b). All rate-limited; conflict codes
  //    (leg_already_reserved / leg_not_available / leg_window_closed /
  //    leg_not_reserved / cancel_not_allowed) + rate_limited surface typed.
  //    reserve/release take the leg UUID (leg.id) in the body, not leg_number.

  Future<void> reserveLeg(String legId) async {
    await _api.postJson('${ApiEnv.apiPrefix}/empty-legs/reserve', {
      'leg_id': legId,
    });
  }

  Future<void> releaseLeg(String legId) async {
    await _api.postJson('${ApiEnv.apiPrefix}/empty-legs/release', {
      'leg_id': legId,
    });
  }

  Future<List<Alert>> listAlerts() async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/empty-legs/alerts');
    final raw = res['alerts'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((m) => Alert.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<void> createAlert(CreateAlertInput input) async {
    await _api.postJson('${ApiEnv.apiPrefix}/empty-legs/alerts', input.toJson());
  }

  Future<void> toggleAlert(String id, bool active) async {
    await _api.patchJson(
      '${ApiEnv.apiPrefix}/empty-legs/alerts/$id',
      {'active': active},
    );
  }

  Future<void> deleteAlert(String id) async {
    await _api.deleteJson('${ApiEnv.apiPrefix}/empty-legs/alerts/$id');
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

/// The client's own price alerts (the "تنبيهاتي" tab).
final emptyLegAlertsProvider = FutureProvider.autoDispose<List<Alert>>(
  (ref) => ref.read(emptyLegsRepositoryProvider).listAlerts(),
);
