import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/ui/themes/app_theme.dart';
import 'package:gaia_space/ui/screens/splash_screen.dart';
import 'package:gaia_space/core/services/navigation_service.dart';
import 'package:gaia_space/core/services/auth_service.dart';
import 'package:gaia_space/core/services/discord_service.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:uni_links/uni_links.dart';

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
  
  // Initialize deep links after app is running
  initDeepLinks();
}

void initDeepLinks() {
  final logger = AppLogger('DeepLinks');
  logger.info('Setting up deep linking');
  
  // Handle initial URI (app opened from link)
  getInitialUri().then((Uri? initialUri) {
    if (initialUri != null) {
      logger.info('App opened with deep link: $initialUri');
      _handleDeepLink(initialUri);
    }
  }).catchError((error) {
    logger.error('Error getting initial link', error: error);
  });

  // Handle URI when app is already running
  uriLinkStream.listen((Uri? uri) {
    if (uri != null) {
      logger.info('Received deep link while running: $uri');
      _handleDeepLink(uri);
    }
  }, onError: (error) {
    logger.error('Error receiving deep link', error: error);
  });
}

void _handleDeepLink(Uri uri) {
  final logger = AppLogger('DeepLinks');
  
  // Handle Discord OAuth callback
  if (uri.path.contains('/auth/discord/callback') || 
      (uri.scheme == 'gaiaspace' && uri.host == 'discord_callback')) {
    
    final code = uri.queryParameters['code'];
    if (code != null && code.isNotEmpty) {
      logger.info('Processing Discord auth code from deep link');
      final discordService = DiscordService();
      
      // Determine redirect URI based on link source
      final redirectUri = uri.scheme == 'gaiaspace'
          ? 'gaiaspace://discord_callback'
          : 'https://gaia-space.app/auth/discord/callback';
      
      // Process the authorization code
      discordService.exchangeCodeForToken(code, redirectUri).then((_) {
        logger.info('Successfully authenticated with Discord');
        // You might want to navigate to a specific screen or refresh the current one
        // NavigationService.navigatorKey.currentState?.pushNamed('/workspace');
      }).catchError((error) {
        logger.error('Error exchanging Discord auth code', error: error);
      });
    } else {
      logger.error('No code parameter found in Discord callback URL');
    }
  }
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