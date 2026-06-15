import 'package:flutter/material.dart';

import '../theme/aeris_theme.dart';

/// Centered loading spinner for AsyncValue.loading branches.
class LoadingState extends StatelessWidget {
  const LoadingState({super.key});

  @override
  Widget build(BuildContext context) => const Center(
        child: SizedBox(
          width: 26,
          height: 26,
          child: CircularProgressIndicator(
            strokeWidth: 2.5,
            color: AerisColors.gold,
          ),
        ),
      );
}

/// Error state with a localized message + a retry action. Used for the
/// non-session faults (a dead session is handled app-wide before here).
class ErrorState extends StatelessWidget {
  const ErrorState({required this.message, required this.onRetry, super.key});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: AerisColors.danger, size: 44),
            const SizedBox(height: 14),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AerisColors.inkPrimary, height: 1.6),
            ),
            const SizedBox(height: 18),
            OutlinedButton(onPressed: onRetry, child: const Text('إعادة المحاولة')),
          ],
        ),
      ),
    );
  }
}

/// Empty-list placeholder.
class EmptyState extends StatelessWidget {
  const EmptyState({required this.icon, required this.message, super.key});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: AerisColors.inkMuted, size: 48),
            const SizedBox(height: 14),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AerisColors.inkSecondary),
            ),
          ],
        ),
      ),
    );
  }
}
