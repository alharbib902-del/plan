import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/env.dart';

/// Deployed capability flags from `GET /api/v1/mobile/config`.
///
/// Fail-closed on the app side (FLUTTER-APP-PLAN.md §5 S9): if the
/// endpoint is unreachable, every feature-gated path is treated as
/// OFF (never open a gated surface on a network failure).
class AppConfig {
  const AppConfig({
    required this.clientPortal,
    required this.privilege,
    required this.payments,
    required this.clientEmptyLegsPortal,
    required this.emptyLegsClientPricing,
    required this.publicMarketplace,
    required this.pricingVisible,
    required this.minSupportedVersion,
  });

  final bool clientPortal;
  final bool privilege;
  final bool payments;
  final bool clientEmptyLegsPortal;
  final bool emptyLegsClientPricing;
  final bool publicMarketplace;
  final bool pricingVisible;
  final String minSupportedVersion;

  /// Everything OFF — used when /config can't be read.
  factory AppConfig.failClosed() => const AppConfig(
    clientPortal: false,
    privilege: false,
    payments: false,
    clientEmptyLegsPortal: false,
    emptyLegsClientPricing: false,
    publicMarketplace: false,
    pricingVisible: false,
    minSupportedVersion: '1.0.0',
  );

  factory AppConfig.fromJson(Map<String, dynamic> json) {
    final flags = json['flags'] is Map
        ? Map<String, dynamic>.from(json['flags'] as Map)
        : const <String, dynamic>{};
    bool flag(String k) => flags[k] == true;
    return AppConfig(
      clientPortal: flag('client_portal'),
      privilege: flag('privilege'),
      payments: flag('payments'),
      clientEmptyLegsPortal: flag('client_empty_legs_portal'),
      emptyLegsClientPricing: flag('empty_legs_client_pricing'),
      publicMarketplace: flag('public_marketplace'),
      pricingVisible: json['pricing_visible'] == true,
      minSupportedVersion: json['min_supported_version'] is String
          ? json['min_supported_version'] as String
          : '1.0.0',
    );
  }
}

/// Loads /config once on launch. Surfaces a fetch failure as AsyncError
/// (rather than swallowing it) so the UI can distinguish "still loading"
/// from "resolved-but-failed" and show the limited-mode banner (S9). The
/// fail-closed default lives at the call site: a null/error value is read
/// as `AppConfig.failClosed()`, so flag-gated surfaces stay OFF on failure.
final appConfigProvider = FutureProvider<AppConfig>((ref) async {
  final res = await ref
      .read(apiClientProvider)
      .getJson('${ApiEnv.apiPrefix}/config', auth: false);
  return AppConfig.fromJson(res);
});
