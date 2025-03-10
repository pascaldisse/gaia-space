import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:logger/logger.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as path;

/// AppLogger provides a simple logging interface that can be used
/// both statically and as an instance with tags.
class AppLogger {
  static late Logger _logger;
  static late File _logFile;
  final String _tag;
  
  static bool _isInitialized = false;
  
  /// Create a logger instance with an optional tag
  AppLogger([this._tag = '']) {
    if (!_isInitialized) {
      // If used before initialization, set a default logger
      _logger = Logger();
      _isInitialized = true;
    }
  }
  
  /// Initialize the logger. Should be called once at app startup.
  static Future<void> init() async {
    // Initialize file logging in production
    if (!kDebugMode) {
      final Directory appDocDir = await getApplicationDocumentsDirectory();
      final String logDirPath = path.join(appDocDir.path, 'logs');
      
      // Create logs directory if it doesn't exist
      final Directory logDir = Directory(logDirPath);
      if (!await logDir.exists()) {
        await logDir.create(recursive: true);
      }
      
      // Create or use existing log file with current date
      final String today = DateTime.now().toIso8601String().split('T')[0];
      final String logFilePath = path.join(logDirPath, 'gaia-space-$today.log');
      _logFile = File(logFilePath);
      
      if (!await _logFile.exists()) {
        await _logFile.create(recursive: true);
      }
    }
    
    // Configure logger
    _logger = Logger(
      printer: PrettyPrinter(
        methodCount: 2,
        errorMethodCount: 8,
        lineLength: 120,
        colors: true,
        printEmojis: true,
        printTime: true,
      ),
      output: kDebugMode 
          ? ConsoleOutput() 
          : MultiOutput([ConsoleOutput(), FileOutput(_logFile)]),
      level: kDebugMode ? Level.debug : Level.info,
    );
    
    _isInitialized = true;
    
    // Log initialization
    _logger.i('Logger initialized');
  }
  
  /// Log a verbose message with optional error and stack trace
  static void v(String message, [dynamic error, StackTrace? stackTrace]) {
    if (!_isInitialized) {
      _logger = Logger();
      _isInitialized = true;
    }
    _logger.v(message);
    if (error != null) {
      _logger.v('Error: $error');
      if (stackTrace != null) {
        _logger.v('Stack trace: $stackTrace');
      }
    }
  }
  
  /// Log a debug message with optional error and stack trace
  static void d(String message, [dynamic error, StackTrace? stackTrace]) {
    if (!_isInitialized) {
      _logger = Logger();
      _isInitialized = true;
    }
    _logger.d(message);
    if (error != null) {
      _logger.d('Error: $error');
      if (stackTrace != null) {
        _logger.d('Stack trace: $stackTrace');
      }
    }
  }
  
  /// Log an info message with optional error and stack trace
  static void i(String message, [dynamic error, StackTrace? stackTrace]) {
    if (!_isInitialized) {
      _logger = Logger();
      _isInitialized = true;
    }
    _logger.i(message);
    if (error != null) {
      _logger.i('Error: $error');
      if (stackTrace != null) {
        _logger.i('Stack trace: $stackTrace');
      }
    }
  }
  
  /// Log a warning message with optional error and stack trace
  static void w(String message, [dynamic error, StackTrace? stackTrace]) {
    if (!_isInitialized) {
      _logger = Logger();
      _isInitialized = true;
    }
    _logger.w(message);
    if (error != null) {
      _logger.w('Error: $error');
      if (stackTrace != null) {
        _logger.w('Stack trace: $stackTrace');
      }
    }
  }
  
  /// Log an error message with optional error and stack trace
  static void e(String message, [dynamic error, StackTrace? stackTrace]) {
    if (!_isInitialized) {
      _logger = Logger();
      _isInitialized = true;
    }
    _logger.e(message);
    if (error != null) {
      _logger.e('Error: $error');
      if (stackTrace != null) {
        _logger.e('Stack trace: $stackTrace');
      }
    }
  }
  
