import 'package:flutter/material.dart';

import '../theme/aeris_theme.dart';
import 'booking.dart';

const Color _success = Color(0xFF3FB68B);

/// A small status pill for a booking's flight / payment status.
class StatusChip extends StatelessWidget {
  const StatusChip._({required this.label, required this.color});

  /// Flight status (confirmed/boarding/in_flight/completed/cancelled).
  factory StatusChip.flight(String code) => StatusChip._(
        label: flightStatusAr(code),
        color: code == 'cancelled' ? AerisColors.danger : AerisColors.gold,
      );

  /// Payment status (pending/pending_offline/paid/refunded).
  factory StatusChip.payment(String code) => StatusChip._(
        label: paymentStatusAr(code),
        color: switch (code) {
          'paid' => _success,
          'refunded' => AerisColors.danger,
          _ => AerisColors.gold,
        },
      );

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }
}
