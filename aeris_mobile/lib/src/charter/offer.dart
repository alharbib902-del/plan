/// An operator offer on a trip request, mirroring `serializeOfferForMobile`.
/// Strict allowlist — operator contact PII / dispatch internals are never sent.
/// `source` + `id` together identify the offer for accept/decline (slice 4b).
class Offer {
  const Offer({
    required this.id,
    required this.source,
    required this.status,
    this.operatorName,
    this.totalPriceSar,
    this.aircraftCategory,
    this.aircraftType,
    this.aircraftRegistration,
    this.departureEta,
    this.validityHours,
    this.expiresAt,
    this.notes,
    this.isCurrentRound = false,
    this.canAccept = false,
    this.canDecline = false,
    this.createdAt,
  });

  final String id;
  final String source;
  final String status;
  final String? operatorName;
  final num? totalPriceSar;
  final String? aircraftCategory;
  final String? aircraftType;
  final String? aircraftRegistration;
  final String? departureEta;
  final int? validityHours;
  final String? expiresAt;
  final String? notes;
  final bool isCurrentRound;
  final bool canAccept;
  final bool canDecline;
  final String? createdAt;

  factory Offer.fromJson(Map<String, dynamic> j) {
    String? str(dynamic v) => v == null ? null : '$v';
    num? number(dynamic v) =>
        v is num ? v : (v is String ? num.tryParse(v) : null);
    return Offer(
      id: '${j['id'] ?? ''}',
      source: '${j['source'] ?? ''}',
      status: '${j['status'] ?? ''}',
      operatorName: str(j['operator_name']),
      totalPriceSar: number(j['total_price_sar']),
      aircraftCategory: str(j['aircraft_category']),
      aircraftType: str(j['aircraft_type']),
      aircraftRegistration: str(j['aircraft_registration']),
      departureEta: str(j['departure_eta']),
      validityHours: j['validity_hours'] == null
          ? null
          : (j['validity_hours'] is int
              ? j['validity_hours'] as int
              : int.tryParse('${j['validity_hours']}')),
      expiresAt: str(j['expires_at']),
      notes: str(j['notes']),
      isCurrentRound: j['is_current_round'] == true,
      canAccept: j['can_accept'] == true,
      canDecline: j['can_decline'] == true,
      createdAt: str(j['created_at']),
    );
  }
}

const Map<String, String> _offerStatusAr = {
  'pending': 'قيد المراجعة',
  'viewed': 'تمت المشاهدة',
  'accepted': 'مقبول',
  'rejected': 'مرفوض',
  'expired': 'منتهي الصلاحية',
};

/// Arabic label for an offer status (mirrors clientsAr); unknown -> raw code.
String offerStatusAr(String code) => _offerStatusAr[code] ?? code;
