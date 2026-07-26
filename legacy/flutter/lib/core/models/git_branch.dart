import 'package:equatable/equatable.dart';

class GitBranch extends Equatable {
  final String name;
  final String shortName;
  final String targetCommitSha;
  final bool isLocal;
  final bool isRemote;
  final bool isHead;
  final String? upstream;
  final int? ahead;
  final int? behind;

  const GitBranch({
    required this.name,
    required this.shortName,
    required this.targetCommitSha,
    required this.isLocal,
    this.isRemote = false,
    this.isHead = false,
    this.upstream,
    this.ahead,
    this.behind,
  });

  GitBranch copyWith({
    String? name,
    String? shortName,
    String? targetCommitSha,
    bool? isLocal,
    bool? isRemote,
    bool? isHead,
    String? upstream,
    int? ahead,
    int? behind,
  }) {
    return GitBranch(
      name: name ?? this.name,
      shortName: shortName ?? this.shortName,
      targetCommitSha: targetCommitSha ?? this.targetCommitSha,
      isLocal: isLocal ?? this.isLocal,
      isRemote: isRemote ?? this.isRemote,
      isHead: isHead ?? this.isHead,
      upstream: upstream ?? this.upstream,
      ahead: ahead ?? this.ahead,
      behind: behind ?? this.behind,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'shortName': shortName,
      'targetCommitSha': targetCommitSha,
      'isLocal': isLocal,
      'isRemote': isRemote,
      'isHead': isHead,
      'upstream': upstream,
      'ahead': ahead,
      'behind': behind,
    };
  }

  factory GitBranch.fromJson(Map<String, dynamic> json) {
    return GitBranch(
      name: json['name'],
      shortName: json['shortName'],
      targetCommitSha: json['targetCommitSha'],
      isLocal: json['isLocal'],
      isRemote: json['isRemote'] ?? false,
      isHead: json['isHead'] ?? false,
      upstream: json['upstream'],
      ahead: json['ahead'],
      behind: json['behind'],
    );
  }

  bool get isTrackingUpstream => upstream != null;
  bool get hasChanges => (ahead ?? 0) > 0 || (behind ?? 0) > 0;
  
  @override
  List<Object?> get props => [
    name, shortName, targetCommitSha, isLocal, isRemote, isHead, upstream, ahead, behind
  ];
}