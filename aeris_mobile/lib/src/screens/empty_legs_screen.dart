import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../empty_legs/empty_legs_repository.dart';
import '../empty_legs/leg_card.dart';
import '../core/app_exception.dart';
import '../widgets/async_states.dart';

/// Empty-legs browse for the signed-in client: two tabs — all available legs
/// ("تصفّح الكل") and the client's matched legs ("مطاباتي"). Read-only in
/// slice 5a (reserve/release land in 5b). The whole surface is gated server-
/// side by ENABLE_CLIENT_EMPTY_LEGS_PORTAL; a `flag_disabled` shows a notice.
class EmptyLegsScreen extends ConsumerWidget {
  const EmptyLegsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('الرحلات الفارغة'),
          bottom: const TabBar(
            tabs: [Tab(text: 'تصفّح الكل'), Tab(text: 'مطاباتي')],
          ),
        ),
        body: const TabBarView(children: [_BrowseTab(), _MatchesTab()]),
      ),
    );
  }
}

class _BrowseTab extends ConsumerWidget {
  const _BrowseTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(emptyLegsListProvider);
    return async.when(
      loading: () => const LoadingState(),
      error: (e, _) => ErrorState(
        message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
        onRetry: () => ref.invalidate(emptyLegsListProvider),
      ),
      data: (legs) => legs.isEmpty
          ? const EmptyState(
              icon: Icons.airlines_outlined,
              message: 'لا توجد رحلات فارغة متاحة حالياً',
            )
          : RefreshIndicator(
              onRefresh: () => ref.refresh(emptyLegsListProvider.future),
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: legs.length,
                separatorBuilder: (_, _) => const SizedBox(height: 12),
                itemBuilder: (_, i) => LegCard(leg: legs[i]),
              ),
            ),
    );
  }
}

class _MatchesTab extends ConsumerWidget {
  const _MatchesTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(emptyLegMatchesProvider);
    return async.when(
      loading: () => const LoadingState(),
      error: (e, _) => ErrorState(
        message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
        onRetry: () => ref.invalidate(emptyLegMatchesProvider),
      ),
      data: (matches) => matches.isEmpty
          ? const EmptyState(
              icon: Icons.notifications_none,
              message: 'لم يصلك أي عرض رحلة فارغة مطابق بعد',
            )
          : RefreshIndicator(
              onRefresh: () => ref.refresh(emptyLegMatchesProvider.future),
              child: ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: matches.length,
                separatorBuilder: (_, _) => const SizedBox(height: 12),
                itemBuilder: (_, i) => LegCard(leg: matches[i].leg),
              ),
            ),
    );
  }
}
