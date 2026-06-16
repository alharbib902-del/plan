import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/app_exception.dart';
import '../core/env.dart';
import 'privilege.dart';

/// Reads the client's privilege dashboard + cashback ledger from
/// `/api/v1/mobile/privilege*` (read-only; both routes are behind
/// ENABLE_PRIVILEGE server-side → a `flag_disabled` AppException surfaces
/// when the feature is off). A dead-session 401 is handled app-wide by
/// ApiClient.onSessionInvalid before the AppException reaches the UI.
class PrivilegeRepository {
  PrivilegeRepository(this._api);

  final ApiClient _api;

  Future<PrivilegeDashboard> dashboard() async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/privilege');
    final d = res['dashboard'];
    if (d is! Map) throw const AppException('rpc_failed');
    return PrivilegeDashboard.fromJson(Map<String, dynamic>.from(d));
  }

  Future<List<LedgerEntry>> history() async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/privilege/history');
    final raw = res['ledger'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((m) => LedgerEntry.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }
}

final privilegeRepositoryProvider = Provider<PrivilegeRepository>(
  (ref) => PrivilegeRepository(ref.read(apiClientProvider)),
);

/// The client's privilege dashboard (tier + cashback + recent activity).
final privilegeDashboardProvider =
    FutureProvider.autoDispose<PrivilegeDashboard>(
  (ref) => ref.read(privilegeRepositoryProvider).dashboard(),
);

/// The full cashback/loyalty ledger (last 100).
final privilegeHistoryProvider = FutureProvider.autoDispose<List<LedgerEntry>>(
  (ref) => ref.read(privilegeRepositoryProvider).history(),
);
