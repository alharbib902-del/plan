import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/app_exception.dart';
import '../core/env.dart';
import 'profile.dart';

/// Reads + updates the client's profile via `/api/v1/mobile/me/profile`.
/// PATCH is a per-token rate-limited mutation (rate_limited + retry_after) and
/// is FULL-REPLACEMENT. A dead-session 401 is handled app-wide by
/// ApiClient.onSessionInvalid before the AppException reaches the UI.
class ProfileRepository {
  ProfileRepository(this._api);

  final ApiClient _api;

  Future<ClientProfile> getProfile() async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/me/profile');
    final p = res['profile'];
    if (p is! Map) throw const AppException('client_not_found');
    return ClientProfile.fromJson(Map<String, dynamic>.from(p));
  }

  /// PATCH returns just `{ ok: true }` (no echo) — callers re-read on success.
  Future<void> updateProfile(UpdateProfileInput input) async {
    await _api.patchJson('${ApiEnv.apiPrefix}/me/profile', input.toJson());
  }
}

final profileRepositoryProvider = Provider<ProfileRepository>(
  (ref) => ProfileRepository(ref.read(apiClientProvider)),
);

/// The client's own profile.
final profileProvider = FutureProvider.autoDispose<ClientProfile>(
  (ref) => ref.read(profileRepositoryProvider).getProfile(),
);
