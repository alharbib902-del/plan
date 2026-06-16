/// A client's empty-leg price alert, mirroring `serializeAlertForMobile`.
class Alert {
  const Alert({
    required this.id,
    this.originIata,
    this.destinationIata,
    this.maxPriceSar,
    this.dateFrom,
    this.dateTo,
    this.channels = const [],
    this.isActive = true,
    this.createdAt,
  });

  final String id;
  final String? originIata;
  final String? destinationIata;
  final num? maxPriceSar;
  final String? dateFrom;
  final String? dateTo;
  final List<String> channels;
  final bool isActive;
  final String? createdAt;

  factory Alert.fromJson(Map<String, dynamic> j) {
    String? str(dynamic v) => v == null ? null : '$v';
    final ch = j['channels'];
    return Alert(
      id: '${j['id'] ?? ''}',
      originIata: str(j['origin_iata']),
      destinationIata: str(j['destination_iata']),
      maxPriceSar: j['max_price_sar'] is num
          ? j['max_price_sar'] as num
          : num.tryParse('${j['max_price_sar'] ?? ''}'),
      dateFrom: str(j['date_from']),
      dateTo: str(j['date_to']),
      channels: ch is List ? ch.map((c) => '$c').toList() : const [],
      isActive: j['is_active'] == true,
      createdAt: str(j['created_at']),
    );
  }

  /// "origin إلى destination" (reads naturally RTL).
  String get routeLabel =>
      '${originIata ?? '—'} إلى ${destinationIata ?? '—'}';
}

/// Payload for POST /empty-legs/alerts. Dates are YYYY-MM-DD; optionals are
/// omitted when null (the server treats absent as "no ceiling / any date").
class CreateAlertInput {
  const CreateAlertInput({
    required this.originIata,
    required this.destinationIata,
    this.maxPriceSar,
    this.dateFrom,
    this.dateTo,
  });

  final String originIata;
  final String destinationIata;
  final num? maxPriceSar;
  final String? dateFrom;
  final String? dateTo;

  Map<String, dynamic> toJson() => {
        'origin_iata': originIata,
        'destination_iata': destinationIata,
        if (maxPriceSar != null) 'max_price_sar': maxPriceSar,
        if (dateFrom != null) 'date_from': dateFrom,
        if (dateTo != null) 'date_to': dateTo,
      };
}
