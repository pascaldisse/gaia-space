import 'dart:io';
import 'dart:convert';
import 'package:git/git.dart';
import 'package:path/path.dart' as path;
import 'package:gaia_space/core/models/git_branch.dart';
import 'package:gaia_space/core/models/git_commit.dart';
import 'package:gaia_space/core/models/git_diff.dart';
import 'package:gaia_space/core/models/git_file.dart';
import 'package:gaia_space/core/models/git_remote.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/utils/app_logger.dart';

class GitService {
  static final GitService _instance = GitService._internal();
  factory GitService() => _instance;
  
  static final _logger = AppLogger();
  final Map<String, GitDir> _repoDirCache = {};
  
  GitService._internal();
  
  // Repository operations
  Future<GitDir> openRepository(String repoPath) async {
    if (_repoDirCache.containsKey(repoPath)) {
      return _repoDirCache[repoPath]!;
    }
    
    try {
      final repoDir = await GitDir.fromExisting(repoPath);
      _repoDirCache[repoPath] = repoDir;
      return repoDir;
    } catch (e) {
      _logger.error('Failed to open Git repository', error: e);
      rethrow;
    }
  }
  
  Future<GitRepository> cloneRepository(String url, String destinationPath, {String? branch}) async {
    try {
      _logger.info('Cloning repository from $url to $destinationPath');
      
      final directory = Directory(destinationPath);
      if (!directory.existsSync()) {
        directory.createSync(recursive: true);
      }
      
      final args = ['clone', url, destinationPath];
      if (branch != null) {
        args.addAll(['-b', branch]);
      }
      
      // Execute git command directly since we don't have a GitDir instance yet
      final process = await Process.run('git', args);
      final result = ProcessResult(
        process.pid, 
        process.exitCode, 
        process.stdout, 
        process.stderr
      );
      _logger.info('Clone result: ${result.stdout}');
      
      // Open the newly cloned repository
      final repoDir = await openRepository(destinationPath);
      
      // Extract repository name from URL
      final repoName = url.split('/').last.replaceAll('.git', '');
      
      // Create repository metadata
      final repository = GitRepository(
        id: destinationPath,  // Using path as ID for now
        name: repoName,
        description: 'Cloned from $url',
        path: destinationPath,
        workspaceId: 'default',  // Add required workspaceId
        createdBy: 'user',       // Add required createdBy
        createdAt: DateTime.now(),
        lastActivityAt: DateTime.now(),
        branchesCount: 0,  // Will be updated later
      );
      
      return repository;
    } catch (e) {
      _logger.error('Failed to clone repository', error: e);
      rethrow;
    }
  }
  
  Future<void> initRepository(String path) async {
    try {
      _logger.info('Initializing new Git repository at $path');
      
      final directory = Directory(path);
      if (!directory.existsSync()) {
        directory.createSync(recursive: true);
      }
      
      // Execute git init command directly
      final process = await Process.run('git', ['init'], workingDirectory: path);
      final result = ProcessResult(
        process.pid, 
        process.exitCode, 
        process.stdout, 
        process.stderr
      );
      
      if (result.exitCode != 0) {
        throw Exception('Failed to initialize repository: ${result.stderr}');
      }
      
      _logger.info('Git repository initialized: ${result.stdout}');
      
      // Create an initial commit with a README file
      final readmePath = '$path/README.md';
      final readmeFile = File(readmePath);
      final folderName = path.split(Platform.pathSeparator).last;
      await readmeFile.writeAsString('# $folderName\n\nInitialized with Gaia Space');
      
      // Stage and commit the README
      final gitDir = await openRepository(path);
      await gitDir.runCommand(['add', 'README.md']);
      await gitDir.runCommand(['commit', '-m', 'Initial commit']);
      
      _logger.info('Created initial commit with README.md');
    } catch (e) {
      _logger.error('Failed to initialize repository', error: e);
      rethrow;
    }
  }

