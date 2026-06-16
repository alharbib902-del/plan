/// Privilege models, mirroring `serializePrivilegeDashboardForMobile`
/// (`/api/v1/mobile/privilege*`).
///
/// STRICT allowlist — the raw loyalty-ledger + tier-change-log rows are an
/// ADMIN audit trail. The admin-internal fields
/// (admin_actor_cookie_fingerprint, admin_reason) and internal linkage
/// (client_id, source_change_log_id, source_subscription_id) are stripped by
/// the server serializer and are deliberately NOT modelled here, so even a
/// future query/serializer widening cannot surface through this client.
/// `fromJson` reads ONLY the allowlisted keys.
///
/// The client's OWN money fields (amount_sar / balance_after_sar /
/// cashback_balance_sar / qualified_spend) ARE shown — they arrive as
/// NUMERIC-as-string over PostgREST, so they are coerced to `num`.
library;

num? _number(dynamic v) =>
    v is num ? v : (v is String ? num.tryParse(v) : null);
String? _str(dynamic v) => v == null ? null : '$v';

/// The client's privilege columns (tier + cashback balance + thresholds).
class PrivilegeColumns {
  const PrivilegeColumns({
    required this.tier,
    this.tierAssignedAt,
    this.qualifiedSpend12mSar,
    this.belowThresholdSince,
    this.tierLockedUntil,
    this.cashbackBalanceSar,
    this.twoFactorEnabled = false,
  });

  final String tier;
  final String? tierAssignedAt;
  final num? qualifiedSpend12mSar;
  final String? belowThresholdSince;
  final String? tierLockedUntil;
  final num? cashbackBalanceSar;
  final bool twoFactorEnabled;

  factory PrivilegeColumns.fromJson(Map<String, dynamic> j) => PrivilegeColumns(
        tier: '${j['privilege_tier'] ?? ''}',
        tierAssignedAt: _str(j['privilege_tier_assigned_at']),
        qualifiedSpend12mSar: _number(j['qualified_spend_12m_sar']),
        belowThresholdSince: _str(j['below_threshold_since']),
        tierLockedUntil: _str(j['tier_locked_until']),
        cashbackBalanceSar: _number(j['cashback_balance_sar']),
        twoFactorEnabled: j['two_factor_enabled'] == true,
      );
}

/// A cashback / loyalty ledger entry (the client's own money movements).
class LedgerEntry {
  const LedgerEntry({
    required this.id,
    required this.eventType,
    this.amountSar,
    this.balanceAfterSar,
    this.bookingId,
    this.cashbackExpiryAt,
    this.createdAt,
  });

  final String id;
  final String eventType;
  final num? amountSar;
  final num? balanceAfterSar;
  final String? bookingId;
  final String? cashbackExpiryAt;
  final String? createdAt;

  factory LedgerEntry.fromJson(Map<String, dynamic> j) => LedgerEntry(
        id: '${j['id'] ?? ''}',
        eventType: '${j['event_type'] ?? ''}',
        amountSar: _number(j['amount_sar']),
        balanceAfterSar: _number(j['balance_after_sar']),
        bookingId: _str(j['booking_id']),
        cashbackExpiryAt: _str(j['cashback_expiry_at']),
        createdAt: _str(j['created_at']),
      );
}

/// A tier change-log entry (from → to + the structured reason).
class TierChangeEntry {
  const TierChangeEntry({
    required this.id,
    required this.fromTier,
    required this.toTier,
    required this.reason,
    this.qualifiedSpend12mSar,
    this.graceStartedAt,
    this.lockUntil,
    this.sourceBookingId,
    this.createdAt,
  });

  final String id;
  final String fromTier;
  final String toTier;
  final String reason;
  final num? qualifiedSpend12mSar;
  final String? graceStartedAt;
  final String? lockUntil;
  final String? sourceBookingId;
  final String? createdAt;

  factory TierChangeEntry.fromJson(Map<String, dynamic> j) => TierChangeEntry(
        id: '${j['id'] ?? ''}',
        fromTier: '${j['from_tier'] ?? ''}',
        toTier: '${j['to_tier'] ?? ''}',
        reason: '${j['reason'] ?? ''}',
        qualifiedSpend12mSar: _number(j['qualified_spend_12m_sar']),
        graceStartedAt: _str(j['grace_started_at']),
        lockUntil: _str(j['lock_until']),
        sourceBookingId: _str(j['source_booking_id']),
        createdAt: _str(j['created_at']),
      );
}

/// The full privilege dashboard payload.
class PrivilegeDashboard {
  const PrivilegeDashboard({
    required this.fullName,
    required this.privilege,
    this.recentLedger = const [],
    this.recentChangeLog = const [],
  });

  final String fullName;
  final PrivilegeColumns privilege;
  final List<LedgerEntry> recentLedger;
  final List<TierChangeEntry> recentChangeLog;

  factory PrivilegeDashboard.fromJson(Map<String, dynamic> j) {
    List<T> list<T>(dynamic raw, T Function(Map<String, dynamic>) f) =>
        raw is List
            ? raw
                .whereType<Map>()
                .map((m) => f(Map<String, dynamic>.from(m)))
                .toList()
            : <T>[];
    final p = j['privilege'];
    return PrivilegeDashboard(
      fullName: '${j['full_name'] ?? ''}',
      privilege: PrivilegeColumns.fromJson(
          p is Map ? Map<String, dynamic>.from(p) : const {}),
      recentLedger: list(j['recent_ledger'], LedgerEntry.fromJson),
      recentChangeLog: list(j['recent_change_log'], TierChangeEntry.fromJson),
    );
  }
}

// ── Arabic labels (mirror clientsAr; unknown codes fall back to the raw
//    code rather than a misleading guess) ───────────────────────────────

const Map<String, String> _tierAr = {
  'silver': 'فضي',
  'gold': 'ذهبي',
  'platinum': 'بلاتيني',
  'diamond': 'ماسي',
};

const Map<String, String> _ledgerEventAr = {
  'earn': 'كاش باك مكتسب',
  'redeem': 'استبدال',
  'adjust': 'تعديل',
  'expire': 'انتهاء صلاحية',
  'refund_back': 'إعادة بعد استرداد',
  'diamond_shield_granted': 'منح درع دايموند',
  'diamond_shield_skipped_paying_paid_plan': 'تخطّي درع دايموند (خطة مدفوعة)',
  'diamond_shield_revoked_on_downgrade': 'سحب درع دايموند عند التخفيض',
};

const Map<String, String> _tierReasonAr = {
  'signup_default': 'الفئة الافتراضية عند التسجيل',
  'auto_upgrade': 'ترقية تلقائية',
  'auto_downgrade': 'تخفيض تلقائي',
  'admin_force': 'تعديل إداري',
  'admin_lock_expired': 'انتهاء قفل الفئة',
  'data_correction': 'تصحيح بيانات',
};

/// Arabic label for a privilege tier code.
String privilegeTierAr(String code) => _tierAr[code] ?? code;

/// Arabic label for a ledger event-type code.
String ledgerEventTypeAr(String code) => _ledgerEventAr[code] ?? code;

/// Arabic label for a tier-change reason code.
String tierChangeReasonAr(String code) => _tierReasonAr[code] ?? code;
