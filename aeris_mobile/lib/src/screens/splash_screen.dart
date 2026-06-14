import 'package:flutter/material.dart';

import '../theme/aeris_theme.dart';

/// Shown while the stored token is validated on launch.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'AERIS',
              style: TextStyle(
                color: AerisColors.gold,
                fontSize: 40,
                fontWeight: FontWeight.w800,
                letterSpacing: 6,
              ),
            ),
            SizedBox(height: 28),
            SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: AerisColors.gold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
