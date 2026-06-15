import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/env.dart';
import 'airport.dart';

/// Reads the airport reference data from `/airports/search` (auth required).
/// `airports` is small static reference data filtered server-side by `q`.
class AirportsRepository {
  AirportsRepository(this._api);

  final ApiClient _api;

  Future<List<Airport>> search(String query, {bool privateCapable = true}) async {
    final q = Uri.encodeQueryComponent(query.trim());
    final pc = privateCapable ? 'true' : 'all';
    final res = await _api.getJson(
      '${ApiEnv.apiPrefix}/airports/search?q=$q&private_capable=$pc&limit=30',
    );
    final raw = res['airports'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((m) => Airport.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }
}

final airportsRepositoryProvider = Provider<AirportsRepository>(
  (ref) => AirportsRepository(ref.read(apiClientProvider)),
);
