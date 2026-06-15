import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/app_exception.dart';
import '../core/env.dart';
import 'offer.dart';
import 'trip_request.dart';

/// Payload for POST /requests. Builds the `legs` array + the canonical
/// top-level fields the create schema expects (one outbound leg; a return
/// leg is captured by return_date, not duplicated into legs).
class CreateTripRequestInput {
  const CreateTripRequestInput({
    required this.departureIata,
    required this.arrivalIata,
    required this.departureDateIso,
    required this.passengers,
    this.returnDateIso,
    this.aircraftPref,
    this.specialRequests,
  });

  final String departureIata;
  final String arrivalIata;
  final String departureDateIso;
  final int passengers;
  final String? returnDateIso;
  final String? aircraftPref;
  final String? specialRequests;

  Map<String, dynamic> toJson() => {
        'legs': [
          {
            'from': departureIata,
            'to': arrivalIata,
            'date': departureDateIso,
          },
        ],
        'departure_iata': departureIata,
        'arrival_iata': arrivalIata,
        'departure_date': departureDateIso,
        if (returnDateIso != null) 'return_date': returnDateIso,
        'passengers': passengers,
        if (aircraftPref != null) 'aircraft_pref': aircraftPref,
        if (specialRequests != null && specialRequests!.trim().isNotEmpty)
          'special_requests': specialRequests!.trim(),
      };
}

class CharterRepository {
  CharterRepository(this._api);

  final ApiClient _api;

  Future<List<TripRequest>> listRequests({String status = 'all'}) async {
    final path = status == 'all'
        ? '${ApiEnv.apiPrefix}/requests'
        : '${ApiEnv.apiPrefix}/requests?status=$status';
    final res = await _api.getJson(path);
    final raw = res['requests'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((m) => TripRequest.fromJson(Map<String, dynamic>.from(m)))
        .toList();
  }

  Future<({TripRequest request, List<Offer> offers})> detail(String id) async {
    final res = await _api.getJson('${ApiEnv.apiPrefix}/requests/$id');
    final r = res['request'];
    if (r is! Map) throw const AppException('request_not_found');
    final offersRaw = res['offers'];
    final offers = offersRaw is List
        ? offersRaw
            .whereType<Map>()
            .map((m) => Offer.fromJson(Map<String, dynamic>.from(m)))
            .toList()
        : <Offer>[];
    return (
      request: TripRequest.fromJson(Map<String, dynamic>.from(r)),
      offers: offers,
    );
  }

  /// Creates a request; returns the new trip_request_id (for navigation).
  Future<String> create(CreateTripRequestInput input) async {
    final res = await _api.postJson(
      '${ApiEnv.apiPrefix}/requests',
      input.toJson(),
    );
    return '${res['trip_request_id'] ?? ''}';
  }
}

final charterRepositoryProvider = Provider<CharterRepository>(
  (ref) => CharterRepository(ref.read(apiClientProvider)),
);

/// The client's trip requests, optionally filtered by status ('all' default).
final charterRequestsProvider =
    FutureProvider.autoDispose.family<List<TripRequest>, String>(
  (ref, status) => ref.read(charterRepositoryProvider).listRequests(status: status),
);

/// A single request + its offers (offers read-only in slice 4a).
final requestDetailProvider = FutureProvider.autoDispose
    .family<({TripRequest request, List<Offer> offers}), String>(
  (ref, id) => ref.read(charterRepositoryProvider).detail(id),
);
