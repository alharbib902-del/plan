import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../bookings/booking.dart';
import '../bookings/bookings_repository.dart';
import '../bookings/status_chip.dart';
import '../core/app_exception.dart';
import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/async_states.dart';

/// The client's bookings list. A dead-session 401 mid-fetch is handled
/// app-wide (token cleared + bounce to /login) before reaching here;
/// other faults show an inline error + retry.
class BookingsListScreen extends ConsumerWidget {
  const BookingsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(bookingsListProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('حجوزاتي')),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(bookingsListProvider),
        ),
        data: (bookings) => bookings.isEmpty
            ? const EmptyState(
                icon: Icons.confirmation_number_outlined,
                message: 'لا توجد حجوزات بعد',
              )
            : RefreshIndicator(
                onRefresh: () => ref.refresh(bookingsListProvider.future),
                child: ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: bookings.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 12),
                  itemBuilder: (_, i) => _BookingCard(booking: bookings[i]),
                ),
              ),
      ),
    );
  }
}

class _BookingCard extends StatelessWidget {
  const _BookingCard({required this.booking});

  final Booking booking;

  @override
  Widget build(BuildContext context) {
    final date = formatDate(booking.departureScheduled);
    return Material(
      color: AerisColors.navyCard,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push('/bookings/${booking.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                booking.routeLabel,
                style: const TextStyle(
                  color: AerisColors.inkPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  StatusChip.flight(booking.flightStatus),
                  const SizedBox(width: 8),
                  StatusChip.payment(booking.paymentStatus),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  if (date != null)
                    Text(
                      date,
                      style: const TextStyle(color: AerisColors.inkSecondary),
                    ),
                  Text(
                    formatSar(booking.totalAmount),
                    style: const TextStyle(
                      color: AerisColors.gold,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
