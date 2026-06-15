import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../config/app_config.dart';
import '../theme/aeris_theme.dart';
import 'dashboard_sections.dart';

/// Authed home dashboard: a welcome header + navigation cards to the
/// client sections. Cards are gated by the deployed feature flags
/// (`appConfigProvider`, fail-closed). Section screens land in the
/// following slices; until then a card surfaces a "coming soon" notice.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(authControllerProvider).valueOrNull;
    final name = status is Authenticated ? status.session.fullName : '';
    // Fail-closed: while /config is loading or on error, gated cards hide.
    final config = ref.watch(appConfigProvider).valueOrNull ?? AppConfig.failClosed();
    final sections = visibleSections(config);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Aeris'),
        actions: [
          IconButton(
            tooltip: 'تسجيل الخروج',
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                name.isEmpty ? 'مرحباً بك' : 'مرحباً، $name',
                style: const TextStyle(
                  color: AerisColors.inkPrimary,
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'إلى أين تريد التوجّه؟',
                style: TextStyle(color: AerisColors.inkSecondary, fontSize: 15),
              ),
              const SizedBox(height: 20),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: sections.length,
                // Fixed cell HEIGHT (mainAxisExtent) sized to the card
                // content so it never overflows on narrow widths (360/320px);
                // maxCrossAxisExtent keeps 2 columns on phones, more on
                // tablets.
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                  maxCrossAxisExtent: 200,
                  mainAxisExtent: 140,
                  mainAxisSpacing: 14,
                  crossAxisSpacing: 14,
                ),
                itemBuilder: (_, i) => _SectionCard(section: sections[i]),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.section});

  final DashboardSection section;

  @override
  Widget build(BuildContext context) {
    final (icon, label) = _present(section);
    return Material(
      color: AerisColors.navyCard,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        // Destinations land in the following slices; for now a card
        // acknowledges the tap without navigating to a non-existent route.
        onTap: () => ScaffoldMessenger.of(context)
          ..clearSnackBars()
          ..showSnackBar(
            const SnackBar(content: Text('هذه الشاشة قيد الإنشاء')),
          ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: AerisColors.gold, size: 34),
              const SizedBox(height: 12),
              Text(
                label,
                textAlign: TextAlign.center,
                // Cap at two lines so a long label on a narrow card can
                // never exceed the fixed cell height (no RenderFlex overflow).
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AerisColors.inkPrimary,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  (IconData, String) _present(DashboardSection s) => switch (s) {
        DashboardSection.bookings => (Icons.confirmation_number_outlined, 'حجوزاتي'),
        DashboardSection.charter => (Icons.flight_takeoff, 'رحلة خاصة'),
        DashboardSection.emptyLegs => (Icons.airlines_outlined, 'رحلات فارغة'),
        DashboardSection.privilege => (Icons.workspace_premium_outlined, 'الامتياز'),
        DashboardSection.referrals => (Icons.card_giftcard_outlined, 'الإحالات'),
        DashboardSection.profile => (Icons.person_outline, 'الملف الشخصي'),
      };
}
