import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../theme/aeris_theme.dart';

/// Minimal authed landing — proves the login→session→home flow.
/// The real dashboard (bookings/charter/empty-legs/privilege)
/// lands in later phases.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(authControllerProvider).valueOrNull;
    final name = status is Authenticated ? status.session.fullName : '';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Aeris'),
        actions: [
          IconButton(
            tooltip: 'تسجيل الخروج',
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.flight_takeoff, color: AerisColors.gold, size: 56),
              const SizedBox(height: 20),
              Text(
                name.isEmpty ? 'مرحباً بك' : 'مرحباً، $name',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AerisColors.inkPrimary,
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'تم تسجيل دخولك بنجاح. لوحة التحكم (الحجوزات والرحلات) قيد الإنشاء.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AerisColors.inkSecondary, height: 1.6),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
