import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../bookings/booking.dart';
import '../bookings/bookings_repository.dart';
import '../bookings/status_chip.dart';
import '../core/app_exception.dart';
import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/async_states.dart';

/// Booking detail for `/bookings/:id`. 404 (booking_not_found) and other
/// faults render an inline error; a dead session is handled app-wide.
class BookingDetailScreen extends ConsumerWidget {
  const BookingDetailScreen({required this.id, super.key});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(bookingDetailProvider(id));
    return Scaffold(
      appBar: AppBar(title: const Text('تفاصيل الحجز')),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(bookingDetailProvider(id)),
        ),
        data: (b) => _Detail(booking: b),
      ),
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    final departure = formatDateTime(booking.departureScheduled);
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            booking.routeLabel,
            style: const TextStyle(
              color: AerisColors.inkPrimary,
              fontSize: 22,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'رقم الحجز: ${booking.bookingNumber}',
            style: const TextStyle(color: AerisColors.inkSecondary),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              StatusChip.flight(booking.flightStatus),
              const SizedBox(width: 8),
              StatusChip.payment(booking.paymentStatus),
            ],
          ),
          const SizedBox(height: 22),
          if (departure != null) _row('موعد المغادرة', departure),
          _row('عدد الركّاب', '${booking.passengers}'),
          if (booking.aircraft != null) _row('الطائرة', booking.aircraft!),
          if (booking.operatorName != null)
            _row('المشغّل', booking.operatorName!),
          _row('رحلة ذهاب وعودة', booking.returnScheduled ? 'نعم' : 'لا'),
          if (booking.cancelledAt != null)
            _row('أُلغيت في', formatDateTime(booking.cancelledAt) ?? '—'),
          const Divider(height: 32, color: AerisColors.border),
          _row('القيمة الأساسية', formatSar(booking.baseAmount)),
          _row('الإضافات', formatSar(booking.addonsAmount)),
          _row('الضريبة', formatSar(booking.vatAmount)),
          _row('الإجمالي', formatSar(booking.totalAmount), emphasize: true),
          if (booking.loyaltyPointsEarned != null) ...[
            const SizedBox(height: 8),
            _row('نقاط الولاء المكتسبة', '${booking.loyaltyPointsEarned}'),
          ],
          if (booking.zatcaInvoiceUrl != null) ...[
            const SizedBox(height: 16),
            const Text(
              'الفاتورة الضريبية',
              style: TextStyle(
                color: AerisColors.inkSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            SelectableText(
              booking.zatcaInvoiceUrl!,
              style: const TextStyle(color: AerisColors.gold),
            ),
          ],
        ],
      ),
    );
  }

  Widget _row(String label, String value, {bool emphasize = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(color: AerisColors.inkSecondary),
          ),
          Text(
            value,
            style: TextStyle(
              color: emphasize ? AerisColors.gold : AerisColors.inkPrimary,
              fontWeight: emphasize ? FontWeight.w800 : FontWeight.w600,
              fontSize: emphasize ? 17 : 14,
            ),
          ),
        ],
      ),
    );
  }
}
