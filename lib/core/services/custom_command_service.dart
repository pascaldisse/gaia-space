import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:gaia_space/core/models/custom_command.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/services/git_service.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:uuid/uuid.dart';
import 'package:path/path.dart' as path;

/// Service for managing and executing custom Git commands
class CustomCommandService {
  static final CustomCommandService _instance = CustomCommandService._internal();
  factory CustomCommandService() => _instance;
  
  final AppLogger _logger = AppLogger('CustomCmdSvc');
  final GitService _gitService = GitService();
  
  // In-memory storage until we have a database
  final List<CustomCommand> _commands = [];
  
  CustomCommandService._internal() {
    _loadDefaultCommands();
    _logger.info('CustomCommandService initialized with ${_commands.length} default commands');
  }
  
  /// Load default commands
  void _loadDefaultCommands() {
    final now = DateTime.now();
    final systemUser = 'system';
    
    _commands.addAll([
      CustomCommand(
        id: const Uuid().v4(),
        name: 'Git Status',
        command: 'git status',
        description: 'Show the working tree status',
        icon: Icons.info_outline,
        iconColor: Colors.blue,
        category: CustomCommandCategory.general,
        createdBy: systemUser,
        createdAt: now,
      ),
      CustomCommand(
        id: const Uuid().v4(),
        name: 'Git Pull',
        command: 'git pull',
        description: 'Fetch from and integrate with another repository or a local branch',
        icon: Icons.download,
        iconColor: Colors.green,
        category: CustomCommandCategory.general,
        createdBy: systemUser,
        createdAt: now,
      ),
      CustomCommand(
        id: const Uuid().v4(),
        name: 'Clean Untracked Files',
        command: 'git clean -fd',
        description: 'Remove untracked files from the working tree',
        icon: Icons.cleaning_services,
        iconColor: Colors.red,
        category: CustomCommandCategory.utility,
        requiresConfirmation: true,
        createdBy: systemUser,
        createdAt: now,
      ),
      CustomCommand(
        id: const Uuid().v4(),
        name: 'Create Feature Branch',
        command: 'git checkout -b feature/{{branch_name}}',
        description: 'Create and checkout a new feature branch',
        icon: Icons.call_split,
        iconColor: Colors.purple,
        category: CustomCommandCategory.branch,
        parameters: [
          CustomCommandParameter(
            id: const Uuid().v4(),
            name: 'branch_name',
            description: 'Name of the feature (without feature/ prefix)',
            placeholder: 'my-feature',
            type: CustomCommandParameterType.text,
            required: true,
          ),
        ],
        createdBy: systemUser,
        createdAt: now,
      ),
      CustomCommand(
        id: const Uuid().v4(),
        name: 'Repository Stats',
        command: 'git shortlog -sn --all',
        description: 'Show commit count by author',
        icon: Icons.bar_chart,
        iconColor: Colors.amber,
        category: CustomCommandCategory.repository,
        createdBy: systemUser,
        createdAt: now,
      ),
    ]);
  }
  
  /// Get all available custom commands
  List<CustomCommand> getCommands() {
    return List.unmodifiable(_commands);
  }
  
  /// Get commands by category
  List<CustomCommand> getCommandsByCategory(CustomCommandCategory category) {
    return _commands.where((cmd) => cmd.category == category).toList();
  }
  
  /// Get a command by ID
  CustomCommand? getCommandById(String id) {
    try {
      return _commands.firstWhere((cmd) => cmd.id == id);
    } catch (e) {
      _logger.warning('Command not found with ID: $id');
      return null;
    }
  }
  
  /// Create a new custom command
  Future<CustomCommand> createCommand(CustomCommand command) async {
    _logger.info('Creating new custom command: ${command.name}');
    
    if (_commands.any((cmd) => cmd.name == command.name)) {
      _logger.warning('Command with the same name already exists: ${command.name}');
      throw Exception('Command with the same name already exists');
    }
    
    // Generate ID if not provided
    final newCommand = command.id.isEmpty 
        ? command.copyWith(id: const Uuid().v4()) 
        : command;
    
    _commands.add(newCommand);
    await _saveCommandsToFile();
    
    _logger.info('Command created successfully: ${newCommand.name} (${newCommand.id})');
    return newCommand;
  }
  
  /// Update an existing custom command
  Future<CustomCommand> updateCommand(CustomCommand command) async {
    _logger.info('Updating custom command: ${command.id}');
    
    final index = _commands.indexWhere((cmd) => cmd.id == command.id);
    if (index == -1) {
      _logger.error('Failed to update command: Command not found with ID ${command.id}');
      throw Exception('Command not found');
    }
    
    _commands[index] = command;
    await _saveCommandsToFile();
    
    _logger.info('Command updated successfully: ${command.name} (${command.id})');
    return command;
  }
  
  /// Delete a custom command
  Future<void> deleteCommand(String id) async {
    _logger.info('Deleting custom command: $id');
    
    final initialLength = _commands.length;
    _commands.removeWhere((cmd) => cmd.id == id);
    
    if (_commands.length == initialLength) {
      _logger.warning('Command not found for deletion: $id');
      throw Exception('Command not found');
    }
    
    await _saveCommandsToFile();
    _logger.info('Command deleted successfully: $id');
  }
  
