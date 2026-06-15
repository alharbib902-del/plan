import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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
    final configAsync = ref.watch(appConfigProvider);
    // Fail-closed: a null (loading) OR errored config reads as
    // everything-off, so flag-gated cards hide on load AND on failure.
    final config = configAsync.valueOrNull ?? AppConfig.failClosed();
    // S9: /config genuinely failed (resolved-but-errored, not still
    // loading) → surface a limited-mode banner so the user understands
    // why some sections are missing.
    final limited = configAsync.hasError;
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
              if (limited) ...[
                const _LimitedModeBanner(),
                const SizedBox(height: 16),
              ],
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

/// S9 limited-mode notice: shown when `/config` failed to load, so the
/// app is fail-closed and some flag-gated sections are hidden.
class _LimitedModeBanner extends StatelessWidget {
  const _LimitedModeBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AerisColors.gold.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AerisColors.gold.withValues(alpha: 0.4)),
      ),
      child: const Row(
        children: [
          Icon(Icons.info_outline, color: AerisColors.gold, size: 20),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'وضع محدود — تعذّر تحميل بعض الميزات، حاول لاحقاً',
              style: TextStyle(color: AerisColors.inkPrimary),
            ),
          ),
        ],
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
        onTap: () => _open(context),
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

  void _open(BuildContext context) {
    final route = _routeFor(section);
    if (route != null) {
      context.push(route);
      return;
    }
    // Destination lands in a later slice.
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        const SnackBar(content: Text('هذه الشاشة قيد الإنشاء')),
      );
  }

  // Sections whose screen exists today route; the rest show "coming soon"
  // until their slice lands.
  String? _routeFor(DashboardSection s) => switch (s) {
        DashboardSection.bookings => '/bookings',
        DashboardSection.charter => '/requests',
        _ => null,
      };

  (IconData, String) _present(DashboardSection s) => switch (s) {
        DashboardSection.bookings => (Icons.confirmation_number_outlined, 'حجوزاتي'),
        DashboardSection.charter => (Icons.flight_takeoff, 'رحلة خاصة'),
        DashboardSection.emptyLegs => (Icons.airlines_outlined, 'رحلات فارغة'),
        DashboardSection.privilege => (Icons.workspace_premium_outlined, 'الامتياز'),
        DashboardSection.referrals => (Icons.card_giftcard_outlined, 'الإحالات'),
        DashboardSection.profile => (Icons.person_outline, 'الملف الشخصي'),
      };
}
