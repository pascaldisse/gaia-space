import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:logger/logger.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as path;

class AppLogger {
  static late Logger _logger;
  static late File _logFile;
  
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
    
    // Log initialization
    _logger.i('Logger initialized');
  }
  
  static void trace(String message, [dynamic error, StackTrace? stackTrace]) {
    _logger.v(message);
  }
  
  static void debug(String message, [dynamic error, StackTrace? stackTrace]) {
    _logger.d(message);
    if (error != null) {
      _logger.d('Error: $error');
      if (stackTrace != null) {
        _logger.d('Stack trace: $stackTrace');
      }
    }
  }
  
  static void info(String message, [dynamic error, StackTrace? stackTrace]) {
    _logger.i(message);
    if (error != null) {
      _logger.i('Error: $error');
      if (stackTrace != null) {
        _logger.i('Stack trace: $stackTrace');
      }
    }
  }
  
  static void warning(String message, [dynamic error, StackTrace? stackTrace]) {
    _logger.w(message);
    if (error != null) {
      _logger.w('Error: $error');
      if (stackTrace != null) {
        _logger.w('Stack trace: $stackTrace');
      }
    }
  }
  
  static void error(String message, [dynamic error, StackTrace? stackTrace]) {
    _logger.e(message);
    if (error != null) {
      _logger.e('Error: $error');
      if (stackTrace != null) {
        _logger.e('Stack trace: $stackTrace');
      }
    }
  }
  
  static void wtf(String message, [dynamic error, StackTrace? stackTrace]) {
    _logger.wtf(message);
    if (error != null) {
      _logger.wtf('Error: $error');
      if (stackTrace != null) {
        _logger.wtf('Stack trace: $stackTrace');
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