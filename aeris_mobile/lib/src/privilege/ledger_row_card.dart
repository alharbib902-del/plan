import 'package:flutter/material.dart';

import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import 'privilege.dart';

/// A single cashback/loyalty ledger row — shared by the privilege dashboard
/// (recent activity) and the full history screen, so the two never drift.
/// [showExpiry] adds the cashback-expiry line (history only). A negative
/// amount (redeem / expire) is tinted differently from a positive credit
/// (earn) so a debit can't read as a credit at a glance.
class LedgerRowCard extends StatelessWidget {
  const LedgerRowCard({required this.entry, this.showExpiry = false, super.key});

  final LedgerEntry entry;
  final bool showExpiry;

  @override
  Widget build(BuildContext context) {
    final date = formatDate(entry.createdAt);
    final expiry = showExpiry ? formatDate(entry.cashbackExpiryAt) : null;
    final negative = (entry.amountSar ?? 0) < 0;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AerisColors.navyCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AerisColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  ledgerEventTypeAr(entry.eventType),
                  style: const TextStyle(
                    color: AerisColors.inkPrimary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (date != null) ...[
                  const SizedBox(height: 4),
                  Text(date,
                      style: const TextStyle(
                          color: AerisColors.inkMuted, fontSize: 12)),
                ],
                if (expiry != null) ...[
                  const SizedBox(height: 2),
                  Text('تنتهي صلاحيته: $expiry',
                      style: const TextStyle(
                          color: AerisColors.inkMuted, fontSize: 12)),
                ],
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                formatSar(entry.amountSar),
                style: TextStyle(
                  color: negative ? AerisColors.inkSecondary : AerisColors.gold,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (entry.balanceAfterSar != null) ...[
                const SizedBox(height: 4),
                Text('الرصيد: ${formatSar(entry.balanceAfterSar)}',
                    style: const TextStyle(
                        color: AerisColors.inkMuted, fontSize: 12)),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
