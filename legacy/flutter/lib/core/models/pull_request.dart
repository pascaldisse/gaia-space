import 'package:equatable/equatable.dart';

enum PullRequestStatus {
  open,
  merged,
  closed,
  draft
}

enum MergeStrategy {
  merge,
  squash,
  rebase
}

class PullRequest extends Equatable {
  final String id;
  final String title;
  final String description;
  final String sourceRepositoryId;
  final String sourceBranch;
  final String targetRepositoryId;
  final String targetBranch;
  final String authorId;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final DateTime? mergedAt;
  final DateTime? closedAt;
  final PullRequestStatus status;
  final MergeStrategy mergeStrategy;
  final List<String> reviewerIds;
  final List<String> assigneeIds;
  final List<String> labels;
  final int commitsCount;
  final int commentsCount;
  final bool mergeable;
  final bool hasConflicts;
  final String? mergedBy;
  final String? mergeCommitSha;

  const PullRequest({
    required this.id,
    required this.title,
    required this.description,
    required this.sourceRepositoryId,
    required this.sourceBranch,
    required this.targetRepositoryId,
    required this.targetBranch,
    required this.authorId,
    required this.createdAt,
    this.updatedAt,
    this.mergedAt,
    this.closedAt,
    this.status = PullRequestStatus.open,
    this.mergeStrategy = MergeStrategy.merge,
    this.reviewerIds = const [],
    this.assigneeIds = const [],
    this.labels = const [],
    this.commitsCount = 0,
    this.commentsCount = 0,
    this.mergeable = true,
    this.hasConflicts = false,
    this.mergedBy,
    this.mergeCommitSha,
  });

  /// Create a copy with updated fields
  PullRequest copyWith({
    String? id,
    String? title,
    String? description,
    String? sourceRepositoryId,
    String? sourceBranch,
    String? targetRepositoryId,
    String? targetBranch,
    String? authorId,
    DateTime? createdAt,
    DateTime? updatedAt,
    DateTime? mergedAt,
    DateTime? closedAt,
    PullRequestStatus? status,
    MergeStrategy? mergeStrategy,
    List<String>? reviewerIds,
    List<String>? assigneeIds,
    List<String>? labels,
    int? commitsCount,
    int? commentsCount,
    bool? mergeable,
    bool? hasConflicts,
    String? mergedBy,
    String? mergeCommitSha,
  }) {
    return PullRequest(
      id: id ?? this.id,
      title: title ?? this.title,
      description: description ?? this.description,
      sourceRepositoryId: sourceRepositoryId ?? this.sourceRepositoryId,
      sourceBranch: sourceBranch ?? this.sourceBranch,
      targetRepositoryId: targetRepositoryId ?? this.targetRepositoryId,
      targetBranch: targetBranch ?? this.targetBranch,
      authorId: authorId ?? this.authorId,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      mergedAt: mergedAt ?? this.mergedAt,
      closedAt: closedAt ?? this.closedAt,
      status: status ?? this.status,
      mergeStrategy: mergeStrategy ?? this.mergeStrategy,
      reviewerIds: reviewerIds ?? this.reviewerIds,
      assigneeIds: assigneeIds ?? this.assigneeIds,
      labels: labels ?? this.labels,
      commitsCount: commitsCount ?? this.commitsCount,
      commentsCount: commentsCount ?? this.commentsCount,
      mergeable: mergeable ?? this.mergeable,
      hasConflicts: hasConflicts ?? this.hasConflicts,
      mergedBy: mergedBy ?? this.mergedBy,
      mergeCommitSha: mergeCommitSha ?? this.mergeCommitSha,
    );
  }

  /// Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'title': title,
      'description': description,
      'sourceRepositoryId': sourceRepositoryId,
      'sourceBranch': sourceBranch,
      'targetRepositoryId': targetRepositoryId,
      'targetBranch': targetBranch,
      'authorId': authorId,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt?.toIso8601String(),
      'mergedAt': mergedAt?.toIso8601String(),
      'closedAt': closedAt?.toIso8601String(),
      'status': status.toString().split('.').last,
      'mergeStrategy': mergeStrategy.toString().split('.').last,
      'reviewerIds': reviewerIds,
      'assigneeIds': assigneeIds,
      'labels': labels,
      'commitsCount': commitsCount,
      'commentsCount': commentsCount,
      'mergeable': mergeable,
      'hasConflicts': hasConflicts,
      'mergedBy': mergedBy,
      'mergeCommitSha': mergeCommitSha,
    };
  }

  /// Create from JSON for storage retrieval
  factory PullRequest.fromJson(Map<String, dynamic> json) {
    return PullRequest(
      id: json['id'],
      title: json['title'],
      description: json['description'],
      sourceRepositoryId: json['sourceRepositoryId'],
      sourceBranch: json['sourceBranch'],
      targetRepositoryId: json['targetRepositoryId'],
      targetBranch: json['targetBranch'],
      authorId: json['authorId'],
      createdAt: DateTime.parse(json['createdAt']),
      updatedAt: json['updatedAt'] != null 
          ? DateTime.parse(json['updatedAt']) 
          : null,
      mergedAt: json['mergedAt'] != null 
          ? DateTime.parse(json['mergedAt']) 
          : null,
      closedAt: json['closedAt'] != null 
          ? DateTime.parse(json['closedAt']) 
          : null,
      status: PullRequestStatus.values.firstWhere(
        (e) => e.toString().split('.').last == json['status'],
        orElse: () => PullRequestStatus.open,
      ),
      mergeStrategy: MergeStrategy.values.firstWhere(
        (e) => e.toString().split('.').last == json['mergeStrategy'],
        orElse: () => MergeStrategy.merge,
      ),
      reviewerIds: List<String>.from(json['reviewerIds'] ?? []),
      assigneeIds: List<String>.from(json['assigneeIds'] ?? []),
      labels: List<String>.from(json['labels'] ?? []),
      commitsCount: json['commitsCount'] ?? 0,
      commentsCount: json['commentsCount'] ?? 0,
      mergeable: json['mergeable'] ?? true,
      hasConflicts: json['hasConflicts'] ?? false,
      mergedBy: json['mergedBy'],
      mergeCommitSha: json['mergeCommitSha'],
    );
  }

  @override
  List<Object?> get props => [
    id,
    title,
    description,
    sourceRepositoryId,
    sourceBranch,
    targetRepositoryId,
    targetBranch,
    authorId,
    createdAt,
    updatedAt,
    mergedAt,
    closedAt,
    status,
    mergeStrategy,
    reviewerIds,
    assigneeIds,
    labels,
    commitsCount,
    commentsCount,
    mergeable,
    hasConflicts,
    mergedBy,
    mergeCommitSha,
  ];
}

