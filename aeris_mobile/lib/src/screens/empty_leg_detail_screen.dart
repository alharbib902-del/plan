import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../empty_legs/empty_leg.dart';
import '../empty_legs/empty_leg_status.dart';
import '../empty_legs/empty_legs_repository.dart';
import '../core/app_exception.dart';
import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/async_states.dart';

/// Empty-leg detail by leg_number (EL-XXXX) + reserve/release (slice 5b).
/// Reserve when the leg is available; release the caller's own hold. Each
/// action confirms, runs rate-limited, disables the button while in flight
/// (no double-submit), then refreshes. 404/other faults render an inline
/// error; a dead session is handled app-wide.
class EmptyLegDetailScreen extends ConsumerWidget {
  const EmptyLegDetailScreen({required this.legNumber, super.key});

  final String legNumber;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(emptyLegDetailProvider(legNumber));
    return Scaffold(
      appBar: AppBar(title: const Text('تفاصيل الرحلة الفارغة')),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(emptyLegDetailProvider(legNumber)),
        ),
        data: (leg) => _DetailBody(legNumber: legNumber, leg: leg),
      ),
    );
  }
}

class _DetailBody extends ConsumerStatefulWidget {
  const _DetailBody({required this.legNumber, required this.leg});

  final String legNumber;
  final EmptyLeg leg;

  @override
  ConsumerState<_DetailBody> createState() => _DetailBodyState();
}

class _DetailBodyState extends ConsumerState<_DetailBody> {
  bool _busy = false;

  EmptyLeg get _leg => widget.leg;
  bool get _canReserve => _leg.status == 'available' && !_leg.isReserved;
  bool get _canRelease => _leg.isReservedByMe;

  Future<bool> _confirm(String title, String body, String confirmLabel) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('تراجع'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return ok == true;
  }

  String _actionError(AppException e) {
    if (e.code == 'rate_limited') {
      final s = e.retryAfterSeconds;
      return s != null ? 'محاولات كثيرة، حاول بعد $s ثانية' : e.messageAr;
    }
    return e.messageAr;
  }

  Future<void> _run({
    required String title,
    required String body,
    required String confirmLabel,
    required Future<void> Function(EmptyLegsRepository repo) action,
    required String successMsg,
  }) async {
    if (_busy) return;
    if (!await _confirm(title, body, confirmLabel)) return;
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await action(ref.read(emptyLegsRepositoryProvider));
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(successMsg)));
      // Refresh detail + the browse lists (reservation state changed).
      ref.invalidate(emptyLegDetailProvider(widget.legNumber));
      ref.invalidate(emptyLegsListProvider);
      ref.invalidate(emptyLegMatchesProvider);
    } on AppException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(_actionError(e))));
    } catch (_) {
      if (!mounted) return;
      setState(() => _busy = false);
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(errorMessageAr('unknown'))));
    }
  }

  void _reserve() => _run(
        title: 'تأكيد الحجز؟',
        body: 'سيتم حجز هذه الرحلة الفارغة باسمك (بانتظار تأكيد الإدارة).',
        confirmLabel: 'احجز',
        action: (repo) => repo.reserveLeg(_leg.id),
        successMsg: 'تم الحجز — بانتظار تأكيد الإدارة',
      );

  void _release() => _run(
        title: 'إلغاء الحجز؟',
        body: 'سيتم إلغاء حجزك لهذه الرحلة.',
        confirmLabel: 'إلغاء الحجز',
        action: (repo) => repo.releaseLeg(_leg.id),
        successMsg: 'تم إلغاء الحجز',
      );

  @override
  Widget build(BuildContext context) {
    final leg = _leg;
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
              StatusPill(
                label: emptyLegReservationLabel(leg),
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
          if (leg.isReservedByMe && leg.reservationExpiresAt != null)
            _row('ينتهي حجزك', formatDateTime(leg.reservationExpiresAt) ?? '—'),
          const Divider(height: 32, color: AerisColors.border),
          _PriceBlock(leg: leg),
          if (_canReserve) ...[
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _busy ? null : _reserve,
                child: const Text('احجز الآن'),
              ),
            ),
          ] else if (_canRelease) ...[
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: _busy ? null : _release,
                child: const Text('إلغاء الحجز',
                    style: TextStyle(color: AerisColors.danger)),
              ),
            ),
          ],
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
