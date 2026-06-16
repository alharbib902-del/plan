/// Notification preferences, mirroring `mapNotificationPreferences` +
/// the `/api/v1/mobile/me/notifications` envelope.
///
/// The PATCH contract is a STRICT FULL REPLACEMENT: the server schema is
/// `.strict()` at both levels and requires all three booleans
/// ({empty_legs:{email, wa_link}, marketing}); it rejects a partial patch or
/// any unknown key. So [toJson] ALWAYS emits all three — never just the toggle
/// that changed.
class NotificationPrefs {
  const NotificationPrefs({
    this.emptyLegsEmail = false,
    this.emptyLegsWaLink = false,
    this.marketing = false,
  });

  final bool emptyLegsEmail;
  final bool emptyLegsWaLink;
  final bool marketing;

  factory NotificationPrefs.fromJson(Map<String, dynamic> j) {
    final el = j['empty_legs'];
    final elMap =
        el is Map ? Map<String, dynamic>.from(el) : const <String, dynamic>{};
    return NotificationPrefs(
      emptyLegsEmail: elMap['email'] == true,
      emptyLegsWaLink: elMap['wa_link'] == true,
      marketing: j['marketing'] == true,
    );
  }

  /// FULL payload — always all three booleans (strict full replacement).
  Map<String, dynamic> toJson() => {
        'empty_legs': {'email': emptyLegsEmail, 'wa_link': emptyLegsWaLink},
        'marketing': marketing,
      };

  NotificationPrefs copyWith({
    bool? emptyLegsEmail,
    bool? emptyLegsWaLink,
    bool? marketing,
  }) =>
      NotificationPrefs(
        emptyLegsEmail: emptyLegsEmail ?? this.emptyLegsEmail,
        emptyLegsWaLink: emptyLegsWaLink ?? this.emptyLegsWaLink,
        marketing: marketing ?? this.marketing,
      );

  @override
  bool operator ==(Object other) =>
      other is NotificationPrefs &&
      other.emptyLegsEmail == emptyLegsEmail &&
      other.emptyLegsWaLink == emptyLegsWaLink &&
      other.marketing == marketing;

  @override
  int get hashCode => Object.hash(emptyLegsEmail, emptyLegsWaLink, marketing);
}
