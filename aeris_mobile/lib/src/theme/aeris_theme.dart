import 'package:flutter/material.dart';

/// Aeris brand palette — mirrors the web Tailwind tokens
/// (navy / gold / ink). Single source so screens never hardcode
/// hex values (prevents identity drift).
class AerisColors {
  const AerisColors._();

  static const Color navy = Color(0xFF0A1628);
  static const Color navySecondary = Color(0xFF0F1F3A);
  static const Color navyCard = Color(0xFF13233F);
  static const Color gold = Color(0xFFC9A961);
  static const Color goldLight = Color(0xFFE8D4A8);
  static const Color goldDark = Color(0xFFA8884A);
  static const Color inkPrimary = Color(0xFFFAFAFA);
  static const Color inkSecondary = Color(0xFFB9C2D0);
  static const Color inkMuted = Color(0xFF7A8699);
  static const Color border = Color(0xFF24344F);
  static const Color danger = Color(0xFFE5484D);
}

/// The app runs in a single dark, luxury navy/gold theme.
class AerisTheme {
  const AerisTheme._();

  static ThemeData get dark {
    const scheme = ColorScheme.dark(
      primary: AerisColors.gold,
      onPrimary: AerisColors.navy,
      secondary: AerisColors.goldLight,
      onSecondary: AerisColors.navy,
      surface: AerisColors.navyCard,
      onSurface: AerisColors.inkPrimary,
      error: AerisColors.danger,
      onError: AerisColors.inkPrimary,
    );

    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      scaffoldBackgroundColor: AerisColors.navy,
      // IBM Plex Sans Arabic is bundled later (Phase 5 polish);
      // fall back to the platform Arabic font until then.
      fontFamily: null,
    );

    return base.copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: AerisColors.navy,
        foregroundColor: AerisColors.inkPrimary,
        elevation: 0,
        centerTitle: true,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AerisColors.navySecondary,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AerisColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AerisColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AerisColors.gold, width: 1.5),
        ),
        labelStyle: const TextStyle(color: AerisColors.inkSecondary),
        hintStyle: const TextStyle(color: AerisColors.inkMuted),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AerisColors.gold,
          foregroundColor: AerisColors.navy,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: AerisColors.goldLight),
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: AerisColors.navyCard,
        contentTextStyle: TextStyle(color: AerisColors.inkPrimary),
      ),
    );
  }
}
