/// A client charter trip request, mirroring `serializeTripRequestForMobile`
/// (`/api/v1/mobile/requests*`). Strict allowlist — no operator PII / dispatch
/// internals are sent, so none are modelled here.
class TripRequest {
  const TripRequest({
    required this.id,
    required this.requestNumber,
    required this.status,
    this.tripType,
    this.departureIata,
    this.arrivalIata,
    this.departureDate,
    this.returnDate,
    this.passengers = 0,
    this.aircraftPref,
    this.specialRequests,
    this.canCancel = false,
    this.canAcceptOffers = false,
    this.createdAt,
  });

  final String id;
  final String requestNumber;
  final String status;
  final String? tripType;
  final String? departureIata;
  final String? arrivalIata;
  final String? departureDate;
  final String? returnDate;
  final int passengers;
  final String? aircraftPref;
  final String? specialRequests;
  final bool canCancel;
  final bool canAcceptOffers;
  final String? createdAt;

  factory TripRequest.fromJson(Map<String, dynamic> j) {
    String? str(dynamic v) => v == null ? null : '$v';
    return TripRequest(
      id: '${j['id'] ?? ''}',
      requestNumber: '${j['request_number'] ?? ''}',
      status: '${j['status'] ?? ''}',
      tripType: str(j['trip_type']),
      departureIata: str(j['departure_iata']),
      arrivalIata: str(j['arrival_iata']),
      departureDate: str(j['departure_date']),
      returnDate: str(j['return_date']),
      passengers: j['passengers'] is int
          ? j['passengers'] as int
          : int.tryParse('${j['passengers'] ?? ''}') ?? 0,
      aircraftPref: str(j['aircraft_pref']),
      specialRequests: str(j['special_requests']),
      canCancel: j['can_cancel'] == true,
      canAcceptOffers: j['can_accept_offers'] == true,
      createdAt: str(j['created_at']),
    );
  }

  /// "origin إلى destination" (reads naturally RTL).
  String get routeLabel =>
      '${departureIata ?? '—'} إلى ${arrivalIata ?? '—'}';
}

const Map<String, String> _tripStatusAr = {
  'pending': 'قيد المراجعة',
  'distributed': 'موزّع على المشغّلين',
  'offered': 'يوجد عروض',
  'booked': 'محجوز',
  'cancelled': 'ملغى',
};

const Map<String, String> _aircraftPrefAr = {
  'light': 'خفيفة',
  'mid': 'متوسطة',
  'super_mid': 'فوق المتوسطة',
  'heavy': 'ثقيلة',
  'long_range': 'طويلة المدى',
};

/// Arabic label for a trip-request status (mirrors clientsAr); unknown codes
/// fall back to the raw code.
String tripStatusAr(String code) => _tripStatusAr[code] ?? code;

/// Arabic label for an aircraft-category preference; null/unknown -> null.
String? aircraftPrefAr(String? code) =>
    code == null ? null : (_aircraftPrefAr[code] ?? code);

/// The aircraft-preference options for the create form (value + Arabic label).
const List<({String value, String label})> aircraftPrefOptions = [
  (value: 'light', label: 'خفيفة'),
  (value: 'mid', label: 'متوسطة'),
  (value: 'super_mid', label: 'فوق المتوسطة'),
  (value: 'heavy', label: 'ثقيلة'),
  (value: 'long_range', label: 'طويلة المدى'),
];
