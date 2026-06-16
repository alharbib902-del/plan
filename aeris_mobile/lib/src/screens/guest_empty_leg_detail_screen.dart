import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/app_exception.dart';
import '../empty_legs/empty_leg.dart';
import '../empty_legs/empty_leg_status.dart';
import '../empty_legs/guest_empty_legs_repository.dart';
import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/async_states.dart';

/// Guest (pre-login) empty-leg detail by leg_number — READ-ONLY. There is no
/// reserve/release here; the only action is the "سجّل لتحجز" login wall, which
/// sends the guest to /login. Works for a shared `EL-XXXX` link even when
/// signed out (the backend surfaces terminal states so a stale link renders).
class GuestEmptyLegDetailScreen extends ConsumerWidget {
  const GuestEmptyLegDetailScreen({required this.legNumber, super.key});

  final String legNumber;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(guestEmptyLegDetailProvider(legNumber));
    return Scaffold(
      appBar: AppBar(title: const Text('تفاصيل الرحلة الفارغة')),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(guestEmptyLegDetailProvider(legNumber)),
        ),
        data: (leg) => _GuestDetailBody(leg: leg),
      ),
    );
  }
}

class _GuestDetailBody extends StatelessWidget {
  const _GuestDetailBody({required this.leg});

  final EmptyLeg leg;

  @override
  Widget build(BuildContext context) {
    final start = formatDateTime(leg.departureWindowStart);
    final end = formatDateTime(leg.departureWindowEnd);
    final window =
        (start != null && end != null) ? '$start — $end' : (start ?? '—');
    final discount = leg.currentDiscountPct;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
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
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              // Guest never has a personal reservation → plain status label.
              StatusPill(
                label: emptyLegStatusAr(leg.status),
                color: emptyLegPillColor(leg),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(leg.legNumber,
              style: const TextStyle(color: AerisColors.inkSecondary)),
          const SizedBox(height: 18),
          _row('نافذة المغادرة', window),
          if (leg.flexibilityHours != null)
            _row('المرونة', '${leg.flexibilityHours} ساعة'),
          if (leg.aircraft != null) _row('الطائرة', leg.aircraft!),
          if (leg.maxPassengers != null)
            _row('أقصى عدد ركّاب', '${leg.maxPassengers}'),
          if (discount != null && discount > 0)
            _row('الخصم الحالي', '${discount.toStringAsFixed(0)}%'),
          if (leg.auctionWindowEndAt != null)
            _row('ينتهي العرض', formatDateTime(leg.auctionWindowEndAt) ?? '—'),
          const Divider(height: 32, color: AerisColors.border),
          _PriceBlock(leg: leg),
          const SizedBox(height: 24),
          // The login wall: a guest cannot reserve — they sign in first.
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => context.go('/login'),
              child: const Text('سجّل لتحجز'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 130,
            child: Text(label,
                style: const TextStyle(color: AerisColors.inkSecondary)),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(
                    color: AerisColors.inkPrimary,
                    fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

class _PriceBlock extends StatelessWidget {
  const _PriceBlock({required this.leg});
  final EmptyLeg leg;

  @override
  Widget build(BuildContext context) {
    if (!leg.pricingVisible || leg.currentPriceSar == null) {
      return const Text('السعر عند الطلب',
          style: TextStyle(color: AerisColors.inkSecondary, fontSize: 16));
    }
    final original = leg.originalPriceSar;
    final showOriginal = original != null && original > leg.currentPriceSar!;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          formatSar(leg.currentPriceSar),
          style: const TextStyle(
            color: AerisColors.gold,
            fontSize: 24,
            fontWeight: FontWeight.w800,
          ),
        ),
        if (showOriginal) ...[
          const SizedBox(width: 12),
          Text(
            formatSar(original),
            style: const TextStyle(
              color: AerisColors.inkMuted,
              decoration: TextDecoration.lineThrough,
            ),
          ),
        ],
      ],
    );
  }
}
