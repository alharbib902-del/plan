import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../charter/charter_repository.dart';
import '../charter/charter_status.dart';
import '../charter/offer.dart';
import '../charter/trip_request.dart';
import '../core/app_exception.dart';
import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/async_states.dart';

/// Charter request detail + its operator offers, with actions (slice 4b):
/// accept / decline an offer, cancel the request. Each action confirms, runs
/// rate-limited, disables ALL action controls while in flight (no
/// double-submit), then refreshes the detail. A dead session is handled
/// app-wide; 404 / other faults render an inline error.
class RequestDetailScreen extends ConsumerWidget {
  const RequestDetailScreen({required this.id, super.key});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(requestDetailProvider(id));
    return Scaffold(
      appBar: AppBar(title: const Text('تفاصيل الطلب')),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(requestDetailProvider(id)),
        ),
        data: (rec) =>
            _DetailBody(id: id, request: rec.request, offers: rec.offers),
      ),
    );
  }
}

class _DetailBody extends ConsumerStatefulWidget {
  const _DetailBody({
    required this.id,
    required this.request,
    required this.offers,
  });

  final String id;
  final TripRequest request;
  final List<Offer> offers;

  @override
  ConsumerState<_DetailBody> createState() => _DetailBodyState();
}

class _DetailBodyState extends ConsumerState<_DetailBody> {
  bool _busy = false;

  TripRequest get _request => widget.request;

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
    required String confirmTitle,
    required String confirmBody,
    required String confirmLabel,
    required Future<void> Function(CharterRepository repo) action,
    required String successMsg,
  }) async {
    if (_busy) return; // guard against double-submit
    if (!await _confirm(confirmTitle, confirmBody, confirmLabel)) return;
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await action(ref.read(charterRepositoryProvider));
      if (!mounted) return;
      messenger
        ..clearSnackBars()
        ..showSnackBar(SnackBar(content: Text(successMsg)));
      // Refresh the detail (offer/request state changed). The parent's watch
      // rebuilds to a fresh body, so _busy needn't be reset here.
      ref.invalidate(requestDetailProvider(widget.id));
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

  void _acceptOffer(Offer o) => _run(
        confirmTitle: 'قبول العرض؟',
        confirmBody: 'سيتم قبول هذا العرض بسعر ${formatSar(o.totalPriceSar)}.',
        confirmLabel: 'قبول',
        action: (repo) => repo.acceptOffer(offerId: o.id, source: o.source),
        successMsg: 'تم قبول العرض',
      );

  void _declineOffer(Offer o) => _run(
        confirmTitle: 'رفض العرض؟',
        confirmBody: 'سيُرفض عرض ${o.operatorName ?? 'المشغّل'}.',
        confirmLabel: 'رفض',
        action: (repo) => repo.declineOffer(offerId: o.id, source: o.source),
        successMsg: 'تم رفض العرض',
      );

  void _cancelRequest() => _run(
        confirmTitle: 'إلغاء الطلب؟',
        confirmBody: 'سيتم إلغاء طلب الرحلة الخاصة.',
        confirmLabel: 'إلغاء الطلب',
        action: (repo) => repo.cancelRequest(widget.id),
        successMsg: 'تم إلغاء الطلب',
      );

  @override
  Widget build(BuildContext context) {
    final r = _request;
    final pref = aircraftPrefAr(r.aircraftPref);
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
                  r.routeLabel,
                  style: const TextStyle(
                    color: AerisColors.inkPrimary,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              StatusPill(
                label: tripStatusAr(r.status),
                color: tripStatusColor(r.status),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text('رقم الطلب: ${r.requestNumber}',
              style: const TextStyle(color: AerisColors.inkSecondary)),
          const SizedBox(height: 18),
          _row('تاريخ المغادرة', formatDate(r.departureDate) ?? '—'),
          if (r.returnDate != null)
            _row('تاريخ العودة', formatDate(r.returnDate) ?? '—'),
          _row('عدد الركّاب', '${r.passengers}'),
          if (pref != null) _row('تفضيل الطائرة', pref),
          if (r.specialRequests != null && r.specialRequests!.isNotEmpty)
            _row('طلبات خاصة', r.specialRequests!),
          if (r.canCancel) ...[
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _busy ? null : _cancelRequest,
              icon: const Icon(Icons.close, color: AerisColors.danger),
              label: const Text('إلغاء الطلب',
                  style: TextStyle(color: AerisColors.danger)),
            ),
          ],
          const Divider(height: 32, color: AerisColors.border),
          const Text(
            'العروض',
            style: TextStyle(
              color: AerisColors.inkPrimary,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 12),
          if (widget.offers.isEmpty)
            const Text('بانتظار عروض المشغّلين',
                style: TextStyle(color: AerisColors.inkSecondary))
          else
            for (final o in widget.offers) ...[
              _OfferCard(
                offer: o,
                busy: _busy,
                onAccept: o.canAccept ? () => _acceptOffer(o) : null,
                onDecline: o.canDecline ? () => _declineOffer(o) : null,
              ),
              const SizedBox(height: 12),
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
            width: 120,
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

class _OfferCard extends StatelessWidget {
  const _OfferCard({
    required this.offer,
    required this.busy,
    this.onAccept,
    this.onDecline,
  });

  final Offer offer;
  final bool busy;
  final VoidCallback? onAccept;
  final VoidCallback? onDecline;

  @override
  Widget build(BuildContext context) {
    final aircraft = [offer.aircraftType, offer.aircraftRegistration]
        .where((s) => s != null && s.isNotEmpty)
        .join(' · ');
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AerisColors.navyCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AerisColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  offer.operatorName ?? 'مشغّل',
                  style: const TextStyle(
                    color: AerisColors.inkPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              StatusPill(
                label: offerStatusAr(offer.status),
                color: offerStatusColor(offer.status),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            formatSar(offer.totalPriceSar),
            style: const TextStyle(
              color: AerisColors.gold,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          if (aircraft.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(aircraft,
                style: const TextStyle(color: AerisColors.inkSecondary)),
          ],
          if (offer.expiresAt != null) ...[
            const SizedBox(height: 6),
            Text('صالح حتى: ${formatDateTime(offer.expiresAt) ?? '—'}',
                style:
                    const TextStyle(color: AerisColors.inkMuted, fontSize: 13)),
          ],
          if (offer.notes != null && offer.notes!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(offer.notes!,
                style: const TextStyle(color: AerisColors.inkSecondary)),
          ],
          if (onAccept != null || onDecline != null) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                if (onAccept != null)
                  Expanded(
                    child: ElevatedButton(
                      onPressed: busy ? null : onAccept,
                      child: const Text('قبول'),
                    ),
                  ),
                if (onAccept != null && onDecline != null)
                  const SizedBox(width: 12),
                if (onDecline != null)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: busy ? null : onDecline,
                      child: const Text('رفض'),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
