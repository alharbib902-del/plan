import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_controller.dart';
import '../screens/change_password_screen.dart';
import '../screens/home_screen.dart';
import '../screens/login_screen.dart';
import '../screens/splash_screen.dart';

class Routes {
  const Routes._();
  static const splash = '/splash';
  static const login = '/login';
  static const changePassword = '/change-password';
  static const home = '/home';
}

/// Central redirect-guard (mirrors the web `requireClientSession`
/// → redirect behaviour, incl. the `password_must_change` lockout):
///   - resolving (no value yet)        → /splash
///   - unauthenticated / error         → /login
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

      final status = auth.valueOrNull;
      final isUnauth = auth.hasError || status is Unauthenticated || status == null;

      if (isUnauth) {
        return loc == Routes.login ? null : Routes.login;
      }
      if (status is MustChangePassword) {
        return loc == Routes.changePassword ? null : Routes.changePassword;
      }
      // Authenticated — keep away from the pre-auth screens.
      if (loc == Routes.login ||
          loc == Routes.splash ||
          loc == Routes.changePassword) {
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
        path: Routes.home,
        builder: (_, _) => const HomeScreen(),
      ),
    ],
  );
});
