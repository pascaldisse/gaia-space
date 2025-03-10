import 'package:equatable/equatable.dart';

class Workspace extends Equatable {
  final String id;
  final String name;
  final String? description;
  final String createdBy;
  final DateTime createdAt;
  final int membersCount;
  final int channelsCount;
  final String? avatarUrl;

  const Workspace({
    required this.id,
    required this.name,
    this.description,
    required this.createdBy,
    required this.createdAt,
    required this.membersCount,
    required this.channelsCount,
    this.avatarUrl,
  });

  // Copy with method for immutability
  Workspace copyWith({
    String? id,
    String? name,
    String? description,
    String? createdBy,
    DateTime? createdAt,
    int? membersCount,
    int? channelsCount,
    String? avatarUrl,
  }) {
    return Workspace(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      membersCount: membersCount ?? this.membersCount,
      channelsCount: channelsCount ?? this.channelsCount,
      avatarUrl: avatarUrl ?? this.avatarUrl,
    );
  }

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'createdBy': createdBy,
      'createdAt': createdAt.toIso8601String(),
      'membersCount': membersCount,
      'channelsCount': channelsCount,
      'avatarUrl': avatarUrl,
    };
  }

  // Create from JSON for storage retrieval
  factory Workspace.fromJson(Map<String, dynamic> json) {
    return Workspace(
      id: json['id'],
      name: json['name'],
      description: json['description'],
      createdBy: json['createdBy'],
      createdAt: DateTime.parse(json['createdAt']),
      membersCount: json['membersCount'],
      channelsCount: json['channelsCount'],
      avatarUrl: json['avatarUrl'],
    );
  }

  @override
  List<Object?> get props => [
    id, 
    name, 
    description, 
    createdBy, 
    createdAt, 
    membersCount, 
    channelsCount, 
    avatarUrl
  ];
}