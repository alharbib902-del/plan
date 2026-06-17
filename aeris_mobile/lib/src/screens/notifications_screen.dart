import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/app_config.dart';
import '../core/app_exception.dart';
import '../notifications/notification_prefs.dart';
import '../notifications/notifications_repository.dart';
import '../theme/aeris_theme.dart';
import '../widgets/async_states.dart';
import '../widgets/error_banner.dart';

/// Notification preferences (`/notifications`, reached from the profile
/// screen). STRICT full-replacement PATCH via a single "حفظ" button: the user
/// toggles locally, an "unsaved changes" hint shows, and Save sends the
/// COMPLETE object once (disabled while in flight, no double-submit). On
/// success the prefs are re-read; on failure the toggles are kept. A dead
/// session is handled app-wide.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(notificationPrefsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('تفضيلات الإشعارات')),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(notificationPrefsProvider),
        ),
        data: (p) => _PrefsForm(
          key: ValueKey('${p.emptyLegsEmail}|${p.emptyLegsWaLink}|'
              '${p.emptyLegsPush}|${p.marketing}'),
          initial: p,
        ),
      ),
    );
  }
}

class _PrefsForm extends ConsumerStatefulWidget {
  const _PrefsForm({required this.initial, super.key});

  final NotificationPrefs initial;

  @override
  ConsumerState<_PrefsForm> createState() => _PrefsFormState();
}

class _PrefsFormState extends ConsumerState<_PrefsForm> {
  late NotificationPrefs _current;
  bool _saving = false;
  String? _errorAr;

  @override
  void initState() {
    super.initState();
    _current = widget.initial;
  }

  bool get _dirty => _current != widget.initial;

  Future<void> _save() async {
    if (_saving || !_dirty) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _saving = true;
      _errorAr = null;
    });
    try {
      // FULL object, always — never a partial patch.
      await ref.read(notificationsRepositoryProvider).updatePrefs(_current);
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(const SnackBar(content: Text('تم حفظ التفضيلات')));
      // Refresh from server truth; reset _saving explicitly (the State may be
      // reused if the re-read returns identical values → same ValueKey).
      setState(() => _saving = false);
      ref.invalidate(notificationPrefsProvider);
    } on AppException catch (e) {
      if (!mounted) return;
      final s = e.retryAfterSeconds;
      // Keep the user's toggles on failure — only surface the error.
      setState(() {
        _saving = false;
        _errorAr = (e.code == 'rate_limited' && s != null)
            ? 'محاولات كثيرة، حاول بعد $s ثانية'
            : e.messageAr;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _errorAr = errorMessageAr('unknown');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // The push toggle appears only when the feature is deployed (fail-closed).
    // PR2: the toggle is wired into the saved payload, but NO push is sent yet
    // (the sender lands in PR3).
    final showPush =
        ref.watch(appConfigProvider).valueOrNull?.pushNotifications ?? false;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        if (_errorAr != null) ...[
          ErrorBanner(message: _errorAr!),
          const SizedBox(height: 16),
        ],
        const Text(
          'الرحلات الفارغة',
          style: TextStyle(
            color: AerisColors.inkPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 4),
        _switch(
          title: 'إشعارات البريد الإلكتروني',
          value: _current.emptyLegsEmail,
          onChanged: (v) =>
              setState(() => _current = _current.copyWith(emptyLegsEmail: v)),
        ),
        _switch(
          title: 'رابط واتساب',
          value: _current.emptyLegsWaLink,
          onChanged: (v) =>
              setState(() => _current = _current.copyWith(emptyLegsWaLink: v)),
        ),
        if (showPush)
          _switch(
            title: 'إشعارات الجهاز (Push)',
            value: _current.emptyLegsPush,
            onChanged: (v) =>
                setState(() => _current = _current.copyWith(emptyLegsPush: v)),
          ),
        const Divider(height: 28, color: AerisColors.border),
        _switch(
          title: 'العروض التسويقية',
          value: _current.marketing,
          onChanged: (v) =>
              setState(() => _current = _current.copyWith(marketing: v)),
        ),
        if (_dirty && !_saving) ...[
          const SizedBox(height: 12),
          const Text(
            'لديك تغييرات غير محفوظة',
            style: TextStyle(color: AerisColors.inkMuted, fontSize: 13),
          ),
        ],
        const SizedBox(height: 16),
        ElevatedButton(
          onPressed: (_dirty && !_saving) ? _save : null,
          child: _saving
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: AerisColors.navy,
                  ),
                )
              : const Text('حفظ'),
        ),
      ],
    );
  }

  Widget _switch({
    required String title,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return SwitchListTile.adaptive(
      value: value,
      onChanged: _saving ? null : onChanged,
      activeThumbColor: AerisColors.gold,
      contentPadding: EdgeInsets.zero,
      title: Text(title, style: const TextStyle(color: AerisColors.inkPrimary)),
    );
  }
}
