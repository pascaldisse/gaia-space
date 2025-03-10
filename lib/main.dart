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
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.system,
      navigatorKey: NavigationService.navigatorKey,
      home: const SplashScreen(),
    );
  }
}