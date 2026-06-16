import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/app_exception.dart';
import '../privilege/ledger_row_card.dart';
import '../privilege/privilege.dart';
import '../privilege/privilege_repository.dart';
import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/async_states.dart';

/// The client's privilege dashboard (read-only) for `/privilege`: tier +
/// cashback balance + recent ledger + recent tier changes. Gated server-side
/// by ENABLE_PRIVILEGE — when off the route returns `flag_disabled`, shown as
/// an inline error. A dead session is handled app-wide.
class PrivilegeScreen extends ConsumerWidget {
  const PrivilegeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(privilegeDashboardProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('الامتياز')),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(privilegeDashboardProvider),
        ),
        data: (d) => RefreshIndicator(
          onRefresh: () => ref.refresh(privilegeDashboardProvider.future),
          child: _Body(dashboard: d),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.dashboard});

  final PrivilegeDashboard dashboard;

  @override
  Widget build(BuildContext context) {
    final p = dashboard.privilege;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        _TierHero(privilege: p),
        const SizedBox(height: 20),
        _kv('الإنفاق المؤهِّل (12 شهراً)', formatSar(p.qualifiedSpend12mSar)),
        if (formatDate(p.tierAssignedAt) != null)
          _kv('تاريخ منح الفئة', formatDate(p.tierAssignedAt)!),
        if (formatDate(p.tierLockedUntil) != null)
          _kv('الفئة مثبّتة حتى', formatDate(p.tierLockedUntil)!),
        if (formatDate(p.belowThresholdSince) != null)
          _kv('تحت الحدّ منذ', formatDate(p.belowThresholdSince)!),
        _kv('التحقق بخطوتين', p.twoFactorEnabled ? 'مُفعّل' : 'غير مُفعّل'),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () => context.push('/privilege/history'),
            icon: const Icon(Icons.history),
            label: const Text('السجل الكامل للنقاط'),
          ),
        ),
        if (dashboard.recentLedger.isNotEmpty) ...[
          const SizedBox(height: 24),
          _sectionTitle('أحدث الحركات'),
          const SizedBox(height: 8),
          ...dashboard.recentLedger.map(
            (e) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: LedgerRowCard(entry: e),
            ),
          ),
        ],
        if (dashboard.recentChangeLog.isNotEmpty) ...[
          const SizedBox(height: 24),
          _sectionTitle('تغيّرات الفئة'),
          const SizedBox(height: 8),
          ...dashboard.recentChangeLog.map((c) => _ChangeTile(change: c)),
        ],
      ],
    );
  }
}

class _TierHero extends StatelessWidget {
  const _TierHero({required this.privilege});

  final PrivilegeColumns privilege;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AerisColors.navyCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AerisColors.gold.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.workspace_premium,
                  color: AerisColors.gold, size: 28),
              const SizedBox(width: 10),
              Text(
                'فئة ${privilegeTierAr(privilege.tier)}',
                style: const TextStyle(
                  color: AerisColors.inkPrimary,
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          const Text(
            'رصيد الكاش باك',
            style: TextStyle(color: AerisColors.inkSecondary, fontSize: 13),
          ),
          const SizedBox(height: 4),
          Text(
            formatSar(privilege.cashbackBalanceSar),
            style: const TextStyle(
              color: AerisColors.gold,
              fontSize: 28,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _ChangeTile extends StatelessWidget {
  const _ChangeTile({required this.change});

  final TierChangeEntry change;

  @override
  Widget build(BuildContext context) {
    final date = formatDate(change.createdAt);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AerisColors.navyCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AerisColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${privilegeTierAr(change.fromTier)} ← ${privilegeTierAr(change.toTier)}',
            style: const TextStyle(
                color: AerisColors.inkPrimary, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            tierChangeReasonAr(change.reason),
            style: const TextStyle(color: AerisColors.inkSecondary, fontSize: 13),
          ),
          if (date != null) ...[
            const SizedBox(height: 4),
            Text(date,
                style:
                    const TextStyle(color: AerisColors.inkMuted, fontSize: 12)),
          ],
        ],
      ),
    );
  }
}

Widget _kv(String label, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AerisColors.inkSecondary)),
          Text(value,
              style: const TextStyle(
                  color: AerisColors.inkPrimary, fontWeight: FontWeight.w600)),
        ],
      ),
    );

Widget _sectionTitle(String t) => Text(
      t,
      style: const TextStyle(
        color: AerisColors.inkPrimary,
        fontSize: 17,
        fontWeight: FontWeight.w800,
      ),
    );
