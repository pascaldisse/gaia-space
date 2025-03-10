import 'package:equatable/equatable.dart';

class DiscordIntegration extends Equatable {
  final String id;
  final String workspaceId;
  final String guildId;
  final String guildName;
  final String? guildIconUrl;
  final List<DiscordChannel> channels;
  final String createdBy;
  final DateTime createdAt;
  final DateTime lastSyncAt;

  const DiscordIntegration({
    required this.id,
    required this.workspaceId,
    required this.guildId,
    required this.guildName,
    this.guildIconUrl,
    required this.channels,
    required this.createdBy,
    required this.createdAt,
    required this.lastSyncAt,
  });

  // Copy with method for immutability
  DiscordIntegration copyWith({
    String? id,
    String? workspaceId,
    String? guildId,
    String? guildName,
    String? guildIconUrl,
    List<DiscordChannel>? channels,
    String? createdBy,
    DateTime? createdAt,
    DateTime? lastSyncAt,
  }) {
    return DiscordIntegration(
      id: id ?? this.id,
      workspaceId: workspaceId ?? this.workspaceId,
      guildId: guildId ?? this.guildId,
      guildName: guildName ?? this.guildName,
      guildIconUrl: guildIconUrl ?? this.guildIconUrl,
      channels: channels ?? this.channels,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      lastSyncAt: lastSyncAt ?? this.lastSyncAt,
    );
  }

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'workspaceId': workspaceId,
      'guildId': guildId,
      'guildName': guildName,
      'guildIconUrl': guildIconUrl,
      'channels': channels.map((channel) => channel.toJson()).toList(),
      'createdBy': createdBy,
      'createdAt': createdAt.toIso8601String(),
      'lastSyncAt': lastSyncAt.toIso8601String(),
    };
  }

  // Create from JSON for storage retrieval
  factory DiscordIntegration.fromJson(Map<String, dynamic> json) {
    return DiscordIntegration(
      id: json['id'],
      workspaceId: json['workspaceId'],
      guildId: json['guildId'],
      guildName: json['guildName'],
      guildIconUrl: json['guildIconUrl'],
      channels: (json['channels'] as List)
          .map((channelJson) => DiscordChannel.fromJson(channelJson))
          .toList(),
      createdBy: json['createdBy'],
      createdAt: DateTime.parse(json['createdAt']),
      lastSyncAt: DateTime.parse(json['lastSyncAt']),
    );
  }

  @override
  List<Object?> get props => [
        id,
        workspaceId,
        guildId,
        guildName,
        guildIconUrl,
        channels,
        createdBy,
        createdAt,
        lastSyncAt,
      ];
}

class DiscordChannel extends Equatable {
  final String id;
  final String name;
  final String type; // 'text', 'voice', 'category'
  final bool isSelected;
  final int messageCount;
  final DateTime? lastMessageAt;

  const DiscordChannel({
    required this.id,
    required this.name,
    required this.type,
    this.isSelected = false,
    this.messageCount = 0,
    this.lastMessageAt,
  });

  // Copy with method for immutability
  DiscordChannel copyWith({
    String? id,
    String? name,
    String? type,
    bool? isSelected,
    int? messageCount,
    DateTime? lastMessageAt,
  }) {
    return DiscordChannel(
      id: id ?? this.id,
      name: name ?? this.name,
      type: type ?? this.type,
      isSelected: isSelected ?? this.isSelected,
      messageCount: messageCount ?? this.messageCount,
      lastMessageAt: lastMessageAt ?? this.lastMessageAt,
    );
  }

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'type': type,
      'isSelected': isSelected,
      'messageCount': messageCount,
      'lastMessageAt': lastMessageAt?.toIso8601String(),
    };
  }

  // Create from JSON for storage retrieval
  factory DiscordChannel.fromJson(Map<String, dynamic> json) {
    return DiscordChannel(
      id: json['id'],
      name: json['name'],
      type: json['type'],
      isSelected: json['isSelected'] ?? false,
      messageCount: json['messageCount'] ?? 0,
      lastMessageAt: json['lastMessageAt'] != null
          ? DateTime.parse(json['lastMessageAt'])
          : null,
    );
  }

  @override
  List<Object?> get props => [
        id,
        name,
        type,
        isSelected,
        messageCount,
        lastMessageAt,
      ];
}