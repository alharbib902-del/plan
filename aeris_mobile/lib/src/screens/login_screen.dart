import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../core/app_exception.dart';
import '../theme/aeris_theme.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _rememberMe = true;
  bool _submitting = false;
  String? _errorAr;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _errorAr = null;
    });
    final status = await ref
        .read(authControllerProvider.notifier)
        .login(
          email: _email.text.trim(),
          password: _password.text,
          rememberMe: _rememberMe,
        );
    if (!mounted) return;
    if (status == null) {
      // login() returns null on failure; surface the typed error.
      final err = ref.read(authControllerProvider).error;
      setState(() {
        _submitting = false;
        _errorAr = err is AppException
            ? err.messageAr
            : errorMessageAr('unknown');
      });
    }
    // On success the router redirects to /home automatically.
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'AERIS',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: AerisColors.gold,
                        fontSize: 34,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 5,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'تسجيل الدخول',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: AerisColors.inkSecondary,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 32),
                    if (_errorAr != null) ...[
                      _ErrorBanner(message: _errorAr!),
                      const SizedBox(height: 16),
                    ],
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      enabled: !_submitting,
                      decoration: const InputDecoration(
                        labelText: 'البريد الإلكتروني',
                      ),
                      validator: (v) =>
                          (v == null || v.trim().length < 3)
                          ? 'أدخل بريداً إلكترونياً صحيحاً'
                          : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _password,
                      obscureText: true,
                      enabled: !_submitting,
                      decoration: const InputDecoration(
                        labelText: 'كلمة المرور',
                      ),
                      validator: (v) => (v == null || v.isEmpty)
                          ? 'أدخل كلمة المرور'
                          : null,
                    ),
                    const SizedBox(height: 8),
                    SwitchListTile.adaptive(
                      value: _rememberMe,
                      onChanged: _submitting
                          ? null
                          : (v) => setState(() => _rememberMe = v),
                      title: const Text(
                        'تذكّرني',
                        style: TextStyle(color: AerisColors.inkSecondary),
                      ),
                      contentPadding: EdgeInsets.zero,
                      activeThumbColor: AerisColors.gold,
                    ),
                    const SizedBox(height: 16),
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
                          : const Text('دخول'),
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

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AerisColors.danger.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AerisColors.danger.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AerisColors.danger, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: AerisColors.inkPrimary),
            ),
          ),
        ],
      ),
    );
  }
}
