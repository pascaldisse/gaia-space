import 'package:equatable/equatable.dart';

enum DocumentType {
  markdown,
  text,
  code,
}

class Document extends Equatable {
  final String id;
  final String title;
  final String content;
  final String? description;
  final String authorId;
  final String authorName;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DocumentType type;
  final List<String>? tags;
  final String? projectId;
  final String? workspaceId;

  const Document({
    required this.id,
    required this.title,
    required this.content,
    this.description,
    required this.authorId,
    required this.authorName,
    required this.createdAt,
    required this.updatedAt,
    required this.type,
    this.tags,
    this.projectId,
    this.workspaceId,
  });

  // Copy with method for immutability
  Document copyWith({
    String? id,
    String? title,
    String? content,
    String? description,
    String? authorId,
    String? authorName,
    DateTime? createdAt,
    DateTime? updatedAt,
    DocumentType? type,
    List<String>? tags,
    String? projectId,
    String? workspaceId,
  }) {
    return Document(
      id: id ?? this.id,
      title: title ?? this.title,
      content: content ?? this.content,
      description: description ?? this.description,
      authorId: authorId ?? this.authorId,
      authorName: authorName ?? this.authorName,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      type: type ?? this.type,
      tags: tags ?? this.tags,
      projectId: projectId ?? this.projectId,
      workspaceId: workspaceId ?? this.workspaceId,
    );
  }

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'content': content,
      'description': description,
      'authorId': authorId,
      'authorName': authorName,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
      'type': type.index,
      'tags': tags,
      'projectId': projectId,
      'workspaceId': workspaceId,
    };
  }

  // Create from JSON for storage retrieval
  factory Document.fromJson(Map<String, dynamic> json) {
    return Document(
      id: json['id'],
      title: json['title'],
      content: json['content'],
      description: json['description'],
      authorId: json['authorId'],
      authorName: json['authorName'],
      createdAt: DateTime.parse(json['createdAt']),
      updatedAt: DateTime.parse(json['updatedAt']),
      type: DocumentType.values[json['type']],
      tags: json['tags'] != null ? List<String>.from(json['tags']) : null,
      projectId: json['projectId'],
      workspaceId: json['workspaceId'],
    );
  }

  @override
  List<Object?> get props => [
        id,
        title,
        content,
        description,
        authorId,
        authorName,
        createdAt,
        updatedAt,
        type,
        tags,
        projectId,
        workspaceId,
      ];
}