  /// Log a critical "what a terrible failure" message
  static void wtf(String message, [dynamic error, StackTrace? stackTrace]) {
    if (!_isInitialized) {
      _logger = Logger();
      _isInitialized = true;
    }
    _logger.wtf(message);
    if (error != null) {
      _logger.wtf('Error: $error');
      if (stackTrace != null) {
        _logger.wtf('Stack trace: $stackTrace');
      }
    }
  }
  
  // Alias methods for backward compatibility
  static void trace(String message, [dynamic error, StackTrace? stackTrace]) => v(message, error, stackTrace);
  static void debug(String message, [dynamic error, StackTrace? stackTrace]) => d(message, error, stackTrace);
  static void info(String message, [dynamic error, StackTrace? stackTrace]) => i(message, error, stackTrace);
  static void warning(String message, [dynamic error, StackTrace? stackTrace]) => w(message, error, stackTrace);
  static void error(String message, [dynamic error, StackTrace? stackTrace]) => e(message, error, stackTrace);
  
  // Instance methods with tag support
  void logVerbose(String message, {dynamic error, StackTrace? stackTrace}) {
    final tag = _tag.isNotEmpty ? '[$_tag] ' : '';
    _logger.v('$tag$message');
    if (error != null) {
      _logger.v('$tag Error: $error');
      if (stackTrace != null) {
        _logger.v('$tag Stack trace: $stackTrace');
      }
    }
  }
  
  void logDebug(String message, {dynamic error, StackTrace? stackTrace}) {
    final tag = _tag.isNotEmpty ? '[$_tag] ' : '';
    _logger.d('$tag$message');
    if (error != null) {
      _logger.d('$tag Error: $error');
      if (stackTrace != null) {
        _logger.d('$tag Stack trace: $stackTrace');
      }
    }
  }
  
  void logInfo(String message, {dynamic error, StackTrace? stackTrace}) {
    final tag = _tag.isNotEmpty ? '[$_tag] ' : '';
    _logger.i('$tag$message');
    if (error != null) {
      _logger.i('$tag Error: $error');
      if (stackTrace != null) {
        _logger.i('$tag Stack trace: $stackTrace');
      }
    }
  }
  
  void logWarning(String message, {dynamic error, StackTrace? stackTrace}) {
    final tag = _tag.isNotEmpty ? '[$_tag] ' : '';
    _logger.w('$tag$message');
    if (error != null) {
      _logger.w('$tag Error: $error');
      if (stackTrace != null) {
        _logger.w('$tag Stack trace: $stackTrace');
      }
    }
  }
  
  void logError(String message, {dynamic error, StackTrace? stackTrace}) {
    final tag = _tag.isNotEmpty ? '[$_tag] ' : '';
    _logger.e('$tag$message');
    if (error != null) {
      _logger.e('$tag Error: $error');
      if (stackTrace != null) {
        _logger.e('$tag Stack trace: $stackTrace');
      }
    }
  }
  
  void logWtf(String message, {dynamic error, StackTrace? stackTrace}) {
    final tag = _tag.isNotEmpty ? '[$_tag] ' : '';
    _logger.wtf('$tag$message');
    if (error != null) {
      _logger.wtf('$tag Error: $error');
      if (stackTrace != null) {
        _logger.wtf('$tag Stack trace: $stackTrace');
      }
    }
  }
}

class FileOutput extends LogOutput {
  final File file;
  
  FileOutput(this.file);
  
  @override
  void output(OutputEvent event) async {
    final logString = event.lines.join('\n');
    await file.writeAsString('$logString\n', mode: FileMode.append);
  }
}

class MultiOutput extends LogOutput {
  final List<LogOutput> outputs;
  
  MultiOutput(this.outputs);
  
  @override
  void output(OutputEvent event) {
    for (var output in outputs) {
      output.output(event);
    }
  }
}