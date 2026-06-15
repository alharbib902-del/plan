/// An empty-leg flight, mirroring `serializeEmptyLegForMobile`
/// (`/api/v1/mobile/empty-legs*`). Strict allowlist. Prices are present
/// only when `pricingVisible` (the ENABLE_EMPTY_LEGS_CLIENT_PRICING flag).
class EmptyLeg {
  const EmptyLeg({
    required this.id,
    required this.legNumber,
    required this.status,
    this.departureIata,
    this.arrivalIata,
    this.departureLabel,
    this.arrivalLabel,
    this.departureWindowStart,
    this.departureWindowEnd,
    this.flexibilityHours,
    this.aircraft,
    this.maxPassengers,
    this.currentDiscountPct,
    this.auctionWindowEndAt,
    this.isReserved = false,
    this.isReservedByMe = false,
    this.reservationExpiresAt,
    this.pricingVisible = false,
    this.originalPriceSar,
    this.currentPriceSar,
  });

  final String id;
  final String legNumber;
  final String status;
  final String? departureIata;
  final String? arrivalIata;
  final String? departureLabel;
  final String? arrivalLabel;
  final String? departureWindowStart;
  final String? departureWindowEnd;
  final num? flexibilityHours;
  final String? aircraft;
  final int? maxPassengers;
  final num? currentDiscountPct;
  final String? auctionWindowEndAt;
  final bool isReserved;
  final bool isReservedByMe;
  final String? reservationExpiresAt;
  final bool pricingVisible;
  final num? originalPriceSar;
  final num? currentPriceSar;

  factory EmptyLeg.fromJson(Map<String, dynamic> j) {
    String? str(dynamic v) => v == null ? null : '$v';
    num? number(dynamic v) =>
        v is num ? v : (v is String ? num.tryParse(v) : null);
    int? intOrNull(dynamic v) =>
        v == null ? null : (v is int ? v : int.tryParse('$v'));

    return EmptyLeg(
      id: '${j['id'] ?? ''}',
      legNumber: '${j['leg_number'] ?? ''}',
      status: '${j['status'] ?? ''}',
      departureIata: str(j['departure_iata']),
      arrivalIata: str(j['arrival_iata']),
      departureLabel: str(j['departure_label']),
      arrivalLabel: str(j['arrival_label']),
      departureWindowStart: str(j['departure_window_start']),
      departureWindowEnd: str(j['departure_window_end']),
      flexibilityHours: number(j['flexibility_hours']),
      aircraft: str(j['aircraft']),
      maxPassengers: intOrNull(j['max_passengers']),
      currentDiscountPct: number(j['current_discount_pct']),
      auctionWindowEndAt: str(j['auction_window_end_at']),
      isReserved: j['is_reserved'] == true,
      isReservedByMe: j['is_reserved_by_me'] == true,
      reservationExpiresAt: str(j['reservation_expires_at']),
      pricingVisible: j['pricing_visible'] == true,
      // Prices are spread top-level only when pricing is visible.
      originalPriceSar: number(j['original_price_sar']),
      currentPriceSar: number(j['current_price_sar']),
    );
  }

  /// "origin إلى destination" (reads naturally RTL).
  String get routeLabel =>
      '${departureLabel ?? departureIata ?? '—'} إلى '
      '${arrivalLabel ?? arrivalIata ?? '—'}';
}

/// A matched empty leg (the "مطاباتي" tab) = the leg + notification meta.
class MatchedLeg {
  const MatchedLeg({
    required this.leg,
    this.notificationSentAt,
    this.notificationEventType,
  });

  final EmptyLeg leg;
  final String? notificationSentAt;
  final String? notificationEventType;

  factory MatchedLeg.fromJson(Map<String, dynamic> j) {
    final n = j['notification'] is Map
        ? Map<String, dynamic>.from(j['notification'] as Map)
        : const <String, dynamic>{};
    final legJson = j['leg'] is Map
        ? Map<String, dynamic>.from(j['leg'] as Map)
        : const <String, dynamic>{};
    return MatchedLeg(
      leg: EmptyLeg.fromJson(legJson),
      notificationSentAt: n['sent_at'] == null ? null : '${n['sent_at']}',
      notificationEventType:
          n['event_type'] == null ? null : '${n['event_type']}',
    );
  }
}

const Map<String, String> _emptyLegStatusAr = {
  'available': 'متاحة',
  'reserved': 'محجوزة',
  'sold': 'مباعة',
  'expired': 'منتهية',
  'cancelled': 'ملغاة',
};

/// Arabic label for an empty-leg status; unknown -> raw code.
String emptyLegStatusAr(String code) => _emptyLegStatusAr[code] ?? code;

/// The user-facing reservation label (prefers the personal "reserved for you"
/// over the raw status).
String emptyLegReservationLabel(EmptyLeg leg) {
  if (leg.isReservedByMe) return 'محجوزة لك';
  return emptyLegStatusAr(leg.status);
}
