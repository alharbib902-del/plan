/// The platform push-SDK seam, as a CONTRACT only.
///
/// PR4a (this PR) ships the interface so the registration lifecycle
/// ([PushRegistrationCoordinator]) is fully unit-testable WITHOUT a real
/// Firebase project. There is DELIBERATELY no implementation here — not even a
/// no-op/placeholder — so nothing can read as "runtime ready" while the
/// external Firebase credentials are absent (build-now / run-later, like
/// payments). PR4b adds `FirebasePushTokenSource` (firebase_messaging) once the
/// founder provisions the Firebase project + native config.
abstract interface class PushTokenSource {
  /// Ask the OS for notification permission. Returns true iff granted.
  /// Called only when the user opts in (the agreed permission timing).
  Future<bool> requestPermission();

  /// The current device push token, or null when unavailable / not permitted.
  Future<String?> getToken();

  /// Emits a fresh token whenever the platform rotates it (re-registration).
  Stream<String> get onTokenRefresh;

  /// Backend platform identifier for this device ('ios' | 'android') — sent
  /// with the registration so the server knows which transport to use.
  String get platform;
}
