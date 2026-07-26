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
  
  // Add stubs for additional Platform properties
  static String get operatingSystem => 'web';
  static String get operatingSystemVersion => 'browser';
  static int get numberOfProcessors => 1; // Default for web
  static String get localeName => 'en_US'; // Default for web
  static String get executable => '';
  static String get packageConfig => '';
  
  // Environment variables stub
  static Map<String, String> get environment => <String, String>{
    'PLATFORM': 'web',
    'WEB_BROWSER': 'true',
  };
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
  Future<bool> exists() async {
    // For debugging purposes
    print('[WebIOStub] Checking if directory exists: $path');
    try {
      // In a real app, this would use IndexedDB or localStorage
      // Here we'll simulate success for typical paths
      if (path == '/tmp' || path == '/tmp/logs') {
        print('[WebIOStub] Directory exists: $path');
        return true;
      }
      print('[WebIOStub] Directory does not exist: $path');
      return false;
    } catch (e) {
      print('[WebIOStub] Error checking directory existence: $e');
      return false;
    }
  }
  
  // Stub for directory creation
  Future<Directory> create({bool recursive = false}) async {
    print('[WebIOStub] Creating directory: $path (recursive: $recursive)');
    try {
      // In a real app, this would use IndexedDB or localStorage
      // Here we'll just log and return this
      print('[WebIOStub] Directory created successfully: $path');
      return this;
    } catch (e) {
      print('[WebIOStub] Error creating directory: $e');
      return this;
    }
  }
}

// File stub class for web
class File {
  final String path;
  
  File(this.path);
  
  // Stubs for existence check
  Future<bool> exists() async {
    print('[WebIOStub] Checking if file exists: $path');
    try {
      // In a real app, this would use IndexedDB or localStorage
      // Here we'll simulate existence for typical log files
      if (path.contains('/tmp/logs/gaia-space')) {
        print('[WebIOStub] File exists: $path');
        return true;
      }
      print('[WebIOStub] File does not exist: $path');
      return false;
    } catch (e) {
      print('[WebIOStub] Error checking file existence: $e');
      return false;
    }
  }
  
  // Stub for file creation
  Future<File> create({bool recursive = false}) async {
    print('[WebIOStub] Creating file: $path (recursive: $recursive)');
    try {
      // In a real app, this would use IndexedDB or localStorage
      print('[WebIOStub] File created successfully: $path');
      return this;
    } catch (e) {
      print('[WebIOStub] Error creating file: $e');
      return this;
    }
  }
  
  // Stub for writing to file
  Future<File> writeAsString(String contents, {FileMode mode = FileMode.write, bool flush = false}) async {
    print('[WebIOStub] Writing to file: $path');
    print('[WebIOStub] Contents length: ${contents.length} characters');
    print('[WebIOStub] Mode: ${mode._mode}');
    
    try {
      // In web context, this would use localStorage or IndexedDB
      // For this stub, we'll just print the first part of the content for debugging
      if (contents.length > 100) {
        print('[WebIOStub] First 100 chars: ${contents.substring(0, 100)}...');
      } else {
        print('[WebIOStub] Content: $contents');
      }
      print('[WebIOStub] Write operation successful');
      return this;
    } catch (e) {
      print('[WebIOStub] Error writing to file: $e');
      return this;
    }
  }
  
  // Stub for reading from file
  Future<String> readAsString() async {
    print('[WebIOStub] Reading from file: $path');
    try {
      // In web context, this would use localStorage or IndexedDB
      // For this stub, we'll return a dummy message
      print('[WebIOStub] Read operation successful (stub data)');
      return '[WebIOStub] This is stub content for file: $path';
    } catch (e) {
      print('[WebIOStub] Error reading from file: $e');
      return '';
    }
  }
}

// FileMode enum stub for web
class FileMode {
  final int _mode;
  const FileMode._internal(this._mode);
  
  static const FileMode read = FileMode._internal(0);
  static const FileMode write = FileMode._internal(1);
  static const FileMode append = FileMode._internal(2);
  static const FileMode writeOnly = FileMode._internal(3);
  static const FileMode writeOnlyAppend = FileMode._internal(4);
}