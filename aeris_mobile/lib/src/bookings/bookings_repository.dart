import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/app_exception.dart';
import '../core/env.dart';
import 'booking.dart';

/// Reads the client's bookings from `/api/v1/mobile/bookings*`.
/// A dead-session 401 (session_expired / invalid_session / missing_token)
/// is handled app-wide by ApiClient.onSessionInvalid (token cleared +
/// bounce to /login) before the AppException reaches the UI.
class BookingsRepository {
  BookingsRepository(this._api);

  final ApiClient _api;

  Future<List<Booking>> list() async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/bookings');
    final raw = res['bookings'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((m) => Booking.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<Booking> detail(String id) async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/bookings/$id');
    final b = res['booking'];
    if (b is! Map) throw const AppException('booking_not_found');
    return Booking.fromJson(Map<String, dynamic>.from(b));
  }
}

final bookingsRepositoryProvider = Provider<BookingsRepository>(
  (ref) => BookingsRepository(ref.read(apiClientProvider)),
);

/// The client's bookings (newest first, as ordered by the server).
final bookingsListProvider = FutureProvider.autoDispose<List<Booking>>(
  (ref) => ref.read(bookingsRepositoryProvider).list(),
);

/// A single booking's detail, keyed by id.
final bookingDetailProvider =
    FutureProvider.autoDispose.family<Booking, String>(
  (ref, id) => ref.read(bookingsRepositoryProvider).detail(id),
);
