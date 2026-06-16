import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/app_exception.dart';
import '../core/env.dart';
import 'notification_prefs.dart';

/// Reads + updates the client's notification preferences via
/// `/api/v1/mobile/me/notifications`. PATCH is a per-token rate-limited
/// mutation and a STRICT FULL REPLACEMENT (sends all keys). A dead-session 401
/// is handled app-wide by ApiClient.onSessionInvalid before the AppException
/// reaches the UI.
class NotificationsRepository {
  NotificationsRepository(this._api);

  final ApiClient _api;

  Future<NotificationPrefs> getPrefs() async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/me/notifications');
    final p = res['preferences'];
    if (p is! Map) throw const AppException('rpc_failed');
    return NotificationPrefs.fromJson(Map<String, dynamic>.from(p));
  }

  /// PATCH returns just `{ ok: true }` (no echo) — callers re-read on success.
  Future<void> updatePrefs(NotificationPrefs prefs) async {
    await _api.patchJson(
        '${ApiEnv.apiPrefix}/me/notifications', prefs.toJson());
  }
}

final notificationsRepositoryProvider = Provider<NotificationsRepository>(
  (ref) => NotificationsRepository(ref.read(apiClientProvider)),
);

/// The client's notification preferences.
final notificationPrefsProvider =
    FutureProvider.autoDispose<NotificationPrefs>(
  (ref) => ref.read(notificationsRepositoryProvider).getPrefs(),
);
