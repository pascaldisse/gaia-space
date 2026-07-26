import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/ui/themes/app_theme.dart';
import 'package:gaia_space/ui/screens/splash_screen.dart';
import 'package:gaia_space/core/services/navigation_service.dart';
import 'package:gaia_space/core/services/auth_service.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:gaia_space/core/utils/connectivity_checker.dart';

// Conditionally import dart:html for web platform
import 'web_main.dart' if (dart.library.io) 'native_main.dart' as platform;

void main() async {
  try {
    print('===== GAIA SPACE APP STARTING =====');
    print('Platform: ${kIsWeb ? 'Web' : 'Native'}');
    
    // Web specific initialization
    if (kIsWeb) {
      print('Running in web mode - performing web-specific initialization...');
      // Add browser console messages for debugging
      try {
        print('Setting up debug window globals');
        platform.setupWebDebugTools();
      } catch (e) {
        print('Error setting up web debug tools: $e');
      }
    }
    
    // Check for debug environment variable and platform-specific details
    bool debugMode = false;
    try {
      // Use platform-specific function to get debug info
      print('Getting debug mode status...');
      debugMode = await platform.isDebugMode();
      print('Debug mode status: $debugMode');
      
      // Log platform specific information
      if (kIsWeb) {
        print('Logging web platform information...');
        platform.logWebPlatformInfo();
      } else {
        print('Logging native platform information...');
        platform.logNativePlatformInfo();
      }
    } catch (e) {
      print('Error checking debug environment: $e');
      // Continue with default (non-debug) mode
    }
    
    print('Initializing WidgetsFlutterBinding...');
    WidgetsFlutterBinding.ensureInitialized();
    print('WidgetsFlutterBinding initialized successfully');
    
    if (kIsWeb) {
      // Add additional web initialization
      print('Web initialization complete - binding ready');
    }
    
    // Initialize services with better error handling
    print('Starting logger initialization...');
    try {
      await AppLogger.init();
      print('Logger initialization completed');
      
      // Create a logger instance to use in main
      final appLogger = AppLogger('Main');
      appLogger.info('Application startup initiated');
      
      print('Starting auth service initialization...');
      try {
        await AuthService.init();
        appLogger.info('Auth service initialized successfully');
      } catch (e, stack) {
        print('ERROR initializing auth service: $e');
        print('Stack trace: $stack');
        appLogger.error('Failed to initialize AuthService', error: e, stackTrace: stack);
      }
      
      // Start network connectivity monitoring with a timeout
      print('Starting connectivity monitoring...');
      try {
        appLogger.info('Starting connectivity monitoring with 60 second interval');
        
        // Use a timeout to ensure this doesn't hang
        Future.delayed(const Duration(milliseconds: 500), () {
          // Start on a delayed call to avoid blocking the UI
          ConnectivityChecker.startMonitoring(
            checkInterval: const Duration(seconds: 60),
          );
          appLogger.info('Connectivity monitoring started');
        });
        
        // Run a quick connectivity check (but don't block UI on it)
        print('Running initial connectivity check...');
        appLogger.info('Running initial connectivity check');
        
        // Don't await the check to avoid blocking startup
        ConnectivityChecker.checkConnectivity().then((isConnected) {
          print('Initial connectivity result: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}');
          appLogger.info('Initial connectivity check: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}');
        }).catchError((e) {
          print('Error in initial connectivity check: $e');
          appLogger.error('Error in initial connectivity check', error: e);
        });
        
        // App is considered online for better UX
        print('App continuing startup with assumed connectivity');
        appLogger.info('App continuing startup assuming connectivity');
      } catch (e, stack) {
        print('Error setting up connectivity monitoring: $e');
        appLogger.error('Failed to set up connectivity monitoring', error: e, stackTrace: stack);
        // Continue app startup even with connectivity issues
        print('Continuing app startup despite connectivity setup issues');
      }
      
      appLogger.info('Starting app render');
      print('Running app...');
      runApp(
        const ProviderScope(
          child: GaiaSpaceApp(),
        ),
      );
      print('App rendered successfully');
    } catch (e, stack) {
      print('CRITICAL ERROR in logger initialization: $e');
      print('Stack trace: $stack');
      // Continue with app startup even if logger fails
      print('Starting auth service initialization (without logger)...');
      try {
        await AuthService.init();
      } catch (authError) {
        print('ERROR initializing auth service: $authError');
      }
      
      print('Running app (with possible service initialization failures)...');
      runApp(
        const ProviderScope(
          child: GaiaSpaceApp(),
        ),
      );
    }
  } catch (e, stack) {
    print('FATAL ERROR during app startup: $e');
    print('Stack trace: $stack');
    // Try to at least show something to the user
    runApp(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: Text(
              'Application Error: Failed to start properly.\nError: $e',
              style: const TextStyle(color: Colors.red),
            ),
          ),
        ),
      ),
    );
  }
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