import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_controller.dart';
import '../screens/booking_detail_screen.dart';
import '../screens/bookings_list_screen.dart';
import '../screens/change_password_screen.dart';
import '../screens/create_request_screen.dart';
import '../screens/empty_leg_detail_screen.dart';
import '../screens/empty_legs_screen.dart';
import '../screens/error_screen.dart';
import '../screens/home_screen.dart';
import '../screens/login_screen.dart';
import '../screens/privilege_history_screen.dart';
import '../screens/privilege_screen.dart';
import '../screens/profile_screen.dart';
import '../screens/referrals_screen.dart';
import '../screens/request_detail_screen.dart';
import '../screens/requests_list_screen.dart';
import '../screens/splash_screen.dart';

class Routes {
  const Routes._();
  static const splash = '/splash';
  static const login = '/login';
  static const changePassword = '/change-password';
  static const error = '/error';
  static const home = '/home';
  static const bookings = '/bookings';
  static const requests = '/requests';
  static const emptyLegs = '/empty-legs';
  static const privilege = '/privilege';
  static const referrals = '/referrals';
  static const profile = '/profile';
}

/// Central redirect-guard (mirrors the web `requireClientSession`
/// → redirect behaviour, incl. the `password_must_change` lockout):
///   - resolving (no value yet)        → /splash
///   - resolved error (token intact)   → /error (retry — NOT a logout)
///   - unauthenticated                 → /login
///   - password_must_change=true       → /change-password (locked)
///   - authenticated                   → /home
final routerProvider = Provider<GoRouter>((ref) {
  // Tick the router whenever auth state changes.
  final refresh = ValueNotifier<int>(0);
  ref.onDispose(refresh.dispose);
  ref.listen(authControllerProvider, (_, _) => refresh.value++);

  return GoRouter(
    initialLocation: Routes.splash,
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final loc = state.matchedLocation;

      // Still resolving the stored token → hold on the splash.
      if (auth.isLoading && !auth.hasValue) {
        return loc == Routes.splash ? null : Routes.splash;
      }

      // A RESOLVED error means the controller hit a non-session-death
      // fault (network / flag_disabled / account_not_active) and
      // deliberately kept the token (see session_codes.dart). Show a
      // retry screen — NEVER a silent /login bounce that masquerades as
      // a logout for a still-valid session.
      if (auth.hasError) {
        return loc == Routes.error ? null : Routes.error;
      }

      final status = auth.valueOrNull;
      if (status is Unauthenticated || status == null) {
        return loc == Routes.login ? null : Routes.login;
      }
      if (status is MustChangePassword) {
        return loc == Routes.changePassword ? null : Routes.changePassword;
      }
      // Authenticated — keep away from the pre-auth / error screens.
      if (loc == Routes.login ||
          loc == Routes.splash ||
          loc == Routes.changePassword ||
          loc == Routes.error) {
        return Routes.home;
      }
      return null;
    },
    routes: [
      GoRoute(
        path: Routes.splash,
        builder: (_, _) => const SplashScreen(),
      ),
      GoRoute(
        path: Routes.login,
        builder: (_, _) => const LoginScreen(),
      ),
      GoRoute(
        path: Routes.changePassword,
        builder: (_, _) => const ChangePasswordScreen(),
      ),
      GoRoute(
        path: Routes.error,
        builder: (_, _) => const ErrorScreen(),
      ),
      GoRoute(
        path: Routes.home,
        builder: (_, _) => const HomeScreen(),
      ),
      GoRoute(
        path: Routes.bookings,
        builder: (_, _) => const BookingsListScreen(),
        routes: [
          GoRoute(
            path: ':id',
            builder: (_, state) =>
                BookingDetailScreen(id: state.pathParameters['id']!),
          ),
        ],
      ),
      GoRoute(
        path: Routes.requests,
        builder: (_, _) => const RequestsListScreen(),
        routes: [
          // Literal 'new' MUST precede ':id' so /requests/new is the create
          // form, not a detail with id == 'new'.
          GoRoute(
            path: 'new',
            builder: (_, _) => const CreateRequestScreen(),
          ),
          GoRoute(
            path: ':id',
            builder: (_, state) =>
                RequestDetailScreen(id: state.pathParameters['id']!),
          ),
        ],
      ),
      GoRoute(
        path: Routes.emptyLegs,
        builder: (_, _) => const EmptyLegsScreen(),
        routes: [
          GoRoute(
            path: ':legNumber',
            builder: (_, state) => EmptyLegDetailScreen(
              legNumber: state.pathParameters['legNumber']!,
            ),
          ),
        ],
      ),
      GoRoute(
        path: Routes.privilege,
        builder: (_, _) => const PrivilegeScreen(),
        routes: [
          GoRoute(
            path: 'history',
            builder: (_, _) => const PrivilegeHistoryScreen(),
          ),
        ],
      ),
      GoRoute(
        path: Routes.referrals,
        builder: (_, _) => const ReferralsScreen(),
      ),
      GoRoute(
        path: Routes.profile,
        builder: (_, _) => const ProfileScreen(),
      ),
    ],
  );
});
