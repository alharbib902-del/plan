import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../charter/charter_repository.dart';
import '../charter/charter_status.dart';
import '../charter/trip_request.dart';
import '../core/app_exception.dart';
import '../theme/aeris_theme.dart';
import '../utils/format.dart';
import '../widgets/async_states.dart';

/// "طلباتي" — the client's charter trip requests, with a button to create a
/// new one. A dead-session 401 mid-fetch is handled app-wide; other faults
/// show an inline error + retry.
class RequestsListScreen extends ConsumerWidget {
  const RequestsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(charterRequestsProvider('all'));
    return Scaffold(
      appBar: AppBar(title: const Text('طلباتي')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/requests/new'),
        icon: const Icon(Icons.add),
        label: const Text('طلب جديد'),
      ),
      body: async.when(
        loading: () => const LoadingState(),
        error: (e, _) => ErrorState(
          message: e is AppException ? e.messageAr : errorMessageAr('unknown'),
          onRetry: () => ref.invalidate(charterRequestsProvider),
        ),
        data: (requests) => requests.isEmpty
            ? const EmptyState(
                icon: Icons.flight_takeoff,
                message: 'لا توجد طلبات بعد — أنشئ طلب رحلتك الخاصة',
              )
            : RefreshIndicator(
                onRefresh: () =>
                    ref.refresh(charterRequestsProvider('all').future),
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
                  itemCount: requests.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 12),
                  itemBuilder: (_, i) => _RequestCard(request: requests[i]),
                ),
              ),
      ),
    );
  }
}

class _RequestCard extends StatelessWidget {
  const _RequestCard({required this.request});

  final TripRequest request;

  @override
  Widget build(BuildContext context) {
    final date = formatDate(request.departureDate);
    return Material(
      color: AerisColors.navyCard,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push('/requests/${request.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
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
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  StatusPill(
                    label: tripStatusAr(request.status),
                    color: tripStatusColor(request.status),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  if (date != null)
                    Text(date,
                        style: const TextStyle(color: AerisColors.inkSecondary)),
                  Text(
                    '${request.passengers} راكب',
                    style: const TextStyle(color: AerisColors.inkSecondary),
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
