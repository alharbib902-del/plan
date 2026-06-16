import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/app_exception.dart';
import '../profile/profile.dart';
import '../profile/profile_repository.dart';
import '../theme/aeris_theme.dart';
import '../widgets/async_states.dart';
import '../widgets/error_banner.dart';

/// View + edit the client's profile (`/profile`). FULL-REPLACEMENT PATCH via a
/// single "حفظ" button: the user edits locally, an "unsaved changes" hint
/// shows, and Save sends the complete payload once (disabled while in flight,
/// no double-submit). On success the profile is re-read; on failure the edits
/// are kept. auth_email is read-only. A dead session is handled app-wide.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(profileProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('الملف الشخصي')),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(profileProvider),
        ),
        // Keyed by the loaded values so a post-save refresh rebuilds the form
        // from server truth.
        data: (p) => _ProfileForm(
          key: ValueKey('${p.fullName}|${p.contactPhone}|${p.marketingOptIn}'),
          initial: p,
        ),
      ),
    );
  }
}

class _ProfileForm extends ConsumerStatefulWidget {
  const _ProfileForm({required this.initial, super.key});

  final ClientProfile initial;

  @override
  ConsumerState<_ProfileForm> createState() => _ProfileFormState();
}

class _ProfileFormState extends ConsumerState<_ProfileForm> {
  late final TextEditingController _fullName;
  late final TextEditingController _phone;
  late bool _marketing;

  bool _saving = false;
  String? _errorAr;
  String? _fieldError;

  @override
  void initState() {
    super.initState();
    _fullName = TextEditingController(text: widget.initial.fullName);
    _phone = TextEditingController(text: widget.initial.contactPhone);
    _marketing = widget.initial.marketingOptIn;
  }

  @override
  void dispose() {
    _fullName.dispose();
    _phone.dispose();
    super.dispose();
  }

  // Compare TRIMMED text (the values actually sent + the server stores
  // trimmed), so a trailing-space-only edit doesn't enable a no-op save.
  bool get _dirty =>
      _fullName.text.trim() != widget.initial.fullName.trim() ||
      _phone.text.trim() != widget.initial.contactPhone.trim() ||
      _marketing != widget.initial.marketingOptIn;

  String? _validate() {
    final name = _fullName.text.trim();
    if (name.length < 2) return 'الاسم الكامل قصير جداً';
    if (name.length > 120) return 'الاسم الكامل طويل جداً';
    final phone = _phone.text.trim();
    if (phone.length < 6) return 'رقم الجوال قصير جداً';
    if (phone.length > 20) return 'رقم الجوال طويل جداً';
    return null;
  }

  Future<void> _save() async {
    if (_saving) return;
    final invalid = _validate();
    if (invalid != null) {
      setState(() => _fieldError = invalid);
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _saving = true;
      _errorAr = null;
      _fieldError = null;
    });
    try {
      await ref.read(profileRepositoryProvider).updateProfile(
            UpdateProfileInput(
              fullName: _fullName.text.trim(),
              phone: _phone.text.trim(),
              marketingOptIn: _marketing,
            ),
          );
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(const SnackBar(content: Text('تم حفظ التغييرات')));
      // Refresh from server truth (re-GET). Reset _saving explicitly rather
      // than relying on a ValueKey change to tear down this State — if the
      // re-read returns identical values the key is unchanged and the State
      // is reused, so a missing reset would leave the spinner stuck.
      setState(() => _saving = false);
      ref.invalidate(profileProvider);
    } on AppException catch (e) {
      if (!mounted) return;
      final fe = e.fieldErrors;
      final s = e.retryAfterSeconds;
      // Keep the user's edits on failure — only surface the error.
      setState(() {
        _saving = false;
        _errorAr = (e.code == 'rate_limited' && s != null)
            ? 'محاولات كثيرة، حاول بعد $s ثانية'
            : e.messageAr;
        _fieldError = (fe != null && fe.isNotEmpty) ? fe.values.first : null;
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
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        if (_errorAr != null) ...[
          ErrorBanner(message: _errorAr!),
          const SizedBox(height: 16),
        ],
        TextField(
          controller: _fullName,
          enabled: !_saving,
          textInputAction: TextInputAction.next,
          // Recompute dirty AND clear any stale validation error as the user
          // edits (matches the create-alert form).
          onChanged: (_) => setState(() => _fieldError = null),
          decoration: const InputDecoration(labelText: 'الاسم الكامل'),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _phone,
          enabled: !_saving,
          keyboardType: TextInputType.phone,
          onChanged: (_) => setState(() => _fieldError = null),
          decoration: const InputDecoration(labelText: 'رقم الجوال'),
        ),
        const SizedBox(height: 12),
        // auth_email is read-only — shown for reference, never editable/sent.
        InputDecorator(
          decoration: const InputDecoration(
            labelText: 'البريد الإلكتروني (غير قابل للتعديل)',
          ),
          child: Text(
            widget.initial.authEmail.isEmpty ? '—' : widget.initial.authEmail,
            style: const TextStyle(color: AerisColors.inkSecondary),
          ),
        ),
        const SizedBox(height: 8),
        SwitchListTile.adaptive(
          value: _marketing,
          onChanged: _saving ? null : (v) => setState(() => _marketing = v),
          activeThumbColor: AerisColors.gold,
          contentPadding: EdgeInsets.zero,
          title: const Text(
            'استقبال العروض التسويقية',
            style: TextStyle(color: AerisColors.inkPrimary),
          ),
        ),
        if (_fieldError != null) ...[
          const SizedBox(height: 8),
          Text(_fieldError!,
              style: const TextStyle(color: AerisColors.danger)),
        ],
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
        const SizedBox(height: 8),
        const Divider(color: AerisColors.border),
        // Settings hub: notification preferences live on their own screen.
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.notifications_outlined,
              color: AerisColors.gold),
          title: const Text('تفضيلات الإشعارات',
              style: TextStyle(color: AerisColors.inkPrimary)),
          trailing: const Icon(Icons.chevron_left, color: AerisColors.inkMuted),
          onTap: () => context.push('/notifications'),
        ),
      ],
    );
  }
}
