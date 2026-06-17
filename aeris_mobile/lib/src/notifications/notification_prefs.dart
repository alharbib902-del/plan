/// Notification preferences, mirroring `mapNotificationPreferences` +
/// the `/api/v1/mobile/me/notifications` envelope.
///
/// The PATCH contract is a full replacement: [toJson] ALWAYS emits the full
/// shape (never just the toggle that changed). `push` (PR2) is sent as part of
/// the empty_legs object; the server accepts it OPTIONALLY for now (an old app
/// that omits it stays valid), so a new app sending the full shape — including
/// push — is also accepted. push defaults OFF (opt-out) on read.
class NotificationPrefs {
  const NotificationPrefs({
    this.emptyLegsEmail = false,
    this.emptyLegsWaLink = false,
    this.emptyLegsPush = false,
    this.marketing = false,
  });

  final bool emptyLegsEmail;
  final bool emptyLegsWaLink;
  final bool emptyLegsPush;
  final bool marketing;

  factory NotificationPrefs.fromJson(Map<String, dynamic> j) {
    final el = j['empty_legs'];
    final elMap =
        el is Map ? Map<String, dynamic>.from(el) : const <String, dynamic>{};
    return NotificationPrefs(
      emptyLegsEmail: elMap['email'] == true,
      emptyLegsWaLink: elMap['wa_link'] == true,
      emptyLegsPush: elMap['push'] == true,
      marketing: j['marketing'] == true,
    );
  }

  /// FULL payload — always all keys (full replacement). `push` is included so
  /// the new app sends the complete shape; the server accepts it optionally.
  Map<String, dynamic> toJson() => {
        'empty_legs': {
          'email': emptyLegsEmail,
          'wa_link': emptyLegsWaLink,
          'push': emptyLegsPush,
        },
        'marketing': marketing,
      };

  NotificationPrefs copyWith({
    bool? emptyLegsEmail,
    bool? emptyLegsWaLink,
    bool? emptyLegsPush,
    bool? marketing,
  }) =>
      NotificationPrefs(
        emptyLegsEmail: emptyLegsEmail ?? this.emptyLegsEmail,
        emptyLegsWaLink: emptyLegsWaLink ?? this.emptyLegsWaLink,
        emptyLegsPush: emptyLegsPush ?? this.emptyLegsPush,
        marketing: marketing ?? this.marketing,
      );

  @override
  bool operator ==(Object other) =>
      other is NotificationPrefs &&
      other.emptyLegsEmail == emptyLegsEmail &&
      other.emptyLegsWaLink == emptyLegsWaLink &&
      other.emptyLegsPush == emptyLegsPush &&
      other.marketing == marketing;

  @override
  int get hashCode =>
      Object.hash(emptyLegsEmail, emptyLegsWaLink, emptyLegsPush, marketing);
}
