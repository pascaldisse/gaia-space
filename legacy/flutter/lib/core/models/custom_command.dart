import 'package:equatable/equatable.dart';
import 'package:flutter/material.dart';

/// Custom Git command model
class CustomCommand extends Equatable {
  final String id;
  final String name;
  final String command;
  final String? description;
  final List<CustomCommandParameter> parameters;
  final CustomCommandCategory category;
  final IconData icon;
  final Color iconColor;
  final bool isShared;
  final String createdBy;
  final DateTime createdAt;
  final DateTime? lastRunAt;
  final bool requiresConfirmation;
  final bool runInTerminal;
  final bool showOutput;
  final PlatformSupport platformSupport;

  const CustomCommand({
    required this.id,
    required this.name,
    required this.command,
    this.description,
    this.parameters = const [],
    this.category = CustomCommandCategory.general,
    this.icon = Icons.code,
    this.iconColor = Colors.blue,
    this.isShared = false,
    required this.createdBy,
    required this.createdAt,
    this.lastRunAt,
    this.requiresConfirmation = false,
    this.runInTerminal = false,
    this.showOutput = true,
    this.platformSupport = PlatformSupport.all,
  });

  /// Create a copy with updated fields
  CustomCommand copyWith({
    String? id,
    String? name,
    String? command,
    String? description,
    List<CustomCommandParameter>? parameters,
    CustomCommandCategory? category,
    IconData? icon,
    Color? iconColor,
    bool? isShared,
    String? createdBy,
    DateTime? createdAt,
    DateTime? lastRunAt,
    bool? requiresConfirmation,
    bool? runInTerminal,
    bool? showOutput,
    PlatformSupport? platformSupport,
  }) {
    return CustomCommand(
      id: id ?? this.id,
      name: name ?? this.name,
      command: command ?? this.command,
      description: description ?? this.description,
      parameters: parameters ?? this.parameters,
      category: category ?? this.category,
      icon: icon ?? this.icon,
      iconColor: iconColor ?? this.iconColor,
      isShared: isShared ?? this.isShared,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      lastRunAt: lastRunAt ?? this.lastRunAt,
      requiresConfirmation: requiresConfirmation ?? this.requiresConfirmation,
      runInTerminal: runInTerminal ?? this.runInTerminal,
      showOutput: showOutput ?? this.showOutput,
      platformSupport: platformSupport ?? this.platformSupport,
    );
  }

  /// Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'command': command,
      'description': description,
      'parameters': parameters.map((p) => p.toJson()).toList(),
      'category': category.toString().split('.').last,
      'icon': icon.codePoint,
      'iconColor': iconColor.value,
      'isShared': isShared,
      'createdBy': createdBy,
      'createdAt': createdAt.toIso8601String(),
      'lastRunAt': lastRunAt?.toIso8601String(),
      'requiresConfirmation': requiresConfirmation,
      'runInTerminal': runInTerminal,
      'showOutput': showOutput,
      'platformSupport': platformSupport.toString().split('.').last,
    };
  }

  /// Create from JSON for storage retrieval
  factory CustomCommand.fromJson(Map<String, dynamic> json) {
    return CustomCommand(
      id: json['id'],
      name: json['name'],
      command: json['command'],
      description: json['description'],
      parameters: (json['parameters'] as List?)
          ?.map((p) => CustomCommandParameter.fromJson(p))
          .toList() ??
          [],
      category: _categoryFromString(json['category']),
      icon: IconData(json['icon'], fontFamily: 'MaterialIcons'),
      iconColor: Color(json['iconColor']),
      isShared: json['isShared'] ?? false,
      createdBy: json['createdBy'],
      createdAt: DateTime.parse(json['createdAt']),
      lastRunAt: json['lastRunAt'] != null
          ? DateTime.parse(json['lastRunAt'])
          : null,
      requiresConfirmation: json['requiresConfirmation'] ?? false,
      runInTerminal: json['runInTerminal'] ?? false,
      showOutput: json['showOutput'] ?? true,
      platformSupport: _platformSupportFromString(json['platformSupport']),
    );
  }

  static CustomCommandCategory _categoryFromString(String? category) {
    switch (category) {
      case 'branch':
        return CustomCommandCategory.branch;
      case 'repository':
        return CustomCommandCategory.repository;
      case 'ci':
        return CustomCommandCategory.ci;
      case 'utility':
        return CustomCommandCategory.utility;
      default:
        return CustomCommandCategory.general;
    }
  }

  static PlatformSupport _platformSupportFromString(String? platform) {
    switch (platform) {
      case 'mac':
        return PlatformSupport.mac;
      case 'windows':
        return PlatformSupport.windows;
      case 'linux':
        return PlatformSupport.linux;
      case 'desktopOnly':
        return PlatformSupport.desktopOnly;
      case 'mobileOnly':
        return PlatformSupport.mobileOnly;
      default:
        return PlatformSupport.all;
    }
  }

  @override
  List<Object?> get props => [
        id,
        name,
        command,
        description,
        parameters,
        category,
        icon.codePoint,
        iconColor.value,
        isShared,
        createdBy,
        createdAt,
        lastRunAt,
        requiresConfirmation,
        runInTerminal,
        showOutput,
        platformSupport,
      ];
}

