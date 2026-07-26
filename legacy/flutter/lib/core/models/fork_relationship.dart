import 'package:equatable/equatable.dart';

/// Represents the relationship between a forked repository and its upstream.
class ForkRelationship extends Equatable {
  final String id;
  final String forkRepositoryId;
  final String upstreamRepositoryId;
  final String? upstreamUrl;
  final DateTime createdAt;
  final DateTime? lastSyncedAt;
  final int aheadCount;
  final int behindCount;
  final bool syncing;
  final bool hasActiveSync;
  final String? remoteName;

  const ForkRelationship({
    required this.id,
    required this.forkRepositoryId,
    required this.upstreamRepositoryId,
    this.upstreamUrl,
    required this.createdAt,
    this.lastSyncedAt,
    this.aheadCount = 0,
    this.behindCount = 0,
    this.syncing = false,
    this.hasActiveSync = false,
    this.remoteName = 'upstream',
  });

  /// Create a copy with updated fields
  ForkRelationship copyWith({
    String? id,
    String? forkRepositoryId,
    String? upstreamRepositoryId,
    String? upstreamUrl,
    DateTime? createdAt,
    DateTime? lastSyncedAt,
    int? aheadCount,
    int? behindCount,
    bool? syncing,
    bool? hasActiveSync,
    String? remoteName,
  }) {
    return ForkRelationship(
      id: id ?? this.id,
      forkRepositoryId: forkRepositoryId ?? this.forkRepositoryId,
      upstreamRepositoryId: upstreamRepositoryId ?? this.upstreamRepositoryId,
      upstreamUrl: upstreamUrl ?? this.upstreamUrl,
      createdAt: createdAt ?? this.createdAt,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      aheadCount: aheadCount ?? this.aheadCount,
      behindCount: behindCount ?? this.behindCount,
      syncing: syncing ?? this.syncing,
      hasActiveSync: hasActiveSync ?? this.hasActiveSync,
      remoteName: remoteName ?? this.remoteName,
    );
  }

  /// Convert to JSON for storage
  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'forkRepositoryId': forkRepositoryId,
      'upstreamRepositoryId': upstreamRepositoryId,
      'upstreamUrl': upstreamUrl,
      'createdAt': createdAt.toIso8601String(),
      'lastSyncedAt': lastSyncedAt?.toIso8601String(),
      'aheadCount': aheadCount,
      'behindCount': behindCount,
      'syncing': syncing,
      'hasActiveSync': hasActiveSync,
      'remoteName': remoteName,
    };
  }

  /// Create from JSON for storage retrieval
  factory ForkRelationship.fromJson(Map<String, dynamic> json) {
    return ForkRelationship(
      id: json['id'],
      forkRepositoryId: json['forkRepositoryId'],
      upstreamRepositoryId: json['upstreamRepositoryId'],
      upstreamUrl: json['upstreamUrl'],
      createdAt: DateTime.parse(json['createdAt']),
      lastSyncedAt: json['lastSyncedAt'] != null 
          ? DateTime.parse(json['lastSyncedAt']) 
          : null,
      aheadCount: json['aheadCount'] ?? 0,
      behindCount: json['behindCount'] ?? 0,
      syncing: json['syncing'] ?? false,
      hasActiveSync: json['hasActiveSync'] ?? false,
      remoteName: json['remoteName'] ?? 'upstream',
    );
  }

  @override
  List<Object?> get props => [
    id,
    forkRepositoryId,
    upstreamRepositoryId,
    upstreamUrl,
    createdAt,
    lastSyncedAt,
    aheadCount,
    behindCount,
    syncing,
    hasActiveSync,
    remoteName,
  ];
}