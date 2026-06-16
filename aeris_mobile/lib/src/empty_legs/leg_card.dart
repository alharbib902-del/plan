import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/async_states.dart';
import 'empty_leg.dart';
import 'empty_leg_status.dart';

/// A tappable empty-leg summary card. Tapping opens the detail by leg_number.
class LegCard extends StatelessWidget {
  const LegCard({required this.leg, super.key});

  final EmptyLeg leg;

  @override
  Widget build(BuildContext context) {
    final window = formatDate(leg.departureWindowStart);
    final discount = leg.currentDiscountPct;
    return Material(
      color: AerisColors.navyCard,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push('/empty-legs/${leg.legNumber}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      leg.routeLabel,
                      style: const TextStyle(
                        color: AerisColors.inkPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  StatusPill(
                    label: emptyLegReservationLabel(leg),
                    color: emptyLegPillColor(leg),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (window != null)
                Text('نافذة المغادرة: $window',
                    style: const TextStyle(color: AerisColors.inkSecondary)),
              if (leg.aircraft != null) ...[
                const SizedBox(height: 4),
                Text(leg.aircraft!,
                    style: const TextStyle(color: AerisColors.inkSecondary)),
              ],
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  if (discount != null && discount > 0)
                    _DiscountBadge(pct: discount)
                  else
                    const SizedBox.shrink(),
                  _PriceLine(leg: leg),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DiscountBadge extends StatelessWidget {
  const _DiscountBadge({required this.pct});
  final num pct;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: emptyLegSuccess.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text('خصم ${pct.toStringAsFixed(0)}%',
          style: const TextStyle(
              color: emptyLegSuccess, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }
}

/// Price line: shows the current price (+ struck-through original) when the
/// pricing flag is on; otherwise a neutral "price on request".
class _PriceLine extends StatelessWidget {
  const _PriceLine({required this.leg});
  final EmptyLeg leg;

  @override
  Widget build(BuildContext context) {
    if (!leg.pricingVisible || leg.currentPriceSar == null) {
      return const Text('السعر عند الطلب',
          style: TextStyle(color: AerisColors.inkMuted));
    }
    final original = leg.originalPriceSar;
    final showOriginal = original != null && original > leg.currentPriceSar!;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showOriginal) ...[
          Text(
            formatSar(original),
            style: const TextStyle(
              color: AerisColors.inkMuted,
              fontSize: 12,
              decoration: TextDecoration.lineThrough,
            ),
          ),
          const SizedBox(width: 8),
        ],
        Text(
          formatSar(leg.currentPriceSar),
          style: const TextStyle(
              color: AerisColors.gold, fontWeight: FontWeight.w800),
        ),
      ],
    );
  }
}