  // Branch operations
  Future<List<GitBranch>> getBranches(String repoPath) async {
    try {
      final repoDir = await openRepository(repoPath);
      
      // Get local branches
      final localBranchResult = await repoDir.runCommand(['branch', '--format=%(refname:short)|%(objectname)|%(upstream)|%(upstream:track)']);
      final remoteBranchResult = await repoDir.runCommand(['branch', '-r', '--format=%(refname:short)|%(objectname)']);
      
      // Get current branch
      final headResult = await repoDir.runCommand(['rev-parse', '--abbrev-ref', 'HEAD']);
      final currentBranch = headResult.stdout.toString().trim();
      
      final branches = <GitBranch>[];
      
      // Parse local branches
      final localBranchLines = localBranchResult.stdout.toString().trim().split('\n');
      for (final line in localBranchLines) {
        if (line.isEmpty) continue;
        
        final parts = line.split('|');
        if (parts.length < 2) continue;
        
        final name = parts[0].trim();
        final shortName = name;
        final targetCommitSha = parts[1].trim();
        final upstream = parts.length > 2 ? parts[2].trim() : null;
        
        // Parse ahead/behind info
        int? ahead;
        int? behind;
        if (parts.length > 3 && parts[3].trim().isNotEmpty) {
          final trackInfo = parts[3].trim(); // e.g., "[ahead 1, behind 2]"
          
          final aheadMatch = RegExp(r'ahead (\d+)').firstMatch(trackInfo);
          if (aheadMatch != null) {
            ahead = int.parse(aheadMatch.group(1)!);
          }
          
          final behindMatch = RegExp(r'behind (\d+)').firstMatch(trackInfo);
          if (behindMatch != null) {
            behind = int.parse(behindMatch.group(1)!);
          }
        }
        
        branches.add(GitBranch(
          name: name,
          shortName: shortName,
          targetCommitSha: targetCommitSha,
          isLocal: true,
          isHead: name == currentBranch,
          upstream: upstream,
          ahead: ahead,
          behind: behind,
        ));
      }
      
      // Parse remote branches
      final remoteBranchLines = remoteBranchResult.stdout.toString().trim().split('\n');
      for (final line in remoteBranchLines) {
        if (line.isEmpty) continue;
        
        final parts = line.split('|');
        if (parts.length < 2) continue;
        
        final name = parts[0].trim();
        final shortName = name.contains('/') ? name.split('/').sublist(1).join('/') : name;
        final targetCommitSha = parts[1].trim();
        
        // Skip if this is just the remote tracking branch for a local branch
        if (branches.any((branch) => branch.upstream == name)) {
          continue;
        }
        
        branches.add(GitBranch(
          name: name,
          shortName: shortName,
          targetCommitSha: targetCommitSha,
          isLocal: false,
          isRemote: true,
        ));
      }
      
      return branches;
    } catch (e) {
      _logger.error('Failed to get branches', error: e);
      return [];
    }
  }
  
  Future<GitBranch> createBranch(String repoPath, String branchName, {String? startPoint}) async {
    try {
      final repoDir = await openRepository(repoPath);
      final args = ['branch', branchName];
      if (startPoint != null) {
        args.add(startPoint);
      }
      
      await repoDir.runCommand(args);
      
      // Get the commit SHA of the new branch
      final result = await repoDir.runCommand(['rev-parse', branchName]);
      final sha = result.stdout.toString().trim();
      
      return GitBranch(
        name: branchName,
        shortName: branchName,
        targetCommitSha: sha,
        isLocal: true,
      );
    } catch (e) {
      _logger.error('Failed to create branch', error: e);
      rethrow;
    }
  }
  
