/// Client session context returned by `GET /me/session`
/// (mirrors the server `ClientSessionContext`).
class ClientSession {
  const ClientSession({
    required this.clientId,
    required this.fullName,
    required this.contactPhone,
    required this.expiresAt,
    required this.passwordMustChange,
  });

  final String clientId;
  final String fullName;
  final String contactPhone;
  final String expiresAt;
  final bool passwordMustChange;

  factory ClientSession.fromJson(Map<String, dynamic> json) {
    return ClientSession(
      clientId: '${json['client_id'] ?? ''}',
      fullName: '${json['full_name'] ?? ''}',
      contactPhone: '${json['contact_phone'] ?? ''}',
      expiresAt: '${json['expires_at'] ?? ''}',
      passwordMustChange: json['password_must_change'] == true,
    );
  }
}
