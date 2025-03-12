import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/ui/themes/app_theme.dart';
import 'package:gaia_space/ui/screens/splash_screen.dart';
import 'package:gaia_space/core/services/navigation_service.dart';
import 'package:gaia_space/core/services/auth_service.dart';
import 'package:gaia_space/core/utils/app_logger.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize services
  await AppLogger.init();
  await AuthService.init();
  
  runApp(
    const ProviderScope(
      child: GaiaSpaceApp(),
    ),
  );
}

class GaiaSpaceApp extends ConsumerWidget {
  const GaiaSpaceApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'Gaia Space',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme.copyWith(
        textSelectionTheme: const TextSelectionThemeData(
          selectionColor: Color(0x332563EB), // Primary color with opacity
          cursorColor: Color(0xFF2563EB),
          selectionHandleColor: Color(0xFF2563EB),
        ),
      ),
      darkTheme: AppTheme.darkTheme.copyWith(
        textSelectionTheme: const TextSelectionThemeData(
          selectionColor: Color(0x332563EB), // Primary color with opacity
          cursorColor: Color(0xFF2563EB),
          selectionHandleColor: Color(0xFF2563EB),
        ),
      ),
      themeMode: ThemeMode.system,
      navigatorKey: NavigationService.navigatorKey,
      home: const SplashScreen(),
    );
  }
}