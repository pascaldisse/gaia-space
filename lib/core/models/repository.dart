import 'package:equatable/equatable.dart';

class GitRepository extends Equatable {
  final String id;
  final String name;
  final String? description;
  final String workspaceId;
  final String createdBy;
  final DateTime createdAt;
  final DateTime lastActivityAt;
  final int branchesCount;
  final String? language;
  final String? avatarUrl;

  const GitRepository({
    required this.id,
    required this.name,
    this.description,
    required this.workspaceId,
    required this.createdBy,
    required this.createdAt,
    required this.lastActivityAt,
    required this.branchesCount,
    this.language,
    this.avatarUrl,
  });

  // Copy with method for immutability
  GitRepository copyWith({
    String? id,
    String? name,
    String? description,
    String? workspaceId,
    String? createdBy,
    DateTime? createdAt,
    DateTime? lastActivityAt,
    int? branchesCount,
    String? language,
    String? avatarUrl,
  }) {
    return GitRepository(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      workspaceId: workspaceId ?? this.workspaceId,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      lastActivityAt: lastActivityAt ?? this.lastActivityAt,
      branchesCount: branchesCount ?? this.branchesCount,
      language: language ?? this.language,
      avatarUrl: avatarUrl ?? this.avatarUrl,
    );
  }

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'workspaceId': workspaceId,
      'createdBy': createdBy,
      'createdAt': createdAt.toIso8601String(),
      'lastActivityAt': lastActivityAt.toIso8601String(),
      'branchesCount': branchesCount,
      'language': language,
      'avatarUrl': avatarUrl,
    };
  }

  // Create from JSON for storage retrieval
  factory GitRepository.fromJson(Map<String, dynamic> json) {
    return GitRepository(
      id: json['id'],
      name: json['name'],
      description: json['description'],
      workspaceId: json['workspaceId'],
      createdBy: json['createdBy'],
      createdAt: DateTime.parse(json['createdAt']),
      lastActivityAt: DateTime.parse(json['lastActivityAt']),
      branchesCount: json['branchesCount'],
      language: json['language'],
      avatarUrl: json['avatarUrl'],
    );
  }

  @override
  List<Object?> get props => [
    id, 
    name, 
    description, 
    workspaceId, 
    createdBy, 
    createdAt, 
    lastActivityAt, 
    branchesCount,
    language,
    avatarUrl,
  ];
}