import 'dart:async';

import 'device_tokens_repository.dart';
import 'push_token_source.dart';

/// Keeps the device-token registration in sync with the resolved
/// push-enabled state. It is a plain, dependency-injected class (no Riverpod)
/// so every branch is unit-testable; PR4b wires it reactively to
/// auth × deployed-flag × user opt-in once a real [PushTokenSource] exists.
///
/// The single source of truth is [sync]'s `enabled` flag, which the caller
/// computes from ALL gates (logged-in AND deployed flag AND user opt-in):
///   enabled true  → request OS permission, read the token, register it, and
///                   track refreshes.
///   enabled false → unregister the last token + stop tracking (logout, or the
///                   user/flag turning push off).
///
/// EVERY transition runs through a single-flight chain ([_run]) so enable /
/// disable / token-refresh can NEVER interleave — an enable that resumes after
/// a disable can't leave a live registration behind. Each step is also
/// fail-soft: a permission/token/network fault is swallowed, so push
/// registration can NEVER break login or any other flow.
class PushRegistrationCoordinator {
  PushRegistrationCoordinator({
    required DeviceTokensRepository repository,
    required PushTokenSource source,
  })  : _repository = repository,
        _source = source;

  final DeviceTokensRepository _repository;
  final PushTokenSource _source;

  bool _enabled = false;
  String? _registeredToken;
  StreamSubscription<String>? _refreshSub;

  // Serializes all state transitions; never rejects (fail-soft backstop), so
  // one failing step can neither wedge the chain nor surface to the caller.
  Future<void> _chain = Future<void>.value();

  Future<void> _run(Future<void> Function() op) {
    final next = _chain.then((_) => op()).catchError((Object _) {});
    _chain = next;
    return next;
  }

  Future<void> sync({required bool enabled}) =>
      _run(enabled ? _enable : _disable);

  Future<void> _enable() async {
    _enabled = true;
    // Idempotent on the REGISTERED token (not on attempts): a re-sync while
    // already registered must not re-prompt/re-register (login → /config
    // resolving can fire sync twice). A prior failed attempt leaves
    // _registeredToken null, so a later enable (or toggle off→on) retries.
    if (_registeredToken != null) return;
    final granted = await _source.requestPermission();
    if (!granted) return;
    // Subscribe to refreshes ONLY after permission is granted: a denied (or
    // throwing) requestPermission must leave NO live listener, otherwise a
    // later token refresh would register the device despite the user never
    // granting permission.
    _subscribeRefresh();
    final token = await _source.getToken();
    if (token == null || token.isEmpty) return;
    await _repository.register(token: token, platform: _source.platform);
    _registeredToken = token;
  }

  Future<void> _disable() async {
    _enabled = false;
    _unsubscribeRefresh();
    final token = _registeredToken;
    _registeredToken = null;
    if (token == null) return;
    await _repository.unregister(token: token);
  }

  void _subscribeRefresh() {
    _refreshSub ??=
        _source.onTokenRefresh.listen((t) => _run(() => _onTokenRefresh(t)));
  }

  void _unsubscribeRefresh() {
    _refreshSub?.cancel();
    _refreshSub = null;
  }

  // A rotated token replaces ours: register the new one (the server upserts by
  // token-hash). We do NOT unregister the old token client-side — that would
  // race the new registration; instead the stale row is reaped server-side
  // when the next push to it returns FCM UNREGISTERED (PR3b: classifyFcmResult
  // → 'delete' → deleteDeviceTokenByPlaintext). Guarded by _enabled because a
  // refresh event may still be queued behind a disable in the chain.
  Future<void> _onTokenRefresh(String token) async {
    if (!_enabled || token.isEmpty) return;
    await _repository.register(token: token, platform: _source.platform);
    _registeredToken = token;
  }

  void dispose() => _unsubscribeRefresh();
}
