/// A client booking, mirroring `serializeBookingForMobile`
/// (`/api/v1/mobile/bookings*`) — a strict allowlist: no commission /
/// operator payout / checkout secret / operator contact PII / ZATCA
/// internals are ever sent, so none are modelled here.
class Booking {
  const Booking({
    required this.id,
    required this.bookingNumber,
    required this.paymentStatus,
    required this.flightStatus,
    this.routeOriginLabel,
    this.routeDestinationLabel,
    this.passengers = 0,
    this.returnScheduled = false,
    this.aircraft,
    this.operatorName,
    this.baseAmount,
    this.addonsAmount,
    this.vatAmount,
    this.totalAmount,
    this.departureScheduled,
    this.departureActual,
    this.arrivalActual,
    this.zatcaInvoiceUrl,
    this.loyaltyPointsEarned,
    this.cancelledAt,
  });

  final String id;
  final String bookingNumber;
  final String paymentStatus;
  final String flightStatus;
  final String? routeOriginLabel;
  final String? routeDestinationLabel;
  final int passengers;
  final bool returnScheduled;
  final String? aircraft;
  final String? operatorName;
  final num? baseAmount;
  final num? addonsAmount;
  final num? vatAmount;
  final num? totalAmount;
  final String? departureScheduled;
  final String? departureActual;
  final String? arrivalActual;
  final String? zatcaInvoiceUrl;
  final int? loyaltyPointsEarned;
  final String? cancelledAt;

  factory Booking.fromJson(Map<String, dynamic> j) {
    String? str(dynamic v) => v == null ? null : '$v';
    num? number(dynamic v) =>
        v is num ? v : (v is String ? num.tryParse(v) : null);
    int intOr(dynamic v, int fallback) =>
        v is int ? v : (int.tryParse('${v ?? ''}') ?? fallback);

    return Booking(
      id: '${j['id'] ?? ''}',
      bookingNumber: '${j['booking_number'] ?? ''}',
      paymentStatus: '${j['payment_status'] ?? ''}',
      flightStatus: '${j['flight_status'] ?? ''}',
      routeOriginLabel: str(j['route_origin_label']),
      routeDestinationLabel: str(j['route_destination_label']),
      passengers: intOr(j['passengers'], 0),
      returnScheduled: j['return_scheduled'] == true,
      aircraft: str(j['aircraft']),
      operatorName: str(j['operator_name']),
      baseAmount: number(j['base_amount']),
      addonsAmount: number(j['addons_amount']),
      vatAmount: number(j['vat_amount']),
      totalAmount: number(j['total_amount']),
      departureScheduled: str(j['departure_scheduled']),
      departureActual: str(j['departure_actual']),
      arrivalActual: str(j['arrival_actual']),
      zatcaInvoiceUrl: str(j['zatca_invoice_url']),
      loyaltyPointsEarned: j['loyalty_points_earned'] == null
          ? null
          : intOr(j['loyalty_points_earned'], 0),
      cancelledAt: str(j['cancelled_at']),
    );
  }

  /// "origin إلى destination" (reads naturally RTL).
  String get routeLabel =>
      '${routeOriginLabel ?? '—'} إلى ${routeDestinationLabel ?? '—'}';
}

const Map<String, String> _flightStatusAr = {
  'confirmed': 'مؤكّد',
  'boarding': 'في الإركاب',
  'in_flight': 'في الجو',
  'completed': 'مكتمل',
  'cancelled': 'ملغى',
};

const Map<String, String> _paymentStatusAr = {
  'pending': 'في انتظار الدفع',
  'pending_offline': 'بانتظار الدفع',
  'paid': 'مدفوع',
  'refunded': 'مسترجع',
};

/// Arabic label for a flight status code (mirrors clientsAr); unknown
/// codes fall back to the raw code rather than a misleading guess.
String flightStatusAr(String code) => _flightStatusAr[code] ?? code;

/// Arabic label for a payment status code (mirrors clientsAr).
String paymentStatusAr(String code) => _paymentStatusAr[code] ?? code;
