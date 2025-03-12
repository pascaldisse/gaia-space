import 'package:equatable/equatable.dart';

class GitDiffHunk extends Equatable {
  final int oldStart;
  final int oldLines;
  final int newStart;
  final int newLines;
  final String header;
  final List<GitDiffLine> lines;

  const GitDiffHunk({
    required this.oldStart,
    required this.oldLines,
    required this.newStart,
    required this.newLines,
    required this.header,
    required this.lines,
  });

  GitDiffHunk copyWith({
    int? oldStart,
    int? oldLines,
    int? newStart,
    int? newLines,
    String? header,
    List<GitDiffLine>? lines,
  }) {
    return GitDiffHunk(
      oldStart: oldStart ?? this.oldStart,
      oldLines: oldLines ?? this.oldLines,
      newStart: newStart ?? this.newStart,
      newLines: newLines ?? this.newLines,
      header: header ?? this.header,
      lines: lines ?? this.lines,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'oldStart': oldStart,
      'oldLines': oldLines,
      'newStart': newStart,
      'newLines': newLines,
      'header': header,
      'lines': lines.map((line) => line.toJson()).toList(),
    };
  }

  factory GitDiffHunk.fromJson(Map<String, dynamic> json) {
    return GitDiffHunk(
      oldStart: json['oldStart'],
      oldLines: json['oldLines'],
      newStart: json['newStart'],
      newLines: json['newLines'],
      header: json['header'],
      lines: (json['lines'] as List)
          .map((line) => GitDiffLine.fromJson(line))
          .toList(),
    );
  }

  @override
  List<Object?> get props => [oldStart, oldLines, newStart, newLines, header, lines];
}

enum GitDiffLineType { context, addition, deletion, emptyNewline }

class GitDiffLine extends Equatable {
  final GitDiffLineType type;
  final String content;
  final int oldLineNum;
  final int newLineNum;

  const GitDiffLine({
    required this.type,
    required this.content,
    required this.oldLineNum,
    required this.newLineNum,
  });

  GitDiffLine copyWith({
    GitDiffLineType? type,
    String? content,
    int? oldLineNum,
    int? newLineNum,
  }) {
    return GitDiffLine(
      type: type ?? this.type,
      content: content ?? this.content,
      oldLineNum: oldLineNum ?? this.oldLineNum,
      newLineNum: newLineNum ?? this.newLineNum,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'type': type.toString().split('.').last,
      'content': content,
      'oldLineNum': oldLineNum,
      'newLineNum': newLineNum,
    };
  }

  factory GitDiffLine.fromJson(Map<String, dynamic> json) {
    return GitDiffLine(
      type: GitDiffLineType.values.firstWhere(
        (e) => e.toString().split('.').last == json['type'],
        orElse: () => GitDiffLineType.context,
      ),
      content: json['content'],
      oldLineNum: json['oldLineNum'],
      newLineNum: json['newLineNum'],
    );
  }

  bool get isAddition => type == GitDiffLineType.addition;
  bool get isDeletion => type == GitDiffLineType.deletion;
  bool get isContext => type == GitDiffLineType.context;
  
  @override
  List<Object?> get props => [type, content, oldLineNum, newLineNum];
}

class GitDiff extends Equatable {
  final String oldFile;
  final String newFile;
  final List<GitDiffHunk> hunks;
  final bool isBinary;
  final String status; // Added for pull request screen
  final String file; // Added for pull request screen
  
  const GitDiff({
    required this.oldFile,
    required this.newFile,
    required this.hunks,
    this.isBinary = false,
    this.status = 'modified',
    String? file,
  }) : file = file ?? newFile;

  GitDiff copyWith({
    String? oldFile,
    String? newFile,
    List<GitDiffHunk>? hunks,
    bool? isBinary,
    String? status,
    String? file,
  }) {
    return GitDiff(
      oldFile: oldFile ?? this.oldFile,
      newFile: newFile ?? this.newFile,
      hunks: hunks ?? this.hunks,
      isBinary: isBinary ?? this.isBinary,
      status: status ?? this.status,
      file: file ?? this.file,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'oldFile': oldFile,
      'newFile': newFile,
      'hunks': hunks.map((hunk) => hunk.toJson()).toList(),
      'isBinary': isBinary,
      'status': status,
      'file': file,
    };
  }

  factory GitDiff.fromJson(Map<String, dynamic> json) {
    return GitDiff(
      oldFile: json['oldFile'],
      newFile: json['newFile'],
      hunks: (json['hunks'] as List)
          .map((hunk) => GitDiffHunk.fromJson(hunk))
          .toList(),
      isBinary: json['isBinary'] ?? false,
      status: json['status'] ?? 'modified',
      file: json['file'],
    );
  }

  // Helper methods to determine diff stats
  int get additionCount => hunks
      .expand((hunk) => hunk.lines)
      .where((line) => line.isAddition)
      .length;

  int get deletionCount => hunks
      .expand((hunk) => hunk.lines)
      .where((line) => line.isDeletion)
      .length;
  
  // Aliases for pull request screen
  int get additions => additionCount;
  int get deletions => deletionCount;
      
  @override
  List<Object?> get props => [oldFile, newFile, hunks, isBinary, status, file];
}