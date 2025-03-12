import 'package:equatable/equatable.dart';

enum GitFileStatus { 
  unmodified, 
  modified, 
  added, 
  deleted, 
  renamed, 
  copied, 
  untracked, 
  ignored, 
  conflicted 
}

class GitFile extends Equatable {
  final String path;
  final GitFileStatus status;
  final bool isStaged;
  final String? oldPath; // For renamed files
  final bool isDirectory;
  
  const GitFile({
    required this.path,
    required this.status,
    required this.isStaged,
    this.oldPath,
    this.isDirectory = false,
  });

  GitFile copyWith({
    String? path,
    GitFileStatus? status,
    bool? isStaged,
    String? oldPath,
    bool? isDirectory,
  }) {
    return GitFile(
      path: path ?? this.path,
      status: status ?? this.status,
      isStaged: isStaged ?? this.isStaged,
      oldPath: oldPath ?? this.oldPath,
      isDirectory: isDirectory ?? this.isDirectory,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'path': path,
      'status': status.toString().split('.').last,
      'isStaged': isStaged,
      'oldPath': oldPath,
      'isDirectory': isDirectory,
    };
  }

  factory GitFile.fromJson(Map<String, dynamic> json) {
    return GitFile(
      path: json['path'],
      status: GitFileStatus.values.firstWhere(
        (e) => e.toString().split('.').last == json['status'],
        orElse: () => GitFileStatus.unmodified,
      ),
      isStaged: json['isStaged'],
      oldPath: json['oldPath'],
      isDirectory: json['isDirectory'] ?? false,
    );
  }

  // Get only the filename without the directory path
  String get fileName {
    final lastSeparator = path.lastIndexOf('/');
    return lastSeparator != -1 ? path.substring(lastSeparator + 1) : path;
  }
  
  // Get directory path without the filename
  String get directory {
    final lastSeparator = path.lastIndexOf('/');
    return lastSeparator != -1 ? path.substring(0, lastSeparator) : '';
  }
  
  // Get the parent directory of this file's path
  String get parentDirectory {
    final dirPath = directory;
    if (dirPath.isEmpty) return '';
    
    final lastSeparator = dirPath.lastIndexOf('/');
    return lastSeparator != -1 ? dirPath.substring(0, lastSeparator) : '';
  }
  
  // Check if this file is inside the specified directory
  bool isInDirectory(String dirPath) {
    if (path == dirPath) return false; // It's the directory itself
    
    // For directory path "/foo/bar", a file "/foo/bar/baz.txt" is inside it
    // Also handle the root directory case
    if (dirPath.isEmpty || dirPath == '/') {
      return !path.contains('/') || path.indexOf('/') == path.length - 1;
    }
    
    return path.startsWith('$dirPath/');
  }
  
  // Get the immediate child path segment of this file relative to dirPath
  String getChildPath(String dirPath) {
    if (!isInDirectory(dirPath)) return path;
    
    if (dirPath.isEmpty || dirPath == '/') {
      // Handle root directory case
      final firstSeparator = path.indexOf('/');
      if (firstSeparator == -1) return path;
      return path.substring(0, firstSeparator);
    }
    
    final relativePath = path.substring(dirPath.length + 1); // +1 for the trailing slash
    final firstSeparator = relativePath.indexOf('/');
    if (firstSeparator == -1) return relativePath;
    return relativePath.substring(0, firstSeparator);
  }
  
  // Helper methods to categorize file
  bool get isModified => status == GitFileStatus.modified;
  bool get isAdded => status == GitFileStatus.added;
  bool get isDeleted => status == GitFileStatus.deleted;
  bool get isRenamed => status == GitFileStatus.renamed;
  bool get isUntracked => status == GitFileStatus.untracked;
  bool get isConflicted => status == GitFileStatus.conflicted;
  
  @override
  List<Object?> get props => [path, status, isStaged, oldPath, isDirectory];
}