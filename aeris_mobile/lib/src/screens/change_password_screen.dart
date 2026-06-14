import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../theme/aeris_theme.dart';
import '../widgets/error_banner.dart';

/// Lockout-unlock screen for `password_must_change=true`. The router
/// forces every route here until the password is changed. Submitting a
/// valid new password clears the flag server-side; the controller then
/// re-fetches the (now unlocked) session and the router redirects home.
///
/// A wrong CURRENT password returns `current_password_invalid` — shown
/// inline, with the session left intact (the user is NOT logged out).
class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() =>
      _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _submitting = false;
  String? _errorAr;
  String? _nextFieldErrorAr;
  String? _currentFieldErrorAr;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String? _validateNewPassword(String? v) {
    // Mirror the server passwordPlaintextSchema (min 10 + letter + digit)
    // so a form-valid password is never rejected server-side (which would
    // also burn a rate-limited mutation attempt).
    final s = v ?? '';
    if (s.length < 10) return 'كلمة المرور الجديدة 10 أحرف على الأقل';
    if (s.length > 128) return 'كلمة المرور طويلة جداً';
    if (!RegExp(r'[A-Za-z]').hasMatch(s)) {
      return 'يجب أن تحوي حرفاً واحداً على الأقل';
    }
    if (!RegExp(r'[0-9]').hasMatch(s)) {
      return 'يجب أن تحوي رقماً واحداً على الأقل';
    }
    return null;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _errorAr = null;
      _nextFieldErrorAr = null;
      _currentFieldErrorAr = null;
    });
    final err = await ref
        .read(authControllerProvider.notifier)
        .changePassword(
          currentPassword: _current.text,
          newPassword: _next.text,
        );
    if (!mounted) return;
    // Always release the UI lock. On success the router navigates away
    // (Authenticated→/home, dead session→/login, transient→/error); if
    // for any reason it does NOT, the user must never be frozen with the
    // fields + escape controls disabled.
    setState(() {
      _submitting = false;
      if (err == null) return;
      _errorAr = err.messageAr;
      if (err.code == 'validation_failed') {
        _nextFieldErrorAr = err.fieldErrors?['new_password'];
        _currentFieldErrorAr = err.fieldErrors?['current_password'];
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('تغيير كلمة المرور')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(
                      Icons.lock_outline,
                      color: AerisColors.gold,
                      size: 48,
                    ),
                    const SizedBox(height: 14),
                    const Text(
                      'يجب تغيير كلمة المرور قبل المتابعة',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: AerisColors.inkPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 24),
                    if (_errorAr != null) ...[
                      ErrorBanner(message: _errorAr!),
                      const SizedBox(height: 16),
                    ],
                    TextFormField(
                      controller: _current,
                      obscureText: true,
                      enabled: !_submitting,
                      decoration: InputDecoration(
                        labelText: 'كلمة المرور الحالية',
                        errorText: _currentFieldErrorAr,
                      ),
                      onChanged: (_) {
                        if (_currentFieldErrorAr != null) {
                          setState(() => _currentFieldErrorAr = null);
                        }
                      },
                      validator: (v) => (v == null || v.isEmpty)
                          ? 'أدخل كلمة المرور الحالية'
                          : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _next,
                      obscureText: true,
                      enabled: !_submitting,
                      decoration: InputDecoration(
                        labelText: 'كلمة المرور الجديدة',
                        helperText: '10 أحرف على الأقل مع حرف ورقم',
                        errorText: _nextFieldErrorAr,
                      ),
                      onChanged: (_) {
                        if (_nextFieldErrorAr != null) {
                          setState(() => _nextFieldErrorAr = null);
                        }
                      },
                      validator: _validateNewPassword,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _confirm,
                      obscureText: true,
                      enabled: !_submitting,
                      decoration: const InputDecoration(
                        labelText: 'تأكيد كلمة المرور الجديدة',
                      ),
                      validator: (v) => (v != _next.text)
                          ? 'كلمتا المرور غير متطابقتين'
                          : null,
                    ),
                    const SizedBox(height: 20),
                    ElevatedButton(
                      onPressed: _submitting ? null : _submit,
                      child: _submitting
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                color: AerisColors.navy,
                              ),
                            )
                          : const Text('تغيير كلمة المرور'),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: _submitting
                          ? null
                          : () =>
                                ref.read(authControllerProvider.notifier).logout(),
                      child: const Text('تسجيل الخروج'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
