import '../config/app_config.dart';

/// The client-app sections reachable from the home dashboard.
enum DashboardSection { bookings, charter, emptyLegs, privilege, referrals, profile }

/// Which dashboard sections are visible given the deployed flags.
///
/// Fail-closed: pass `AppConfig.failClosed()` (the default when `/config`
/// is unreachable) and the flag-gated sections (empty legs, privilege)
/// drop out. Bookings / charter / referrals / profile are always shown
/// (referrals + the core booking surfaces are not flag-gated; the whole
/// authed tree already sits behind ENABLE_CLIENT_PORTAL server-side).
List<DashboardSection> visibleSections(AppConfig config) {
  return [
    DashboardSection.bookings,
    DashboardSection.charter,
    if (config.clientEmptyLegsPortal) DashboardSection.emptyLegs,
    if (config.privilege) DashboardSection.privilege,
    DashboardSection.referrals,
    DashboardSection.profile,
  ];
}
