/// An airport, mirroring `serializeAirportForMobile` (`/airports/search`).
class Airport {
  const Airport({
    required this.iataCode,
    this.icaoCode,
    this.name,
    this.nameAr,
    this.city,
    this.cityAr,
    this.country,
    this.countryAr,
    this.isPrivateCapable = false,
  });

  final String iataCode;
  final String? icaoCode;
  final String? name;
  final String? nameAr;
  final String? city;
  final String? cityAr;
  final String? country;
  final String? countryAr;
  final bool isPrivateCapable;

  factory Airport.fromJson(Map<String, dynamic> j) {
    String? str(dynamic v) => v == null ? null : '$v';
    return Airport(
      iataCode: '${j['iata_code'] ?? ''}',
      icaoCode: str(j['icao_code']),
      name: str(j['name']),
      nameAr: str(j['name_ar']),
      city: str(j['city']),
      cityAr: str(j['city_ar']),
      country: str(j['country']),
      countryAr: str(j['country_ar']),
      isPrivateCapable: j['is_private_capable'] == true,
    );
  }

  /// Arabic-first city, falling back to the English city or the IATA code.
  String get cityLabel => cityAr ?? city ?? iataCode;

  /// Arabic-first airport name, falling back to English or IATA.
  String get nameLabel => nameAr ?? name ?? iataCode;

  /// One-line display, e.g. "RUH · الرياض".
  String get displayLabel => '$iataCode · $cityLabel';
}
