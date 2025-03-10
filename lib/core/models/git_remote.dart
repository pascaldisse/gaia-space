import 'package:equatable/equatable.dart';

class GitRemote extends Equatable {
  final String name;
  final String url;
  final String? pushUrl;
  
  const GitRemote({
    required this.name,
    required this.url,
    this.pushUrl,
  });

  GitRemote copyWith({
    String? name,
    String? url,
    String? pushUrl,
  }) {
    return GitRemote(
      name: name ?? this.name,
      url: url ?? this.url,
      pushUrl: pushUrl ?? this.pushUrl,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'url': url,
      'pushUrl': pushUrl,
    };
  }

  factory GitRemote.fromJson(Map<String, dynamic> json) {
    return GitRemote(
      name: json['name'],
      url: json['url'],
      pushUrl: json['pushUrl'],
    );
  }
  
  // Helper method to determine remote type
  bool get isGitHub => url.contains('github.com');
  bool get isGitLab => url.contains('gitlab.com');
  bool get isBitbucket => url.contains('bitbucket.org');
  
  @override
  List<Object?> get props => [name, url, pushUrl];
}