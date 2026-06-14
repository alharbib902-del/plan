import 'package:flutter/material.dart';

import '../theme/aeris_theme.dart';

/// Inline danger banner for form-level error messages (Arabic).
/// Shared by the login + change-password forms so the error
/// presentation stays consistent.
class ErrorBanner extends StatelessWidget {
  const ErrorBanner({required this.message, super.key});

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
