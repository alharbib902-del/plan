import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/app_exception.dart';
import '../empty_legs/guest_empty_legs_repository.dart';
import '../empty_legs/leg_card.dart';
import '../theme/aeris_theme.dart';
import '../widgets/async_states.dart';

/// Pre-login guest browse of the public empty-legs marketplace (read-only).
/// No matches/alerts/reserve — those are authed. Cards route to the GUEST
/// detail (`/guest/empty-legs/:legNumber`); a "تسجيل الدخول" action lets the
/// guest sign in to book.
class GuestEmptyLegsScreen extends ConsumerWidget {
  const GuestEmptyLegsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(guestEmptyLegsListProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('الرحلات الفارغة'),
        actions: [
          TextButton(
            onPressed: () => context.go('/login'),
            child: const Text('تسجيل الدخول'),
          ),
        ],
      ),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(guestEmptyLegsListProvider),
        ),
        data: (legs) => legs.isEmpty
            ? const EmptyState(
                icon: Icons.airlines_outlined,
                message: 'لا توجد رحلات فارغة متاحة حالياً',
              )
            : RefreshIndicator(
                onRefresh: () =>
                    ref.refresh(guestEmptyLegsListProvider.future),
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: legs.length + 1,
                  separatorBuilder: (_, _) => const SizedBox(height: 12),
                  itemBuilder: (_, i) {
                    if (i == 0) return const _GuestHint();
                    return LegCard(
                      leg: legs[i - 1],
                      detailBasePath: '/guest/empty-legs',
                    );
                  },
                ),
              ),
      ),
    );
  }
}

class _GuestHint extends StatelessWidget {
  const _GuestHint();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AerisColors.gold.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AerisColors.gold.withValues(alpha: 0.35)),
      ),
      child: const Row(
        children: [
          Icon(Icons.info_outline, color: AerisColors.gold, size: 20),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'أنت تتصفّح كضيف. سجّل الدخول لحجز أي رحلة.',
              style: TextStyle(color: AerisColors.inkPrimary),
            ),
          ),
        ],
      ),
    );
  }
}
