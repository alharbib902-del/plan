import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/app_exception.dart';
import '../privilege/ledger_row_card.dart';
import '../privilege/privilege_repository.dart';
import '../widgets/async_states.dart';

/// The full cashback/loyalty ledger (last 100) for `/privilege/history`.
/// Read-only; gated server-side by ENABLE_PRIVILEGE.
class PrivilegeHistoryScreen extends ConsumerWidget {
  const PrivilegeHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(privilegeHistoryProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('سجل النقاط')),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(privilegeHistoryProvider),
        ),
        data: (ledger) => ledger.isEmpty
            ? const EmptyState(
                icon: Icons.receipt_long_outlined,
                message: 'لا توجد حركات في سجلّك بعد',
              )
            : RefreshIndicator(
                onRefresh: () => ref.refresh(privilegeHistoryProvider.future),
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: ledger.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (_, i) =>
                      LedgerRowCard(entry: ledger[i], showExpiry: true),
                ),
              ),
      ),
    );
  }
}
