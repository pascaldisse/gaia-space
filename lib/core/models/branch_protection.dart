import 'package:equatable/equatable.dart';

/// Represents a branch protection rule
class BranchProtectionRule extends Equatable {
  final String id;
  final String repositoryId;
  final String pattern; // Branch pattern to protect (e.g., "main", "release/*")
  final bool requirePullRequest;
  final int requiredApprovalsCount;
  final bool dismissStaleReviews;
  final bool requireCodeOwnerReviews;
  final bool restrictPushes;
  final List<String> allowedPusherIds;
  final bool requireStatusChecks;
  final List<String> requiredStatusChecks;
  final bool requireLinearHistory;
  final bool allowForcePushes;
  final bool allowDeletions;
  final bool enforceAdmins;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final String createdBy;

  const BranchProtectionRule({
    required this.id,
    required this.repositoryId,
    required this.pattern,
    this.requirePullRequest = true,
    this.requiredApprovalsCount = 1,
    this.dismissStaleReviews = false,
    this.requireCodeOwnerReviews = false,
    this.restrictPushes = false,
    this.allowedPusherIds = const [],
    this.requireStatusChecks = false,
    this.requiredStatusChecks = const [],
    this.requireLinearHistory = false,
    this.allowForcePushes = false,
    this.allowDeletions = false,
    this.enforceAdmins = true,
    required this.createdAt,
    this.updatedAt,
    required this.createdBy,
  });

  /// Create a copy with updated fields
  BranchProtectionRule copyWith({
    String? id,
    String? repositoryId,
    String? pattern,
    bool? requirePullRequest,
    int? requiredApprovalsCount,
    bool? dismissStaleReviews,
    bool? requireCodeOwnerReviews,
    bool? restrictPushes,
    List<String>? allowedPusherIds,
    bool? requireStatusChecks,
    List<String>? requiredStatusChecks,
    bool? requireLinearHistory,
    bool? allowForcePushes,
    bool? allowDeletions,
    bool? enforceAdmins,
    DateTime? createdAt,
    DateTime? updatedAt,
    String? createdBy,
  }) {
    return BranchProtectionRule(
      id: id ?? this.id,
      repositoryId: repositoryId ?? this.repositoryId,
      pattern: pattern ?? this.pattern,
      requirePullRequest: requirePullRequest ?? this.requirePullRequest,
      requiredApprovalsCount: requiredApprovalsCount ?? this.requiredApprovalsCount,
      dismissStaleReviews: dismissStaleReviews ?? this.dismissStaleReviews,
      requireCodeOwnerReviews: requireCodeOwnerReviews ?? this.requireCodeOwnerReviews,
      restrictPushes: restrictPushes ?? this.restrictPushes,
      allowedPusherIds: allowedPusherIds ?? this.allowedPusherIds,
      requireStatusChecks: requireStatusChecks ?? this.requireStatusChecks,
      requiredStatusChecks: requiredStatusChecks ?? this.requiredStatusChecks,
      requireLinearHistory: requireLinearHistory ?? this.requireLinearHistory,
      allowForcePushes: allowForcePushes ?? this.allowForcePushes,
      allowDeletions: allowDeletions ?? this.allowDeletions,
      enforceAdmins: enforceAdmins ?? this.enforceAdmins,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      createdBy: createdBy ?? this.createdBy,
    );
  }

