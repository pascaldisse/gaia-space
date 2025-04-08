import 'package:equatable/equatable.dart';

enum ProjectStatus {
  todo,
  inProgress,
  completed,
}

class ProjectRole {
  final String id;
  final String userId;
  final String userName;
  final String role;
  final String? avatarUrl;

  ProjectRole({
    required this.id,
    required this.userId,
    required this.userName,
    required this.role,
    this.avatarUrl,
  });

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'userId': userId,
      'userName': userName,
      'role': role,
      'avatarUrl': avatarUrl,
    };
  }

  // Create from JSON for storage retrieval
  factory ProjectRole.fromJson(Map<String, dynamic> json) {
    return ProjectRole(
      id: json['id'],
      userId: json['userId'],
      userName: json['userName'],
      role: json['role'],
      avatarUrl: json['avatarUrl'],
    );
  }
}

class SubTask extends Equatable {
  final String id;
  final String title;
  final bool isCompleted;
  final String? assignedTo;
  final DateTime? dueDate;

  const SubTask({
    required this.id,
    required this.title,
    this.isCompleted = false,
    this.assignedTo,
    this.dueDate,
  });

  SubTask copyWith({
    String? id,
    String? title,
    bool? isCompleted,
    String? assignedTo,
    DateTime? dueDate,
  }) {
    return SubTask(
      id: id ?? this.id,
      title: title ?? this.title,
      isCompleted: isCompleted ?? this.isCompleted,
      assignedTo: assignedTo ?? this.assignedTo,
      dueDate: dueDate ?? this.dueDate,
    );
  }

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'isCompleted': isCompleted,
      'assignedTo': assignedTo,
      'dueDate': dueDate?.toIso8601String(),
    };
  }

  // Create from JSON for storage retrieval
  factory SubTask.fromJson(Map<String, dynamic> json) {
    return SubTask(
      id: json['id'],
      title: json['title'],
      isCompleted: json['isCompleted'] ?? false,
      assignedTo: json['assignedTo'],
      dueDate: json['dueDate'] != null ? DateTime.parse(json['dueDate']) : null,
    );
  }

  @override
  List<Object?> get props => [id, title, isCompleted, assignedTo, dueDate];
}

class GitReference {
  final String id;
  final String url;
  final String title;
  final String? commitId;
  final String? branch;
  final String? pullRequest;

  GitReference({
    required this.id,
    required this.url,
    required this.title,
    this.commitId,
    this.branch,
    this.pullRequest,
  });

  // Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'url': url,
      'title': title,
      'commitId': commitId,
      'branch': branch,
      'pullRequest': pullRequest,
    };
  }

  // Create from JSON for storage retrieval
  factory GitReference.fromJson(Map<String, dynamic> json) {
    return GitReference(
      id: json['id'],
      url: json['url'],
      title: json['title'],
      commitId: json['commitId'],
      branch: json['branch'],
      pullRequest: json['pullRequest'],
    );
  }
}

class Project extends Equatable {
  final String id;
  final String name;
  final String? description;
  final String workspaceId;
  final String createdBy;
  final DateTime createdAt;
  final DateTime dueDate;
  final ProjectStatus status;
  final String? avatarUrl;
  final List<ProjectRole> assignees;
  final List<SubTask> subTasks;
  final List<GitReference> gitReferences;
  final String? notes;
  final double? completionPercentage;
  final String? priority;
  final int? order;

  const Project({
    required this.id,
    required this.name,
    this.description,
    required this.workspaceId,
    required this.createdBy,
    required this.createdAt,
    required this.dueDate,
    required this.status,
    this.avatarUrl,
    this.assignees = const [],
    this.subTasks = const [],
    this.gitReferences = const [],
    this.notes,
    this.completionPercentage,
    this.priority,
    this.order,
  });

  // Copy with method for immutability
  Project copyWith({
    String? id,
    String? name,
    String? description,
    String? workspaceId,
    String? createdBy,
    DateTime? createdAt,
    DateTime? dueDate,
    ProjectStatus? status,
    String? avatarUrl,
    List<ProjectRole>? assignees,
    List<SubTask>? subTasks,
    List<GitReference>? gitReferences,
    String? notes,
    double? completionPercentage,
    String? priority,
    int? order,
  }) {
    return Project(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      workspaceId: workspaceId ?? this.workspaceId,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      dueDate: dueDate ?? this.dueDate,
      status: status ?? this.status,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      assignees: assignees ?? this.assignees,
      subTasks: subTasks ?? this.subTasks,
      gitReferences: gitReferences ?? this.gitReferences,
      notes: notes ?? this.notes,
      completionPercentage: completionPercentage ?? this.completionPercentage,
      priority: priority ?? this.priority,
      order: order ?? this.order,
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
      'dueDate': dueDate.toIso8601String(),
      'status': status.index,
      'avatarUrl': avatarUrl,
      'assignees': assignees.map((assignee) => assignee.toJson()).toList(),
      'subTasks': subTasks.map((task) => task.toJson()).toList(),
      'gitReferences': gitReferences.map((ref) => ref.toJson()).toList(),
      'notes': notes,
      'completionPercentage': completionPercentage,
      'priority': priority,
      'order': order,
    };
  }

  // Create from JSON for storage retrieval
  factory Project.fromJson(Map<String, dynamic> json) {
    return Project(
      id: json['id'],
      name: json['name'],
      description: json['description'],
      workspaceId: json['workspaceId'],
      createdBy: json['createdBy'],
      createdAt: DateTime.parse(json['createdAt']),
      dueDate: DateTime.parse(json['dueDate']),
      status: ProjectStatus.values[json['status']],
      avatarUrl: json['avatarUrl'],
      assignees: (json['assignees'] as List?)
          ?.map((assignee) => ProjectRole.fromJson(assignee))
          .toList() ??
          [],
      subTasks: (json['subTasks'] as List?)
          ?.map((task) => SubTask.fromJson(task))
          .toList() ??
          [],
      gitReferences: (json['gitReferences'] as List?)
          ?.map((ref) => GitReference.fromJson(ref))
          .toList() ??
          [],
      notes: json['notes'],
      completionPercentage: json['completionPercentage'],
      priority: json['priority'],
      order: json['order'],
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
    dueDate, 
    status, 
    avatarUrl,
    assignees,
    subTasks,
    gitReferences,
    notes,
    completionPercentage,
    priority,
    order,
  ];
}