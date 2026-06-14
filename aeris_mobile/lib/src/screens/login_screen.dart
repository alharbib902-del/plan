import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../theme/aeris_theme.dart';
import '../widgets/error_banner.dart';

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
    final err = await ref
        .read(authControllerProvider.notifier)
        .login(
          email: _email.text.trim(),
          password: _password.text,
          rememberMe: _rememberMe,
        );
    if (!mounted) return;
    // On success the router redirects to /home (or /change-password); on
    // failure show the typed error inline and re-enable the form.
    setState(() {
      _submitting = false;
      _errorAr = err?.messageAr;
    });
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
                      ErrorBanner(message: _errorAr!),
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
