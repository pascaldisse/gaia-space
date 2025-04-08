import 'dart:async';
import 'dart:io' as io_native;
import 'package:gaia_space/core/utils/web_io_stub.dart' as io_web;
import 'package:flutter/foundation.dart';
import 'package:logger/logger.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as path;

class AppLogger {
  static late Logger _logger;
  static dynamic _logFile; // Can be io_native.File or io_web.File
  final String _context;
  
  // Constructor that accepts context
  AppLogger([this._context = 'App']);
  
  static Future<void> init() async {
    print('Starting logger initialization...');
    
    try {
      // Special case for web to avoid file operations that might fail
      if (kIsWeb) {
        print('Running in web mode, skipping file-based logging');
        // We'll just use console logging for web
      } else {
        // Initialize file logging for non-web platforms
        try {
          final appDocDir = await getApplicationDocumentsDirectory();
          final String logDirPath = path.join(appDocDir.path, 'logs');
          print('Log directory path: $logDirPath');
          
          // Create logs directory if it doesn't exist
          final logDir = io_native.Directory(logDirPath);
          if (!await logDir.exists()) {
            print('Creating log directory...');
            await logDir.create(recursive: true);
          }
          
          // Create or use existing log file with current date
          final String today = DateTime.now().toIso8601String().split('T')[0];
          final String logFilePath = path.join(logDirPath, 'gaia-space-$today.log');
          print('Log file path: $logFilePath');
          _logFile = io_native.File(logFilePath);
          
          if (!await _logFile!.exists()) {
            print('Creating log file...');
            await _logFile!.create(recursive: true);
          }
        } catch (e, stack) {
          // Fallback if file operations fail
          print('Error setting up log file: $e');
          print('Stack trace: $stack');
        }
      }
    } catch (e, stack) {
      print('Unexpected error during logger setup: $e');
      print('Stack trace: $stack');
    }
    
    // Configure logger
    try {
      print('Configuring logger...');
      _logger = Logger(
        printer: PrettyPrinter(
          methodCount: 2,
          errorMethodCount: 8,
          lineLength: 120,
          colors: true,
          printEmojis: true,
          printTime: true,
        ),
        output: kIsWeb
            ? ConsoleOutput() 
            : (_logFile != null 
                ? MultiOutput([ConsoleOutput(), FileOutput(_logFile!)]) 
                : ConsoleOutput()),
        level: kDebugMode ? Level.verbose : Level.debug, // Lower level to catch more logs
      );
      
      // Log initialization
      print('Logger initialized successfully');
      _logger.i('Logger initialized at ${DateTime.now()}');
      _logger.i('Platform: ${kIsWeb ? 'Web' : 'Native'}, Debug mode: $kDebugMode');
    } catch (e, stack) {
      print('Error configuring logger: $e');
      print('Stack trace: $stack');
    }
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
  final dynamic file; // Can be io_native.File or io_web.File
  
  FileOutput(this.file);
  
  @override
  void output(OutputEvent event) async {
    try {
      final logString = event.lines.join('\n');
      if (kIsWeb) {
        await (file as io_web.File).writeAsString('$logString\n', mode: io_web.FileMode.append);
      } else {
        await (file as io_native.File).writeAsString('$logString\n', mode: io_native.FileMode.append);
      }
    } catch (e) {
      // Fallback to console if file write fails
      print('Error writing to log file: $e');
      print(event.lines.join('\n'));
    }
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