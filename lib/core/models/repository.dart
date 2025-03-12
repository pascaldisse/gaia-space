import 'package:equatable/equatable.dart';

class GitRepository extends Equatable {
  final String id;
  final String name;
  final String? description;
  final String? path;
  final String workspaceId;
  final String createdBy;
  final DateTime createdAt;
  final DateTime lastActivityAt;
  final int branchesCount;
  final int? commitsCount;
  final String? language;
  final String? avatarUrl;
  final bool isFork;
  final String? parentRepositoryUrl;

  const GitRepository({
    required this.id,
    required this.name,
    this.description,
    this.path,
    required this.workspaceId,
    required this.createdBy,
    required this.createdAt,
    required this.lastActivityAt,
    required this.branchesCount,
    this.commitsCount,
    this.language,
    this.avatarUrl,
    this.isFork = false,
    this.parentRepositoryUrl,
  });

  // Copy with method for immutability
  GitRepository copyWith({
    String? id,
    String? name,
    String? description,
    String? path,
    String? workspaceId,
    String? createdBy,
    DateTime? createdAt,
    DateTime? lastActivityAt,
    int? branchesCount,
    int? commitsCount,
    String? language,
    String? avatarUrl,
    bool? isFork,
    String? parentRepositoryUrl,
  }) {
    return GitRepository(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      path: path ?? this.path,
      workspaceId: workspaceId ?? this.workspaceId,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      lastActivityAt: lastActivityAt ?? this.lastActivityAt,
      branchesCount: branchesCount ?? this.branchesCount,
      commitsCount: commitsCount ?? this.commitsCount,
      language: language ?? this.language,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      isFork: isFork ?? this.isFork,
      parentRepositoryUrl: parentRepositoryUrl ?? this.parentRepositoryUrl,
    );
  }

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'path': path,
      'workspaceId': workspaceId,
      'createdBy': createdBy,
      'createdAt': createdAt.toIso8601String(),
      'lastActivityAt': lastActivityAt.toIso8601String(),
      'branchesCount': branchesCount,
      'commitsCount': commitsCount,
      'language': language,
      'avatarUrl': avatarUrl,
      'isFork': isFork,
      'parentRepositoryUrl': parentRepositoryUrl,
    };
  }

  // Create from JSON for storage retrieval
  factory GitRepository.fromJson(Map<String, dynamic> json) {
    return GitRepository(
      id: json['id'],
      name: json['name'],
      description: json['description'],
      path: json['path'],
      workspaceId: json['workspaceId'],
      createdBy: json['createdBy'],
      createdAt: DateTime.parse(json['createdAt']),
      lastActivityAt: DateTime.parse(json['lastActivityAt']),
      branchesCount: json['branchesCount'],
      commitsCount: json['commitsCount'],
      language: json['language'],
      avatarUrl: json['avatarUrl'],
      isFork: json['isFork'] ?? false,
      parentRepositoryUrl: json['parentRepositoryUrl'],
    );
  }

  @override
  List<Object?> get props => [
    id, 
    name, 
    description, 
    path,
    workspaceId, 
    createdBy, 
    createdAt, 
    lastActivityAt, 
    branchesCount,
    commitsCount,
    language,
    avatarUrl,
    isFork,
    parentRepositoryUrl,
  ];
}