  Future<void> checkoutBranch(String repoPath, String branchName) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['checkout', branchName]);
    } catch (e) {
      _logger.error('Failed to checkout branch', error: e);
      rethrow;
    }
  }
  
  Future<void> deleteBranch(String repoPath, String branchName, {bool force = false}) async {
    try {
      final repoDir = await openRepository(repoPath);
      final args = ['branch', force ? '-D' : '-d', branchName];
      await repoDir.runCommand(args);
    } catch (e) {
      _logger.error('Failed to delete branch', error: e);
      rethrow;
    }
  }
  
  // Commit operations
  Future<List<GitCommit>> getCommits(String repoPath, {String? branch, int limit = 100, int skip = 0}) async {
    try {
      final repoDir = await openRepository(repoPath);
      
      final args = [
        'log',
        '--format=%H|%P|%an|%ae|%at|%s',
        '--date=raw',
        '-n',
        limit.toString(),
        '--skip',
        skip.toString(),
      ];
      
      if (branch != null) {
        args.add(branch);
      }
      
      final result = await repoDir.runCommand(args);
      final lines = result.stdout.toString().trim().split('\n');
      
      final commits = <GitCommit>[];
      for (final line in lines) {
        if (line.isEmpty) continue;
        
        final parts = line.split('|');
        if (parts.length < 6) continue;
        
        final sha = parts[0].trim();
        final parentShas = parts[1].trim().split(' ').where((s) => s.isNotEmpty).toList();
        final author = parts[2].trim();
        final email = parts[3].trim();
        final timestamp = int.parse(parts[4].trim());
        final message = parts[5].trim();
        
        commits.add(GitCommit(
          sha: sha,
          message: message,
          author: author,
          email: email,
          date: DateTime.fromMillisecondsSinceEpoch(timestamp * 1000),
          parentShas: parentShas,
        ));
      }
      
      return commits;
    } catch (e) {
      _logger.error('Failed to get commits', error: e);
      return [];
    }
  }
  
  Future<GitCommit> getCommitDetails(String repoPath, String commitSha) async {
    try {
      final repoDir = await openRepository(repoPath);
      
      final args = [
        'show',
        '--format=%H|%P|%an|%ae|%at|%B',
        '--date=raw',
        commitSha,
      ];
      
      final result = await repoDir.runCommand(args);
      final lines = result.stdout.toString().split('\n');
      
      if (lines.isEmpty) {
        throw Exception('Invalid commit $commitSha');
      }
      
      final parts = lines[0].split('|');
      if (parts.length < 6) {
        throw Exception('Invalid commit format');
      }
      
      final sha = parts[0].trim();
      final parentShas = parts[1].trim().split(' ').where((s) => s.isNotEmpty).toList();
      final author = parts[2].trim();
      final email = parts[3].trim();
      final timestamp = int.parse(parts[4].trim());
      
      // The rest of the lines form the commit message
      final message = parts.sublist(5).join('|');
      
      // Get stats
      final statsResult = await repoDir.runCommand(['show', '--stat', commitSha]);
      final stats = {
        'raw': statsResult.stdout.toString(),
      };
      
      return GitCommit(
        sha: sha,
        message: message,
        author: author,
        email: email,
        date: DateTime.fromMillisecondsSinceEpoch(timestamp * 1000),
        parentShas: parentShas,
        stats: stats,
      );
    } catch (e) {
      _logger.error('Failed to get commit details', error: e);
      rethrow;
    }
  }
  
  Future<String> createCommit(String repoPath, String message, {bool amend = false}) async {
    try {
      final repoDir = await openRepository(repoPath);
      
      final args = ['commit', '-m', message];
      if (amend) {
        args.add('--amend');
      }
      
      await repoDir.runCommand(args);
      
      // Get the commit SHA of the new commit
      final result = await repoDir.runCommand(['rev-parse', 'HEAD']);
      return result.stdout.toString().trim();
    } catch (e) {
      _logger.error('Failed to create commit', error: e);
      rethrow;
    }
  }
  
  // File operations
  Future<List<GitFile>> getStatus(String repoPath) async {
    try {
      final repoDir = await openRepository(repoPath);
      
      // Get status in porcelain format
      final statusResult = await repoDir.runCommand(['status', '--porcelain']);
      final lines = statusResult.stdout.toString().trim().split('\n');
      
      final files = <GitFile>[];
      for (final line in lines) {
        if (line.isEmpty) continue;
        
        final indexStatus = line[0];
        final workingTreeStatus = line[1];
        
        // Extract the file path, handling renamed files
        String? oldPath;
        String path;
        
        if (line.contains(' -> ')) {
          // Handle renamed files
          final pathPart = line.substring(3);
          final pathParts = pathPart.split(' -> ');
          oldPath = pathParts[0];
          path = pathParts[1];
        } else {
          path = line.substring(3);
        }
        
        // Determine status
        GitFileStatus status;
        bool isStaged = indexStatus != ' ' && indexStatus != '?';
        
        if (indexStatus == 'A' || workingTreeStatus == 'A') {
          status = GitFileStatus.added;
        } else if (indexStatus == 'M' || workingTreeStatus == 'M') {
          status = GitFileStatus.modified;
        } else if (indexStatus == 'D' || workingTreeStatus == 'D') {
          status = GitFileStatus.deleted;
        } else if (indexStatus == 'R' || workingTreeStatus == 'R') {
          status = GitFileStatus.renamed;
        } else if (indexStatus == 'C' || workingTreeStatus == 'C') {
          status = GitFileStatus.copied;
        } else if (indexStatus == '?' || workingTreeStatus == '?') {
          status = GitFileStatus.untracked;
          isStaged = false;
        } else if (indexStatus == '!' || workingTreeStatus == '!') {
          status = GitFileStatus.ignored;
          isStaged = false;
        } else if (indexStatus == 'U' || workingTreeStatus == 'U') {
          status = GitFileStatus.conflicted;
        } else {
          status = GitFileStatus.unmodified;
        }
        
        files.add(GitFile(
          path: path,
          status: status,
          isStaged: isStaged,
          oldPath: oldPath,
        ));
      }
      
      return files;
    } catch (e) {
      _logger.error('Failed to get status', error: e);
      return [];
    }
  }
  
  Future<void> stageFile(String repoPath, String filePath) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['add', filePath]);
    } catch (e) {
      _logger.error('Failed to stage file', error: e);
      rethrow;
    }
  }
  
  Future<void> unstageFile(String repoPath, String filePath) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['reset', 'HEAD', filePath]);
    } catch (e) {
      _logger.error('Failed to unstage file', error: e);
      rethrow;
    }
  }
  
  Future<void> discardChanges(String repoPath, String filePath) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['checkout', '--', filePath]);
    } catch (e) {
      _logger.error('Failed to discard changes', error: e);
      rethrow;
    }
  }
  
  // Diff operations
  Future<GitDiff> getDiff(String repoPath, String filePath, {String? commitSha, bool staged = false}) async {
    try {
      final repoDir = await openRepository(repoPath);
      
      List<String> args;
      if (staged) {
        args = ['diff', '--cached', filePath];
      } else if (commitSha != null) {
        args = ['diff', '$commitSha^', commitSha, '--', filePath];
      } else {
        args = ['diff', filePath];
      }
      
      final result = await repoDir.runCommand(args);
      return _parseDiff(result.stdout.toString(), filePath);
    } catch (e) {
      _logger.error('Failed to get diff', error: e);
      rethrow;
    }
  }
  
  Future<GitDiff> getCommitDiff(String repoPath, String commitSha) async {
    try {
      final repoDir = await openRepository(repoPath);
      final args = ['show', '--format=', commitSha];
      
      final result = await repoDir.runCommand(args);
      return _parseDiff(result.stdout.toString(), '');
    } catch (e) {
      _logger.error('Failed to get commit diff', error: e);
      rethrow;
    }
  }
  
  // Remote operations
  Future<List<GitRemote>> getRemotes(String repoPath) async {
    try {
      final repoDir = await openRepository(repoPath);
      final result = await repoDir.runCommand(['remote', '-v']);
      final lines = result.stdout.toString().trim().split('\n');
      
      final remotes = <GitRemote>[];
      final remotesMap = <String, GitRemote>{};
      
      for (final line in lines) {
        if (line.isEmpty) continue;
        
        final parts = line.split(RegExp(r'\s+'));
        if (parts.length < 3) continue;
        
        final name = parts[0];
        final url = parts[1];
        final type = parts[2].replaceAll(RegExp(r'[\(\)]'), '');
        
        if (type == 'fetch') {
          remotesMap[name] = GitRemote(name: name, url: url);
        } else if (type == 'push') {
          if (remotesMap.containsKey(name)) {
            remotesMap[name] = remotesMap[name]!.copyWith(pushUrl: url);
          } else {
            remotesMap[name] = GitRemote(name: name, url: url, pushUrl: url);
          }
        }
      }
      
      remotes.addAll(remotesMap.values);
      return remotes;
    } catch (e) {
      _logger.error('Failed to get remotes', error: e);
      return [];
    }
  }
  
  Future<void> fetch(String repoPath, {String? remote}) async {
    try {
      final repoDir = await openRepository(repoPath);
      final args = ['fetch'];
      if (remote != null) {
        args.add(remote);
      }
      
      await repoDir.runCommand(args);
    } catch (e) {
      _logger.error('Failed to fetch', error: e);
      rethrow;
    }
  }
  
  Future<void> pull(String repoPath, {String? remote, String? branch}) async {
    try {
      final repoDir = await openRepository(repoPath);
      final args = ['pull'];
      if (remote != null) {
        args.add(remote);
      }
      if (branch != null) {
        args.add(branch);
      }
      
      await repoDir.runCommand(args);
    } catch (e) {
      _logger.error('Failed to pull', error: e);
      rethrow;
    }
  }
  
  Future<void> push(String repoPath, {String? remote, String? branch, bool force = false}) async {
    try {
      final repoDir = await openRepository(repoPath);
      final args = ['push'];
      if (force) {
        args.add('--force');
      }
      if (remote != null) {
        args.add(remote);
      }
      if (branch != null) {
        args.add(branch);
      }
      
      await repoDir.runCommand(args);
    } catch (e) {
      _logger.error('Failed to push', error: e);
      rethrow;
    }
  }
  
  // Advanced operations
  Future<void> merge(String repoPath, String branchName) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['merge', branchName]);
    } catch (e) {
      _logger.error('Failed to merge', error: e);
      rethrow;
    }
  }
  
  Future<void> rebase(String repoPath, String branchName) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['rebase', branchName]);
    } catch (e) {
      _logger.error('Failed to rebase', error: e);
      rethrow;
    }
  }
  
  Future<void> cherryPick(String repoPath, String commitSha) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['cherry-pick', commitSha]);
    } catch (e) {
      _logger.error('Failed to cherry-pick', error: e);
      rethrow;
    }
  }
  
  Future<void> revert(String repoPath, String commitSha) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['revert', commitSha]);
    } catch (e) {
      _logger.error('Failed to revert', error: e);
      rethrow;
    }
  }
  
  Future<void> reset(String repoPath, String commitSha, {bool hard = false}) async {
    try {
      final repoDir = await openRepository(repoPath);
      final args = ['reset'];
      if (hard) {
        args.add('--hard');
      } else {
        args.add('--mixed');
      }
      args.add(commitSha);
      
      await repoDir.runCommand(args);
    } catch (e) {
      _logger.error('Failed to reset', error: e);
      rethrow;
    }
  }
  
  // Stash operations
  Future<void> stash(String repoPath, {String? message}) async {
    try {
      final repoDir = await openRepository(repoPath);
      final args = ['stash'];
      if (message != null) {
        args.addAll(['save', message]);
      }
      
      await repoDir.runCommand(args);
    } catch (e) {
      _logger.error('Failed to stash', error: e);
      rethrow;
    }
  }
  
  Future<List<GitCommit>> getStashes(String repoPath) async {
    try {
      final repoDir = await openRepository(repoPath);
      final result = await repoDir.runCommand(['stash', 'list', '--format=%H|%gd|%an|%ae|%at|%s']);
      
      final lines = result.stdout.toString().trim().split('\n');
      final stashes = <GitCommit>[];
      
      for (final line in lines) {
        if (line.isEmpty) continue;
        
        final parts = line.split('|');
        if (parts.length < 6) continue;
        
        final sha = parts[0].trim();
        final stashRef = parts[1].trim(); // e.g., stash@{0}
        final author = parts[2].trim();
        final email = parts[3].trim();
        final timestamp = int.parse(parts[4].trim());
        final message = parts[5].trim();
        
        stashes.add(GitCommit(
          sha: sha,
          message: message,
          author: author,
          email: email,
          date: DateTime.fromMillisecondsSinceEpoch(timestamp * 1000),
          parentShas: [], // Stashes don't have parent info in this format
          isStash: true,
        ));
      }
      
      return stashes;
    } catch (e) {
      _logger.error('Failed to get stashes', error: e);
      return [];
    }
  }
  
  Future<void> applyStash(String repoPath, int stashIndex) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['stash', 'apply', 'stash@{$stashIndex}']);
    } catch (e) {
      _logger.error('Failed to apply stash', error: e);
      rethrow;
    }
  }
  
  Future<void> dropStash(String repoPath, int stashIndex) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['stash', 'drop', 'stash@{$stashIndex}']);
    } catch (e) {
      _logger.error('Failed to drop stash', error: e);
      rethrow;
    }
  }
  
  // Private helper methods
  GitDiff _parseDiff(String diffOutput, String defaultFilePath) {
    if (diffOutput.trim().isEmpty) {
      return GitDiff(
        oldFile: defaultFilePath,
        newFile: defaultFilePath,
        hunks: [],
      );
    }
    
    // Check if it's a binary file
    if (diffOutput.contains('Binary files')) {
      return GitDiff(
        oldFile: defaultFilePath,
        newFile: defaultFilePath,
        hunks: [],
        isBinary: true,
      );
    }
    
    final lines = diffOutput.split('\n');
    
    // Parse header
    String oldFile = defaultFilePath;
    String newFile = defaultFilePath;
    
    for (int i = 0; i < lines.length; i++) {
      final line = lines[i];
      
      if (line.startsWith('---')) {
        oldFile = line.substring(4);
        if (oldFile.startsWith('a/')) {
          oldFile = oldFile.substring(2);
        }
      } else if (line.startsWith('+++')) {
        newFile = line.substring(4);
        if (newFile.startsWith('b/')) {
          newFile = newFile.substring(2);
        }
      }
    }
    
    // Parse hunks
    final hunks = <GitDiffHunk>[];
    GitDiffHunk? currentHunk;
    List<GitDiffLine> currentLines = [];
    
    int oldLineNumber = -1;
    int newLineNumber = -1;
    
    for (final line in lines) {
      // New hunk header
      if (line.startsWith('@@')) {
        // Save previous hunk
        if (currentHunk != null) {
          hunks.add(currentHunk.copyWith(lines: List.of(currentLines)));
          currentLines = [];
        }
        
        // Parse hunk header
        final hunkMatch = RegExp(r'@@ -(\d+),(\d+) \+(\d+),(\d+) @@(.*)').firstMatch(line);
        if (hunkMatch != null) {
          oldLineNumber = int.parse(hunkMatch.group(1)!) - 1;
          oldLineNumber = oldLineNumber < 0 ? 0 : oldLineNumber;
          final oldLines = int.parse(hunkMatch.group(2)!);
          
          newLineNumber = int.parse(hunkMatch.group(3)!) - 1;
          newLineNumber = newLineNumber < 0 ? 0 : newLineNumber;
          final newLines = int.parse(hunkMatch.group(4)!);
          
          final header = hunkMatch.group(5)?.trim() ?? '';
          
          currentHunk = GitDiffHunk(
            oldStart: oldLineNumber + 1,
            oldLines: oldLines,
            newStart: newLineNumber + 1,
            newLines: newLines,
            header: header,
            lines: [],
          );
        }
      } 
      // Line content
      else if (currentHunk != null && !line.startsWith('---') && !line.startsWith('+++') && !line.startsWith('diff --git')) {
        if (line.startsWith('+')) {
          // Addition
          newLineNumber++;
          currentLines.add(GitDiffLine(
            type: GitDiffLineType.addition,
            content: line.substring(1),
            oldLineNum: -1,
            newLineNum: newLineNumber,
          ));
        } else if (line.startsWith('-')) {
          // Deletion
          oldLineNumber++;
          currentLines.add(GitDiffLine(
            type: GitDiffLineType.deletion,
            content: line.substring(1),
            oldLineNum: oldLineNumber,
            newLineNum: -1,
          ));
        } else if (line.startsWith('\\ No newline at end of file')) {
          // End of file marker
          currentLines.add(GitDiffLine(
            type: GitDiffLineType.emptyNewline,
            content: line,
            oldLineNum: -1,
            newLineNum: -1,
          ));
        } else {
          // Context
          oldLineNumber++;
          newLineNumber++;
          currentLines.add(GitDiffLine(
            type: GitDiffLineType.context,
            content: line.startsWith(' ') ? line.substring(1) : line,
            oldLineNum: oldLineNumber,
            newLineNum: newLineNumber,
          ));
        }
      }
    }
    
    // Add the last hunk
    if (currentHunk != null) {
      hunks.add(currentHunk.copyWith(lines: List.of(currentLines)));
    }
    
    return GitDiff(
      oldFile: oldFile,
      newFile: newFile,
      hunks: hunks,
    );
  }
  
  /// Add a new remote to the repository
  Future<void> addRemote(String repoPath, String remoteName, String remoteUrl) async {
    try {
      final repoDir = await openRepository(repoPath);
      await repoDir.runCommand(['remote', 'add', remoteName, remoteUrl]);
    } catch (e) {
      _logger.error('Failed to add remote', error: e);
      rethrow;
    }
  }
}