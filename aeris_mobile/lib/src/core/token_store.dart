import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure storage for the raw client session token.
///
/// The token is long-lived (up to 30 days) and grants full
/// account access, so it MUST live in the Keychain (iOS) /
/// EncryptedSharedPreferences+Keystore (Android) — never plain
/// SharedPreferences (FLUTTER-APP-PLAN.md §5 S6).
class TokenStore {
  TokenStore([FlutterSecureStorage? storage])
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(encryptedSharedPreferences: true),
          );

  final FlutterSecureStorage _storage;
  static const String _key = 'aeris_client_token';

  Future<String?> read() => _storage.read(key: _key);
  Future<void> write(String token) => _storage.write(key: _key, value: token);
  Future<void> clear() => _storage.delete(key: _key);
}

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());
