import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'src/router/app_router.dart';
import 'src/theme/aeris_theme.dart';

void main() {
  runApp(const ProviderScope(child: AerisApp()));
}

class AerisApp extends ConsumerWidget {
  const AerisApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'Aeris',
      debugShowCheckedModeBanner: false,
      theme: AerisTheme.dark,
      darkTheme: AerisTheme.dark,
      themeMode: ThemeMode.dark,
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      routerConfig: router,
      // Force RTL app-wide (Arabic-first identity).
      builder: (context, child) =>
          Directionality(textDirection: TextDirection.rtl, child: child!),
    );
  }
}
