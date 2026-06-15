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

/// Charter request detail + its operator offers (READ-ONLY in slice 4a;
/// accept/decline/cancel land in 4b). 404 (request_not_found) + other faults
/// render an inline error; a dead session is handled app-wide.
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
        data: (rec) => _Detail(request: rec.request, offers: rec.offers),
      ),
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.request, required this.offers});

  final TripRequest request;
  final List<Offer> offers;

  @override
  Widget build(BuildContext context) {
    final pref = aircraftPrefAr(request.aircraftPref);
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
                  request.routeLabel,
                  style: const TextStyle(
                    color: AerisColors.inkPrimary,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              StatusPill(
                label: tripStatusAr(request.status),
                color: tripStatusColor(request.status),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text('رقم الطلب: ${request.requestNumber}',
              style: const TextStyle(color: AerisColors.inkSecondary)),
          const SizedBox(height: 18),
          _row('تاريخ المغادرة', formatDate(request.departureDate) ?? '—'),
          if (request.returnDate != null)
            _row('تاريخ العودة', formatDate(request.returnDate) ?? '—'),
          _row('عدد الركّاب', '${request.passengers}'),
          if (pref != null) _row('تفضيل الطائرة', pref),
          if (request.specialRequests != null &&
              request.specialRequests!.isNotEmpty)
            _row('طلبات خاصة', request.specialRequests!),
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
          if (offers.isEmpty)
            const Text(
              'بانتظار عروض المشغّلين',
              style: TextStyle(color: AerisColors.inkSecondary),
            )
          else
            for (final o in offers) ...[
              _OfferCard(offer: o),
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
  const _OfferCard({required this.offer});

  final Offer offer;

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
            Text(
              'صالح حتى: ${formatDateTime(offer.expiresAt) ?? '—'}',
              style: const TextStyle(
                  color: AerisColors.inkMuted, fontSize: 13),
            ),
          ],
          if (offer.notes != null && offer.notes!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(offer.notes!,
                style: const TextStyle(color: AerisColors.inkSecondary)),
          ],
        ],
      ),
    );
  }
}
