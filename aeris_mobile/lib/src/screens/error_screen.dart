import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../core/app_exception.dart';
import '../theme/aeris_theme.dart';

/// Shown when the auth lifecycle resolves to an error that did NOT clear
/// the token — a transient network fault, `flag_disabled`, or
/// `account_not_active`. The session is intact, so we offer a retry
/// (re-run the token validation) rather than dumping the user on /login.
class ErrorScreen extends ConsumerWidget {
  const ErrorScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final err = ref.watch(authControllerProvider).error;
    final messageAr = err is AppException ? err.messageAr : errorMessageAr('unknown');

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.cloud_off_outlined,
                    color: AerisColors.gold,
                    size: 52,
                  ),
                  const SizedBox(height: 18),
                  Text(
                    messageAr,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: AerisColors.inkPrimary,
                      fontSize: 17,
                      height: 1.6,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    // Re-run the token validation (AuthController.build).
                    onPressed: () =>
                        ref.invalidate(authControllerProvider),
                    child: const Text('إعادة المحاولة'),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: () =>
                        ref.read(authControllerProvider.notifier).logout(),
                    child: const Text('تسجيل الخروج'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
