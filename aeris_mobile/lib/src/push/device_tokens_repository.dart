import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/env.dart';

/// Registers / unregisters this device's push token with
/// `/api/v1/mobile/me/device-tokens` (Push PR1 backend contract).
///
///   register   → POST   `{ token, platform }`
///   unregister → DELETE  `{ token }` in the JSON BODY (never the URL — a
///                device token is a long-lived sensitive identifier).
///
/// Both are authed, per-token rate-limited mutations behind the deployed
/// `push_notifications` flag (server returns `flag_disabled` when off). A
/// dead-session code is handled app-wide by [ApiClient]; everything else
/// surfaces as an [AppException] the caller treats fail-soft.
class DeviceTokensRepository {
  DeviceTokensRepository(this._api);

  final ApiClient _api;

  Future<void> register({
    required String token,
    required String platform,
  }) async {
    await _api.postJson('${ApiEnv.apiPrefix}/me/device-tokens', {
      'token': token,
      'platform': platform,
    });
  }

  Future<void> unregister({required String token}) async {
    await _api.deleteJson(
      '${ApiEnv.apiPrefix}/me/device-tokens',
      body: {'token': token},
    );
  }
}

final deviceTokensRepositoryProvider = Provider<DeviceTokensRepository>(
  (ref) => DeviceTokensRepository(ref.read(apiClientProvider)),
);
