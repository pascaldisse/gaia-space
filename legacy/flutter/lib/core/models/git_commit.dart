import 'package:equatable/equatable.dart';

class GitCommit extends Equatable {
  final String sha;
  final String message;
  final String author;
  final String email;
  final DateTime date;
  final List<String> parentShas;
  final Map<String, dynamic>? stats;
  final bool isStash;

  const GitCommit({
    required this.sha,
    required this.message,
    required this.author,
    required this.email,
    required this.date,
    required this.parentShas,
    this.stats,
    this.isStash = false,
  });

  GitCommit copyWith({
    String? sha,
    String? message,
    String? author,
    String? email,
    DateTime? date,
    List<String>? parentShas,
    Map<String, dynamic>? stats,
    bool? isStash,
  }) {
    return GitCommit(
      sha: sha ?? this.sha,
      message: message ?? this.message,
      author: author ?? this.author,
      email: email ?? this.email,
      date: date ?? this.date,
      parentShas: parentShas ?? this.parentShas,
      stats: stats ?? this.stats,
      isStash: isStash ?? this.isStash,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'sha': sha,
      'message': message,
      'author': author,
      'email': email,
      'date': date.toIso8601String(),
      'parentShas': parentShas,
      'stats': stats,
      'isStash': isStash,
    };
  }

  factory GitCommit.fromJson(Map<String, dynamic> json) {
    return GitCommit(
      sha: json['sha'],
      message: json['message'],
      author: json['author'],
      email: json['email'],
      date: DateTime.parse(json['date']),
      parentShas: List<String>.from(json['parentShas']),
      stats: json['stats'],
      isStash: json['isStash'] ?? false,
    );
  }

  bool get isMergeCommit => parentShas.length > 1;

  @override
  List<Object?> get props => [sha, message, author, email, date, parentShas, stats, isStash];
}