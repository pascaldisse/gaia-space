import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaia_space/core/models/custom_command.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/services/custom_command_service.dart';
import 'package:mockito/mockito.dart';
import 'package:uuid/uuid.dart';

// Mock classes
class MockGitRepository extends Mock implements GitRepository {
  @override
  final String id;
  @override
  final String name;
  @override
  final String? path;

  MockGitRepository({
    required this.id,
    required this.name,
    this.path,
  });
}

void main() {
  group('CustomCommandService', () {
    late CustomCommandService service;

    setUp(() {
      service = CustomCommandService();
    });

    test('should initialize with default commands', () {
      // Assert
      final commands = service.getCommands();
      expect(commands.length, greaterThan(0));
      expect(commands.any((cmd) => cmd.name == 'Git Status'), isTrue);
      expect(commands.any((cmd) => cmd.name == 'Git Pull'), isTrue);
    });

    test('should create a new command', () async {
      // Arrange
      final command = CustomCommand(
        id: '',
        name: 'Test Command',
        command: 'echo "Test"',
        description: 'A test command',
        createdBy: 'test-user',
        createdAt: DateTime.now(),
      );

      // Act
      final createdCommand = await service.createCommand(command);

      // Assert
      expect(createdCommand.id, isNotEmpty);
      expect(createdCommand.name, equals('Test Command'));
      expect(service.getCommandById(createdCommand.id), isNotNull);
    });

    test('should update an existing command', () async {
      // Arrange
      final command = CustomCommand(
        id: const Uuid().v4(),
        name: 'Command to Update',
        command: 'echo "Original"',
        createdBy: 'test-user',
        createdAt: DateTime.now(),
      );
      await service.createCommand(command);

      // Act
      final updatedCommand = await service.updateCommand(
        command.copyWith(
          command: 'echo "Updated"',
          description: 'Updated description',
        )
      );

      // Assert
      expect(updatedCommand.command, equals('echo "Updated"'));
      expect(updatedCommand.description, equals('Updated description'));
      expect(service.getCommandById(command.id)?.command, equals('echo "Updated"'));
    });

    test('should delete a command', () async {
      // Arrange
      final command = CustomCommand(
        id: const Uuid().v4(),
        name: 'Command to Delete',
        command: 'echo "Delete me"',
        createdBy: 'test-user',
        createdAt: DateTime.now(),
      );
      await service.createCommand(command);

      // Act
      await service.deleteCommand(command.id);

      // Assert
      expect(service.getCommandById(command.id), isNull);
    });

    test('should filter commands by category', () async {
      // Arrange
      final utilityCommand = CustomCommand(
        id: const Uuid().v4(),
        name: 'Utility Command',
        command: 'echo "Utility"',
        category: CustomCommandCategory.utility,
        createdBy: 'test-user',
        createdAt: DateTime.now(),
      );
      final branchCommand = CustomCommand(
        id: const Uuid().v4(),
        name: 'Branch Command',
        command: 'echo "Branch"',
        category: CustomCommandCategory.branch,
        createdBy: 'test-user',
        createdAt: DateTime.now(),
      );
      await service.createCommand(utilityCommand);
      await service.createCommand(branchCommand);

      // Act
      final utilityCommands = service.getCommandsByCategory(CustomCommandCategory.utility);
      final branchCommands = service.getCommandsByCategory(CustomCommandCategory.branch);

      // Assert
      expect(utilityCommands.any((cmd) => cmd.name == 'Utility Command'), isTrue);
      expect(utilityCommands.any((cmd) => cmd.name == 'Branch Command'), isFalse);
      expect(branchCommands.any((cmd) => cmd.name == 'Branch Command'), isTrue);
      expect(branchCommands.any((cmd) => cmd.name == 'Utility Command'), isFalse);
    });

    test('should import and export commands as JSON', () async {
      // Arrange
      final command1 = CustomCommand(
        id: const Uuid().v4(),
        name: 'Export Command 1',
        command: 'echo "Export 1"',
        createdBy: 'test-user',
        createdAt: DateTime.now(),
      );
      final command2 = CustomCommand(
        id: const Uuid().v4(),
        name: 'Export Command 2',
        command: 'echo "Export 2"',
        createdBy: 'test-user',
        createdAt: DateTime.now(),
      );
      await service.createCommand(command1);
      await service.createCommand(command2);

      // Act - Export
      final exportedJson = service.exportCommands();
      
      // Create a new service instance to test import
      final newService = CustomCommandService();
      
      // Act - Import
      await newService.importCommandsFromJson(exportedJson);
      
      // Assert
      expect(newService.getCommands().any((cmd) => cmd.name == 'Export Command 1'), isTrue);
      expect(newService.getCommands().any((cmd) => cmd.name == 'Export Command 2'), isTrue);
    });

    test('should process parameters in command execution', () async {
      // Arrange
      final parameterCommand = CustomCommand(
        id: const Uuid().v4(),
        name: 'Parameter Command',
        command: 'echo "Hello {{name}}"',
        parameters: [
          CustomCommandParameter(
            id: const Uuid().v4(),
            name: 'name',
            type: CustomCommandParameterType.text,
            required: true,
          ),
        ],
        createdBy: 'test-user',
        createdAt: DateTime.now(),
      );
      await service.createCommand(parameterCommand);
      
      final repository = MockGitRepository(
        id: '1',
        name: 'Test Repo',
        path: '/tmp', // Use a temp directory that should exist on test systems
      );
      
      // Act
      final result = await service.executeCommand(
        parameterCommand.id, 
        repository, 
        {'name': 'World'},
      );
      
      // Assert
      expect(result.processedCommand, equals('echo "Hello World"'));
      expect(result.isSuccess, isTrue);
      expect(result.stdout.trim(), equals('Hello World'));
    });

    test('should throw exception for missing required parameters', () async {
      // Arrange
      final parameterCommand = CustomCommand(
        id: const Uuid().v4(),
        name: 'Required Parameter Command',
        command: 'echo "Hello {{name}}"',
        parameters: [
          CustomCommandParameter(
            id: const Uuid().v4(),
            name: 'name',
            type: CustomCommandParameterType.text,
            required: true,
          ),
        ],
        createdBy: 'test-user',
        createdAt: DateTime.now(),
      );
      await service.createCommand(parameterCommand);
      
      final repository = MockGitRepository(
        id: '1',
        name: 'Test Repo',
        path: '/tmp',
      );
      
      // Act & Assert
      expect(
        () => service.executeCommand(
          parameterCommand.id, 
          repository, 
          {}, // Empty parameters
        ),
        throwsException,
      );
    });
  });
}