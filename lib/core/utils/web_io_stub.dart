// Web stub implementation for dart:io Platform
// This file provides stub implementations of functionality needed
// for cross-platform compatibility between web and native platforms

// Platform class stub for web
class Platform {
  // Stub for pathSeparator that always returns '/' on web
  static const String pathSeparator = '/';
  
  // Web detection
  static const bool isWeb = true;
  static const bool isAndroid = false;
  static const bool isIOS = false;
  static const bool isMacOS = false;
  static const bool isWindows = false;
  static const bool isLinux = false;
}

// Stub Directory class for web
class Directory {
  final String path;
  
  Directory(this.path);
  
  // Static method for system temp dir
  static Directory get systemTemp => Directory('/tmp');
  
  // Create a method that always returns this directory
  Directory createTempSync(String prefix) {
    return Directory('$path/$prefix-tempdir');
  }
  
  // Stubs for existence check
  Future<bool> exists() async => false;
  
  // Stub for directory creation
  Future<Directory> create({bool recursive = false}) async {
    return this;
  }
}