  /// Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'repositoryId': repositoryId,
      'pattern': pattern,
      'requirePullRequest': requirePullRequest,
      'requiredApprovalsCount': requiredApprovalsCount,
      'dismissStaleReviews': dismissStaleReviews,
      'requireCodeOwnerReviews': requireCodeOwnerReviews,
      'restrictPushes': restrictPushes,
      'allowedPusherIds': allowedPusherIds,
      'requireStatusChecks': requireStatusChecks,
      'requiredStatusChecks': requiredStatusChecks,
      'requireLinearHistory': requireLinearHistory,
      'allowForcePushes': allowForcePushes,
      'allowDeletions': allowDeletions,
      'enforceAdmins': enforceAdmins,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt?.toIso8601String(),
      'createdBy': createdBy,
    };
  }

  /// Create from JSON for storage retrieval
  factory BranchProtectionRule.fromJson(Map<String, dynamic> json) {
    return BranchProtectionRule(
      id: json['id'],
      repositoryId: json['repositoryId'],
      pattern: json['pattern'],
      requirePullRequest: json['requirePullRequest'] ?? true,
      requiredApprovalsCount: json['requiredApprovalsCount'] ?? 1,
      dismissStaleReviews: json['dismissStaleReviews'] ?? false,
      requireCodeOwnerReviews: json['requireCodeOwnerReviews'] ?? false,
      restrictPushes: json['restrictPushes'] ?? false,
      allowedPusherIds: List<String>.from(json['allowedPusherIds'] ?? []),
      requireStatusChecks: json['requireStatusChecks'] ?? false,
      requiredStatusChecks: List<String>.from(json['requiredStatusChecks'] ?? []),
      requireLinearHistory: json['requireLinearHistory'] ?? false,
      allowForcePushes: json['allowForcePushes'] ?? false,
      allowDeletions: json['allowDeletions'] ?? false,
      enforceAdmins: json['enforceAdmins'] ?? true,
      createdAt: DateTime.parse(json['createdAt']),
      updatedAt: json['updatedAt'] != null 
          ? DateTime.parse(json['updatedAt']) 
          : null,
      createdBy: json['createdBy'],
    );
  }

  @override
  List<Object?> get props => [
    id,
    repositoryId,
    pattern,
    requirePullRequest,
    requiredApprovalsCount,
    dismissStaleReviews,
    requireCodeOwnerReviews,
    restrictPushes,
    allowedPusherIds,
    requireStatusChecks,
    requiredStatusChecks,
    requireLinearHistory,
    allowForcePushes,
    allowDeletions,
    enforceAdmins,
    createdAt,
    updatedAt,
    createdBy,
  ];
}

/// Represents a code owner configuration
class CodeOwnerConfiguration extends Equatable {
  final String id;
  final String repositoryId;
  final String path; // Path pattern (e.g., "src/**/*.java")
  final List<String> ownerIds;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final String createdBy;

  const CodeOwnerConfiguration({
    required this.id,
    required this.repositoryId,
    required this.path,
    required this.ownerIds,
    required this.createdAt,
    this.updatedAt,
    required this.createdBy,
  });

  /// Create a copy with updated fields
  CodeOwnerConfiguration copyWith({
    String? id,
    String? repositoryId,
    String? path,
    List<String>? ownerIds,
    DateTime? createdAt,
    DateTime? updatedAt,
    String? createdBy,
  }) {
    return CodeOwnerConfiguration(
      id: id ?? this.id,
      repositoryId: repositoryId ?? this.repositoryId,
      path: path ?? this.path,
      ownerIds: ownerIds ?? this.ownerIds,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      createdBy: createdBy ?? this.createdBy,
    );
  }

  /// Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'repositoryId': repositoryId,
      'path': path,
      'ownerIds': ownerIds,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt?.toIso8601String(),
      'createdBy': createdBy,
    };
  }

  /// Create from JSON for storage retrieval
  factory CodeOwnerConfiguration.fromJson(Map<String, dynamic> json) {
    return CodeOwnerConfiguration(
      id: json['id'],
      repositoryId: json['repositoryId'],
      path: json['path'],
      ownerIds: List<String>.from(json['ownerIds'] ?? []),
      createdAt: DateTime.parse(json['createdAt']),
      updatedAt: json['updatedAt'] != null 
          ? DateTime.parse(json['updatedAt']) 
          : null,
      createdBy: json['createdBy'],
    );
  }

  @override
  List<Object?> get props => [
    id,
    repositoryId,
    path,
    ownerIds,
    createdAt,
    updatedAt,
    createdBy,
  ];
}