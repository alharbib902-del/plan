/// Client profile models, mirroring `mapClientProfileRow` +
/// the `/api/v1/mobile/me/profile` envelope.
///
/// STRICT allowlist: the GET serializer forwards ONLY these four fields from
/// the `clients` row — never password_hash, privilege/tier internals, session
/// columns, etc. — so none are modelled here. `auth_email` is READ-ONLY (it is
/// shown but never sent on PATCH).
class ClientProfile {
  const ClientProfile({
    this.fullName = '',
    this.contactPhone = '',
    this.authEmail = '',
    this.marketingOptIn = false,
  });

  final String fullName;
  final String contactPhone;
  final String authEmail;
  final bool marketingOptIn;

  factory ClientProfile.fromJson(Map<String, dynamic> j) => ClientProfile(
        fullName: '${j['full_name'] ?? ''}',
        contactPhone: '${j['contact_phone'] ?? ''}',
        authEmail: '${j['auth_email'] ?? ''}',
        marketingOptIn: j['marketing_opt_in'] == true,
      );
}

/// PATCH /me/profile payload — FULL REPLACEMENT (the server requires ALL
/// editable fields; a missing marketing_opt_in is rejected, never defaulted).
///
/// NOTE the key asymmetry: GET returns `contact_phone`, but PATCH accepts the
/// field under `phone`. auth_email is read-only and is NOT sent.
class UpdateProfileInput {
  const UpdateProfileInput({
    required this.fullName,
    required this.phone,
    required this.marketingOptIn,
  });

  final String fullName;
  final String phone;
  final bool marketingOptIn;

  Map<String, dynamic> toJson() => {
        'full_name': fullName,
        'phone': phone,
        'marketing_opt_in': marketingOptIn,
      };
}
