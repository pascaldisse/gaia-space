import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:logger/logger.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as path;

class AppLogger {
  static late Logger _logger;
  static late File _logFile;
  final String _context;
  
  // Constructor that accepts context
  AppLogger([this._context = 'App']);
  
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
  
  // Instance methods for context-aware logging
  void debug(String message, {dynamic error, StackTrace? stackTrace}) {
    final contextMessage = '[$_context] $message';
    _logger.d(contextMessage);
    if (error != null) {
      _logger.d('Error: $error');
      if (stackTrace != null) {
        _logger.d('Stack trace: $stackTrace');
      }
    }
  }
  
  void info(String message, {dynamic error, StackTrace? stackTrace}) {
    final contextMessage = '[$_context] $message';
    _logger.i(contextMessage);
    if (error != null) {
      _logger.i('Error: $error');
      if (stackTrace != null) {
        _logger.i('Stack trace: $stackTrace');
      }
    }
  }
  
  void warning(String message, {dynamic error, StackTrace? stackTrace}) {
    final contextMessage = '[$_context] $message';
    _logger.w(contextMessage);
    if (error != null) {
      _logger.w('Error: $error');
      if (stackTrace != null) {
        _logger.w('Stack trace: $stackTrace');
      }
    }
  }
  
  void error(String message, {dynamic error, StackTrace? stackTrace}) {
    final contextMessage = '[$_context] $message';
    _logger.e(contextMessage);
    if (error != null) {
      _logger.e('Error: $error');
      if (stackTrace != null) {
        _logger.e('Stack trace: $stackTrace');
      }
    }
  }
  
  void verbose(String message, {dynamic error, StackTrace? stackTrace}) {
    final contextMessage = '[$_context] $message';
    _logger.v(contextMessage);
    if (error != null) {
      _logger.v('Error: $error');
      if (stackTrace != null) {
        _logger.v('Stack trace: $stackTrace');
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