/// Represents a comment on a pull request
class PullRequestComment extends Equatable {
  final String id;
  final String pullRequestId;
  final String content;
  final String authorId;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final String? inReplyToId;
  final String? filePath;
  final int? lineNumber;
  final String? commitSha;

  const PullRequestComment({
    required this.id,
    required this.pullRequestId,
    required this.content,
    required this.authorId,
    required this.createdAt,
    this.updatedAt,
    this.inReplyToId,
    this.filePath,
    this.lineNumber,
    this.commitSha,
  });

  /// Create a copy with updated fields
  PullRequestComment copyWith({
    String? id,
    String? pullRequestId,
    String? content,
    String? authorId,
    DateTime? createdAt,
    DateTime? updatedAt,
    String? inReplyToId,
    String? filePath,
    int? lineNumber,
    String? commitSha,
  }) {
    return PullRequestComment(
      id: id ?? this.id,
      pullRequestId: pullRequestId ?? this.pullRequestId,
      content: content ?? this.content,
      authorId: authorId ?? this.authorId,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      inReplyToId: inReplyToId ?? this.inReplyToId,
      filePath: filePath ?? this.filePath,
      lineNumber: lineNumber ?? this.lineNumber,
      commitSha: commitSha ?? this.commitSha,
    );
  }

  /// Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'pullRequestId': pullRequestId,
      'content': content,
      'authorId': authorId,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt?.toIso8601String(),
      'inReplyToId': inReplyToId,
      'filePath': filePath,
      'lineNumber': lineNumber,
      'commitSha': commitSha,
    };
  }

  /// Create from JSON for storage retrieval
  factory PullRequestComment.fromJson(Map<String, dynamic> json) {
    return PullRequestComment(
      id: json['id'],
      pullRequestId: json['pullRequestId'],
      content: json['content'],
      authorId: json['authorId'],
      createdAt: DateTime.parse(json['createdAt']),
      updatedAt: json['updatedAt'] != null 
          ? DateTime.parse(json['updatedAt']) 
          : null,
      inReplyToId: json['inReplyToId'],
      filePath: json['filePath'],
      lineNumber: json['lineNumber'],
      commitSha: json['commitSha'],
    );
  }

  @override
  List<Object?> get props => [
    id,
    pullRequestId,
    content,
    authorId,
    createdAt,
    updatedAt,
    inReplyToId,
    filePath,
    lineNumber,
    commitSha,
  ];
}

/// Represents a review on a pull request
class PullRequestReview extends Equatable {
  final String id;
  final String pullRequestId;
  final String reviewerId;
  final String? comment;
  final String state; // 'approved', 'changes_requested', 'commented'
  final DateTime createdAt;
  final DateTime? updatedAt;
  final String? commitSha;

  const PullRequestReview({
    required this.id,
    required this.pullRequestId,
    required this.reviewerId,
    this.comment,
    required this.state,
    required this.createdAt,
    this.updatedAt,
    this.commitSha,
  });

  /// Create a copy with updated fields
  PullRequestReview copyWith({
    String? id,
    String? pullRequestId,
    String? reviewerId,
    String? comment,
    String? state,
    DateTime? createdAt,
    DateTime? updatedAt,
    String? commitSha,
  }) {
    return PullRequestReview(
      id: id ?? this.id,
      pullRequestId: pullRequestId ?? this.pullRequestId,
      reviewerId: reviewerId ?? this.reviewerId,
      comment: comment ?? this.comment,
      state: state ?? this.state,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      commitSha: commitSha ?? this.commitSha,
    );
  }

  /// Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'pullRequestId': pullRequestId,
      'reviewerId': reviewerId,
      'comment': comment,
      'state': state,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt?.toIso8601String(),
      'commitSha': commitSha,
    };
  }

  /// Create from JSON for storage retrieval
  factory PullRequestReview.fromJson(Map<String, dynamic> json) {
    return PullRequestReview(
      id: json['id'],
      pullRequestId: json['pullRequestId'],
      reviewerId: json['reviewerId'],
      comment: json['comment'],
      state: json['state'],
      createdAt: DateTime.parse(json['createdAt']),
      updatedAt: json['updatedAt'] != null 
          ? DateTime.parse(json['updatedAt']) 
          : null,
      commitSha: json['commitSha'],
    );
  }

  @override
  List<Object?> get props => [
    id,
    pullRequestId,
    reviewerId,
    comment,
    state,
    createdAt,
    updatedAt,
    commitSha,
  ];
}