/// Parameter for custom commands
class CustomCommandParameter extends Equatable {
  final String id;
  final String name;
  final String? description;
  final String? placeholder;
  final CustomCommandParameterType type;
  final String? defaultValue;
  final List<String>? options;
  final bool required;
  final int order;

  const CustomCommandParameter({
    required this.id,
    required this.name,
    this.description,
    this.placeholder,
    required this.type,
    this.defaultValue,
    this.options,
    this.required = false,
    this.order = 0,
  });

  /// Create a copy with updated fields
  CustomCommandParameter copyWith({
    String? id,
    String? name,
    String? description,
    String? placeholder,
    CustomCommandParameterType? type,
    String? defaultValue,
    List<String>? options,
    bool? required,
    int? order,
  }) {
    return CustomCommandParameter(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      placeholder: placeholder ?? this.placeholder,
      type: type ?? this.type,
      defaultValue: defaultValue ?? this.defaultValue,
      options: options ?? this.options,
      required: required ?? this.required,
      order: order ?? this.order,
    );
  }

  /// Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'placeholder': placeholder,
      'type': type.toString().split('.').last,
      'defaultValue': defaultValue,
      'options': options,
      'required': required,
      'order': order,
    };
  }

  /// Create from JSON for storage retrieval
  factory CustomCommandParameter.fromJson(Map<String, dynamic> json) {
    return CustomCommandParameter(
      id: json['id'],
      name: json['name'],
      description: json['description'],
      placeholder: json['placeholder'],
      type: _typeFromString(json['type']),
      defaultValue: json['defaultValue'],
      options: json['options'] != null
          ? List<String>.from(json['options'])
          : null,
      required: json['required'] ?? false,
      order: json['order'] ?? 0,
    );
  }

  static CustomCommandParameterType _typeFromString(String? type) {
    switch (type) {
      case 'text':
        return CustomCommandParameterType.text;
      case 'number':
        return CustomCommandParameterType.number;
      case 'boolean':
        return CustomCommandParameterType.boolean;
      case 'select':
        return CustomCommandParameterType.select;
      case 'branch':
        return CustomCommandParameterType.branch;
      case 'repository':
        return CustomCommandParameterType.repository;
      case 'file':
        return CustomCommandParameterType.file;
      case 'multilineText':
        return CustomCommandParameterType.multilineText;
      default:
        return CustomCommandParameterType.text;
    }
  }

  @override
  List<Object?> get props => [
        id,
        name,
        description,
        placeholder,
        type,
        defaultValue,
        options,
        required,
        order,
      ];
}

/// Categories for custom commands
enum CustomCommandCategory {
  general,
  branch,
  repository,
  ci,
  utility,
}

/// Parameter types for custom commands
enum CustomCommandParameterType {
  text,
  number,
  boolean,
  select,
  branch,
  repository,
  file,
  multilineText,
}

/// Platform support options
enum PlatformSupport {
  all,
  mac,
  windows,
  linux,
  desktopOnly,
  mobileOnly,
}