import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gaia_space/core/models/custom_command.dart';

void main() {
  group('CustomCommand', () {
    test('should create a custom command with default values', () {
      // Arrange
      final command = CustomCommand(
        id: '1',
        name: 'Test Command',
        command: 'git status',
        createdBy: 'test-user',
        createdAt: DateTime(2023, 1, 1),
      );

      // Assert
      expect(command.id, equals('1'));
      expect(command.name, equals('Test Command'));
      expect(command.command, equals('git status'));
      expect(command.description, isNull);
      expect(command.parameters, isEmpty);
      expect(command.category, equals(CustomCommandCategory.general));
      expect(command.icon, equals(Icons.code));
      expect(command.iconColor, equals(Colors.blue));
      expect(command.isShared, isFalse);
      expect(command.createdBy, equals('test-user'));
      expect(command.createdAt, equals(DateTime(2023, 1, 1)));
      expect(command.lastRunAt, isNull);
      expect(command.requiresConfirmation, isFalse);
      expect(command.runInTerminal, isFalse);
      expect(command.showOutput, isTrue);
      expect(command.platformSupport, equals(PlatformSupport.all));
    });

    test('should create a copy with updated values', () {
      // Arrange
      final original = CustomCommand(
        id: '1',
        name: 'Test Command',
        command: 'git status',
        createdBy: 'test-user',
        createdAt: DateTime(2023, 1, 1),
      );

      // Act
      final updated = original.copyWith(
        name: 'Updated Command',
        description: 'A test command',
        isShared: true,
      );

      // Assert
      expect(updated.id, equals('1')); // unchanged
      expect(updated.name, equals('Updated Command')); // changed
      expect(updated.description, equals('A test command')); // changed
      expect(updated.isShared, isTrue); // changed
      expect(updated.command, equals('git status')); // unchanged
    });

    test('should convert to and from JSON', () {
      // Arrange
      final command = CustomCommand(
        id: '1',
        name: 'Test Command',
        command: 'git status',
        description: 'A test command',
        parameters: [
          CustomCommandParameter(
            id: 'p1',
            name: 'Parameter 1',
            type: CustomCommandParameterType.text,
          ),
        ],
        category: CustomCommandCategory.repository,
        icon: Icons.terminal,
        iconColor: Colors.green,
        isShared: true,
        createdBy: 'test-user',
        createdAt: DateTime(2023, 1, 1),
        lastRunAt: DateTime(2023, 1, 2),
        requiresConfirmation: true,
        platformSupport: PlatformSupport.mac,
      );

      // Act
      final json = command.toJson();
      final fromJson = CustomCommand.fromJson(json);

      // Assert
      expect(fromJson.id, equals(command.id));
      expect(fromJson.name, equals(command.name));
      expect(fromJson.command, equals(command.command));
      expect(fromJson.description, equals(command.description));
      expect(fromJson.parameters.length, equals(1));
      expect(fromJson.parameters.first.id, equals('p1'));
      expect(fromJson.category, equals(CustomCommandCategory.repository));
      expect(fromJson.icon.codePoint, equals(Icons.terminal.codePoint));
      expect(fromJson.isShared, isTrue);
      expect(fromJson.createdAt, equals(command.createdAt));
      expect(fromJson.lastRunAt, equals(command.lastRunAt));
      expect(fromJson.requiresConfirmation, isTrue);
      expect(fromJson.platformSupport, equals(PlatformSupport.mac));
    });
  });

  group('CustomCommandParameter', () {
    test('should create a parameter with default values', () {
      // Arrange
      final parameter = CustomCommandParameter(
        id: 'p1',
        name: 'Parameter 1',
        type: CustomCommandParameterType.text,
      );

      // Assert
      expect(parameter.id, equals('p1'));
      expect(parameter.name, equals('Parameter 1'));
      expect(parameter.type, equals(CustomCommandParameterType.text));
      expect(parameter.description, isNull);
      expect(parameter.placeholder, isNull);
      expect(parameter.defaultValue, isNull);
      expect(parameter.options, isNull);
      expect(parameter.required, isFalse);
      expect(parameter.order, equals(0));
    });

    test('should convert to and from JSON', () {
      // Arrange
      final parameter = CustomCommandParameter(
        id: 'p1',
        name: 'Parameter 1',
        description: 'A test parameter',
        placeholder: 'Enter text',
        type: CustomCommandParameterType.select,
        defaultValue: 'option1',
        options: ['option1', 'option2'],
        required: true,
        order: 1,
      );

      // Act
      final json = parameter.toJson();
      final fromJson = CustomCommandParameter.fromJson(json);

      // Assert
      expect(fromJson.id, equals(parameter.id));
      expect(fromJson.name, equals(parameter.name));
      expect(fromJson.description, equals(parameter.description));
      expect(fromJson.placeholder, equals(parameter.placeholder));
      expect(fromJson.type, equals(CustomCommandParameterType.select));
      expect(fromJson.defaultValue, equals(parameter.defaultValue));
      expect(fromJson.options, equals(parameter.options));
      expect(fromJson.required, isTrue);
      expect(fromJson.order, equals(1));
    });
  });
}