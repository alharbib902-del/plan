import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../theme/aeris_theme.dart';

/// Hard lockout screen when the session carries
/// `password_must_change=true`. The router forces every route here
/// until the password is changed. The change-password call lands in
/// a later mobile-API PR; for now the user can log out.
class ChangePasswordScreen extends ConsumerWidget {
  const ChangePasswordScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('تغيير كلمة المرور')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.lock_outline, color: AerisColors.gold, size: 52),
              const SizedBox(height: 18),
              const Text(
                'يجب تغيير كلمة المرور قبل المتابعة',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AerisColors.inkPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'هذه الخطوة ستُفعَّل في تحديث قادم. يمكنك تسجيل الخروج حالياً.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AerisColors.inkSecondary, height: 1.6),
              ),
              const SizedBox(height: 24),
              TextButton(
                onPressed: () =>
                    ref.read(authControllerProvider.notifier).logout(),
                child: const Text('تسجيل الخروج'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
