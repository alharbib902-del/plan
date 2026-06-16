import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/app_exception.dart';
import '../empty_legs/alert.dart';
import '../empty_legs/empty_legs_repository.dart';
import '../empty_legs/leg_card.dart';
import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/async_states.dart';
import 'create_alert_screen.dart';

/// Empty-legs for the signed-in client: browse-all, matches, and the client's
/// price alerts (create/toggle/delete — slice 5b).
///
/// Feature-flag boundary mirrors the backend contract (it is NOT one flag for
/// the whole surface):
/// - browse / matches / detail / reserve / release are gated by the empty-legs
///   contract — ENABLE_CLIENT_EMPTY_LEGS_PORTAL (the route- and core-level
///   guard); when off they return `flag_disabled`, shown as a notice.
/// - alerts (list/create/toggle/delete) run for any authenticated client per
///   the backend contract — the base client portal only (requireClientBearer),
///   NOT the empty-legs flag, matching the web; their mutations are
///   rate-limited (and every action disables while in flight).
/// This screen adds no guest browsing and no pre-login route.
class EmptyLegsScreen extends ConsumerWidget {
  const EmptyLegsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('الرحلات الفارغة'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'تصفّح الكل'),
              Tab(text: 'مطاباتي'),
              Tab(text: 'تنبيهاتي'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [_BrowseTab(), _MatchesTab(), _AlertsTab()],
        ),
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

class _AlertsTab extends ConsumerStatefulWidget {
  const _AlertsTab();

  @override
  ConsumerState<_AlertsTab> createState() => _AlertsTabState();
}

class _AlertsTabState extends ConsumerState<_AlertsTab> {
  bool _busy = false;

  Future<void> _newAlert() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => const CreateAlertScreen()),
    );
    // CreateAlertScreen invalidates the list on success; nothing to do here.
  }

  Future<void> _toggle(Alert a, bool active) async {
    if (_busy) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await ref.read(emptyLegsRepositoryProvider).toggleAlert(a.id, active);
      if (!mounted) return;
      ref.invalidate(emptyLegAlertsProvider);
      setState(() => _busy = false);
    } on AppException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(_err(e))));
    } catch (_) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(errorMessageAr('unknown'))));
    }
  }

  Future<void> _delete(Alert a) async {
    if (_busy) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('حذف التنبيه؟'),
        content: Text('سيُحذف تنبيه ${a.routeLabel}.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('تراجع')),
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('حذف')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await ref.read(emptyLegsRepositoryProvider).deleteAlert(a.id);
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(const SnackBar(content: Text('تم حذف التنبيه')));
      ref.invalidate(emptyLegAlertsProvider);
      // The list rebuilds, but this State is NOT torn down — must clear _busy
      // here or the whole tab (new-alert button + every Switch/delete) locks.
      setState(() => _busy = false);
    } on AppException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(_err(e))));
    } catch (_) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(errorMessageAr('unknown'))));
    }
  }

  String _err(AppException e) {
    if (e.code == 'rate_limited') {
      final s = e.retryAfterSeconds;
      return s != null ? 'محاولات كثيرة، حاول بعد $s ثانية' : e.messageAr;
    }
    return e.messageAr;
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(emptyLegAlertsProvider);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _busy ? null : _newAlert,
              icon: const Icon(Icons.add),
              label: const Text('تنبيه سعر جديد'),
            ),
          ),
        ),
        Expanded(
          child: async.when(
            loading: () => const LoadingState(),
            error: (e, _) => ErrorState(
              message:
                  e is AppException ? e.messageAr : errorMessageAr('unknown'),
              onRetry: () => ref.invalidate(emptyLegAlertsProvider),
            ),
            data: (alerts) => alerts.isEmpty
                ? const EmptyState(
                    icon: Icons.notifications_active_outlined,
                    message: 'لا توجد تنبيهات — أنشئ تنبيهاً لتصلك العروض',
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    itemCount: alerts.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (_, i) => _AlertCard(
                      alert: alerts[i],
                      busy: _busy,
                      onToggle: (v) => _toggle(alerts[i], v),
                      onDelete: () => _delete(alerts[i]),
                    ),
                  ),
          ),
        ),
      ],
    );
  }
}

class _AlertCard extends StatelessWidget {
  const _AlertCard({
    required this.alert,
    required this.busy,
    required this.onToggle,
    required this.onDelete,
  });

  final Alert alert;
  final bool busy;
  final ValueChanged<bool> onToggle;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final price = alert.maxPriceSar == null
        ? 'أي سعر'
        : 'حتى ${formatSar(alert.maxPriceSar)}';
    final dates = (alert.dateFrom == null && alert.dateTo == null)
        ? 'أي تاريخ'
        : '${alert.dateFrom ?? '—'} → ${alert.dateTo ?? '—'}';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AerisColors.navyCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AerisColors.border),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(alert.routeLabel,
                    style: const TextStyle(
                        color: AerisColors.inkPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w700)),
                const SizedBox(height: 6),
                Text('$price · $dates',
                    style: const TextStyle(color: AerisColors.inkSecondary)),
              ],
            ),
          ),
          Switch.adaptive(
            value: alert.isActive,
            activeThumbColor: AerisColors.gold,
            onChanged: busy ? null : onToggle,
          ),
          IconButton(
            tooltip: 'حذف',
            icon: const Icon(Icons.delete_outline, color: AerisColors.danger),
            onPressed: busy ? null : onDelete,
          ),
        ],
      ),
    );
  }
}
