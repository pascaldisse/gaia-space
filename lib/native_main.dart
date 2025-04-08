import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Check if we're running in debug mode
Future<bool> isDebugMode() async {
  try {
    // Check if debug mode is set in environment
    bool debugMode = kDebugMode;
    
    // Check for debug file marker
    try {
      final appDir = await getApplicationDocumentsDirectory();
      final debugFile = File('${appDir.path}/GAIA_DEBUG');
      if (await debugFile.exists()) {
        debugMode = true;
        print('Debug mode enabled via debug file marker');
      }
    } catch (e) {
      print('Error checking for debug file: $e');
    }
    
    print('Debug mode: $debugMode');
    return debugMode;
  } catch (e) {
    print('Error determining debug mode: $e');
    return false;
  }
}

/// Log native platform-specific information
void logNativePlatformInfo() {
  try {
    // Operating system info
    print('Operating system: ${Platform.operatingSystem} ${Platform.operatingSystemVersion}');
    print('Number of processors: ${Platform.numberOfProcessors}');
    print('Locale: ${Platform.localeName}');
    
    // Directory paths
    print('Current directory: ${Directory.current.path}');
    print('Executable: ${Platform.executable}');
    print('Package root: ${Platform.packageConfig}');
    
    // Environment variables
    final Map<String, String> environment = Platform.environment;
    print('Environment variables: ${environment.length} entries');
    
    // Available in debug mode only
    if (kDebugMode) {
      print('PATH: ${environment['PATH']}');
      print('HOME: ${environment['HOME']}');
    }
    
    // Check write access to temp directory
    try {
      final tempDir = Directory.systemTemp;
      final testFile = File('${tempDir.path}/gaia_write_test');
      testFile.writeAsStringSync('write test');
      testFile.deleteSync();
      print('Write access to temp directory: Yes');
    } catch (e) {
      print('Write access to temp directory: No (Error: $e)');
    }
  } catch (e) {
    print('Error logging native platform info: $e');
  }
}

// Stub for API consistency with web_main
void logWebPlatformInfo() {
  // Not used in native context
}