  /// Execute a custom command
  Future<CommandExecutionResult> executeCommand(
    String commandId, 
    GitRepository repository, 
    Map<String, String> parameters
  ) async {
    _logger.info('Executing custom command: $commandId');
    
    // Get the command
    final command = getCommandById(commandId);
    if (command == null) {
      _logger.error('Failed to execute command: Command not found with ID $commandId');
      throw Exception('Command not found');
    }
    
    // Validate repository
    if (repository.path == null) {
      _logger.error('Failed to execute command: Repository path is null');
      throw Exception('Repository path is null');
    }
    
    // Replace parameter placeholders in command
    String processedCommand = command.command;
    for (final param in command.parameters) {
      final paramValue = parameters[param.name];
      if (param.required && (paramValue == null || paramValue.isEmpty)) {
        _logger.error('Failed to execute command: Required parameter ${param.name} is missing');
        throw Exception('Required parameter ${param.name} is missing');
      }
      
      if (paramValue != null) {
        processedCommand = processedCommand.replaceAll('{{${param.name}}}', paramValue);
      }
    }
    
    _logger.debug('Processed command: $processedCommand');
    
    try {
      // Execute the command
      final stopwatch = Stopwatch()..start();
      final result = await Process.run(
        'bash', 
        ['-c', processedCommand],
        workingDirectory: repository.path,
      );
      stopwatch.stop();
      
      // Update last run timestamp
      final updatedCommand = command.copyWith(
        lastRunAt: DateTime.now(),
      );
      await updateCommand(updatedCommand);
      
      final executionResult = CommandExecutionResult(
        command: command,
        processedCommand: processedCommand,
        repository: repository,
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        executionTime: stopwatch.elapsedMilliseconds,
        executedAt: DateTime.now(),
      );
      
      if (result.exitCode == 0) {
        _logger.info('Command executed successfully in ${stopwatch.elapsedMilliseconds}ms');
      } else {
        _logger.warning('Command execution failed with exit code ${result.exitCode}');
        _logger.debug('Error output: ${result.stderr}');
      }
      
      return executionResult;
    } catch (e) {
      _logger.error('Error executing command', error: e);
      throw Exception('Error executing command: ${e.toString()}');
    }
  }
  
  /// Share a command with other users
  Future<CustomCommand> shareCommand(String commandId) async {
    _logger.info('Sharing command: $commandId');
    
    final command = getCommandById(commandId);
    if (command == null) {
      throw Exception('Command not found');
    }
    
    final sharedCommand = command.copyWith(isShared: true);
    return await updateCommand(sharedCommand);
  }
  
  /// Save commands to file for persistence
  Future<void> _saveCommandsToFile() async {
    try {
      final appDir = Directory(path.join(Directory.current.path, '.gaia_space'));
      if (!await appDir.exists()) {
        await appDir.create(recursive: true);
      }
      
      final file = File(path.join(appDir.path, 'custom_commands.json'));
      final json = _commands.map((cmd) => cmd.toJson()).toList();
      await file.writeAsString(jsonEncode(json));
      
      _logger.debug('Saved ${_commands.length} commands to file');
    } catch (e) {
      _logger.error('Failed to save commands to file', error: e);
    }
  }
  
  /// Load commands from file
  Future<void> loadCommandsFromFile() async {
    try {
      final appDir = Directory(path.join(Directory.current.path, '.gaia_space'));
      final file = File(path.join(appDir.path, 'custom_commands.json'));
      
      if (await file.exists()) {
        final content = await file.readAsString();
        final jsonList = jsonDecode(content) as List;
        
        _commands.clear();
        _commands.addAll(
          jsonList.map((json) => CustomCommand.fromJson(json)).toList()
        );
        
        _logger.info('Loaded ${_commands.length} commands from file');
      } else {
        _logger.info('No saved commands file found, using default commands');
      }
    } catch (e) {
      _logger.error('Failed to load commands from file', error: e);
    }
  }
  
  /// Import commands from JSON
  Future<int> importCommandsFromJson(String json) async {
    try {
      final jsonList = jsonDecode(json) as List;
      final importedCommands = jsonList
          .map((item) => CustomCommand.fromJson(item))
          .toList();
      
      int importCount = 0;
      for (final cmd in importedCommands) {
        if (!_commands.any((existing) => existing.name == cmd.name)) {
          _commands.add(cmd.copyWith(
            id: const Uuid().v4(), // Generate new ID to avoid conflicts
          ));
          importCount++;
        }
      }
      
      if (importCount > 0) {
        await _saveCommandsToFile();
      }
      
      _logger.info('Imported $importCount new commands');
      return importCount;
    } catch (e) {
      _logger.error('Failed to import commands from JSON', error: e);
      throw Exception('Invalid JSON format: ${e.toString()}');
    }
  }
  
  /// Export commands to JSON
  String exportCommands() {
    try {
      final json = jsonEncode(_commands.map((cmd) => cmd.toJson()).toList());
      _logger.info('Exported ${_commands.length} commands to JSON');
      return json;
    } catch (e) {
      _logger.error('Failed to export commands to JSON', error: e);
      throw Exception('Failed to export commands: ${e.toString()}');
    }
  }
}

/// Result of executing a custom command
class CommandExecutionResult {
  final CustomCommand command;
  final String processedCommand;
  final GitRepository repository;
  final int exitCode;
  final String stdout;
  final String stderr;
  final int executionTime;
  final DateTime executedAt;
  
  CommandExecutionResult({
    required this.command,
    required this.processedCommand,
    required this.repository,
    required this.exitCode,
    required this.stdout,
    required this.stderr,
    required this.executionTime,
    required this.executedAt,
  });
  
  bool get isSuccess => exitCode == 0;
  
  Map<String, dynamic> toJson() {
    return {
      'command': command.toJson(),
      'processedCommand': processedCommand,
      'repository': repository.id,
      'exitCode': exitCode,
      'stdout': stdout,
      'stderr': stderr,
      'executionTime': executionTime,
      'executedAt': executedAt.toIso8601String(),
      'isSuccess': isSuccess,
    };
  }
}