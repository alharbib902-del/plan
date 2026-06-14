/// Build-time API base URL (flavor-style via --dart-define).
///
/// Default targets the Android emulator's host-loopback alias
/// (10.0.2.2 → the dev machine's localhost:3000 where `next dev`
/// runs). Override per environment:
///   flutter run --dart-define=AERIS_API_BASE_URL=https://staging.aeris.sa
class ApiEnv {
  const ApiEnv._();

  static const String baseUrl = String.fromEnvironment(
    'AERIS_API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  /// Versioned mobile API prefix (matches the Next.js routes).
  static const String apiPrefix = '/api/v1/mobile';
}
