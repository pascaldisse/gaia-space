import 'dart:io';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/models/git_branch.dart';
import 'package:gaia_space/core/models/git_commit.dart';
import 'package:gaia_space/core/services/git_service.dart';
import 'package:gaia_space/core/services/git_activity_manager.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:path/path.dart' as path;
import 'package:uuid/uuid.dart';

class GitRepositoryManager {
  static final GitRepositoryManager _instance = GitRepositoryManager._internal();
  factory GitRepositoryManager() => _instance;
  
  static final _logger = AppLogger();
  final GitService _gitService = GitService();
  final GitActivityManager _activityManager = GitActivityManager();
  
  // In-memory storage until we have a database
  final List<GitRepository> _repositories = [];
  
  GitRepositoryManager._internal();
  
  // Repository management
  Future<List<GitRepository>> getRepositories({String? workspaceId}) async {
    try {
      if (workspaceId != null) {
        return _repositories.where((repo) => repo.workspaceId == workspaceId).toList();
      }
      return _repositories;
    } catch (e) {
      _logger.error('Failed to get repositories', error: e);
      rethrow;
    }
  }
  
  Future<GitRepository> addRepository({
    required String name,
    required String path,
    String? description,
    String? workspaceId,
    String? createdBy,
    bool isWebMock = false,
    bool isNewRepo = false,
    String? remoteUrl,
  }) async {
    try {
      _logger.info('Adding repository at $path');
      
      // If not web mock, validate it's a Git repository
      if (!isWebMock) {
        await _gitService.openRepository(path);
      }
      
      // Create repository metadata
      final repository = GitRepository(
        id: const Uuid().v4(),
        name: name,
        description: description,
        path: path,
        workspaceId: workspaceId ?? 'default',
        createdBy: createdBy ?? 'system',
        createdAt: DateTime.now(),
        lastActivityAt: DateTime.now(),
        branchesCount: isWebMock ? 1 : 0, // Default to 1 branch for web mock
        commitsCount: isWebMock ? 1 : 0,  // Default to 1 commit for web mock
        language: isWebMock ? 'Flutter' : null, // Default language for web mock
      );
      
      _repositories.add(repository);
      
      // Only update stats for real repositories
      if (!isWebMock) {
        await _updateRepositoryStats(repository.id);
      }
      
      return _repositories.firstWhere((repo) => repo.id == repository.id);
    } catch (e) {
      _logger.error('Failed to add repository', error: e);
      rethrow;
    }
  }
  
  Future<GitRepository> cloneRepository({
    required String url,
    required String destinationPath,
    String? name,
    String? description,
    String? branch,
    String? workspaceId,
    String? createdBy,
  }) async {
    try {
      return await _activityManager.executeWithActivity(
        action: 'Clone repository',
        repositoryId: url, // Use URL as temp ID
        operation: () async {
          final repository = await _gitService.cloneRepository(url, destinationPath, branch: branch);
          
          // Create repository metadata
          final repoName = name ?? url.split('/').last.replaceAll('.git', '');
          final repoDescription = description ?? 'Cloned from $url';
          
          final gitRepository = GitRepository(
            id: const Uuid().v4(),
            name: repoName,
            description: repoDescription,
            path: destinationPath,
            workspaceId: workspaceId ?? 'default',
            createdBy: createdBy ?? 'system',
            createdAt: DateTime.now(),
            lastActivityAt: DateTime.now(),
            branchesCount: 0,
          );
          
          _repositories.add(gitRepository);
          await _updateRepositoryStats(gitRepository.id);
          
          return _repositories.firstWhere((repo) => repo.id == gitRepository.id);
        }
      );
    } catch (e) {
      _logger.error('Failed to clone repository', error: e);
      rethrow;
    }
  }
  
  Future<GitRepository?> getRepository(String id) async {
    try {
      return _repositories.firstWhere((repo) => repo.id == id);
    } catch (e) {
      return null;
    }
  }
  
  Future<GitRepository?> getRepositoryByPath(String path) async {
    try {
      return _repositories.firstWhere((repo) => repo.path == path);
    } catch (e) {
      return null;
    }
  }
  
  Future<void> updateRepository(GitRepository repository) async {
    try {
      final index = _repositories.indexWhere((repo) => repo.id == repository.id);
      if (index >= 0) {
        _repositories[index] = repository;
      } else {
        throw Exception('Repository not found');
      }
    } catch (e) {
      _logger.error('Failed to update repository', error: e);
      rethrow;
    }
  }
  
  Future<void> deleteRepository(String id, {bool deleteFiles = false}) async {
    try {
      final repository = await getRepository(id);
      if (repository == null) {
        throw Exception('Repository not found');
      }
      
      if (deleteFiles && repository.path != null) {
        final directory = Directory(repository.path!);
        if (await directory.exists()) {
          await directory.delete(recursive: true);
        }
      }
      
      _repositories.removeWhere((repo) => repo.id == id);
    } catch (e) {
      _logger.error('Failed to delete repository', error: e);
      rethrow;
    }
  }
  
  // Repository analysis
  Future<void> _updateRepositoryStats(String repoId) async {
    try {
      final repository = await getRepository(repoId);
      if (repository == null || repository.path == null) return;
      
      _logger.info('Updating repository stats for ${repository.name}');
      
      // Skip web mock repositories
      if (repository.path!.startsWith('/virtual/')) {
        _logger.info('Skipping stats update for web mock repository ${repository.name}');
        return;
      }
      
      // Get branch count
      final branches = await _gitService.getBranches(repository.path!);
      
      // Get primary language
      final language = await _determinePrimaryLanguage(repository.path!);
      
      // Get commit count
      final commits = await _gitService.getCommits(repository.path!, limit: 1);
      int commitCount = 0;
      if (commits.isNotEmpty) {
        // TODO: Get accurate commit count (this is just a placeholder)
        commitCount = 1;
      }
      
      final updatedRepo = repository.copyWith(
        branchesCount: branches.length,
        commitsCount: commitCount,
        language: language,
        lastActivityAt: DateTime.now(),
      );
      
      await updateRepository(updatedRepo);
    } catch (e) {
      _logger.error('Failed to update repository stats', error: e);
    }
  }
  
  Future<String?> _determinePrimaryLanguage(String repoPath) async {
    try {
      // Skip for web mock repositories
      if (repoPath.startsWith('/virtual/')) {
        return 'Flutter';
      }
      
      // This is just a simple implementation - in a real app we would analyze files by extension
      // or use a language detection library
      final directory = Directory(repoPath);
      
      int dartCount = 0;
      int jsCount = 0;
      int pythonCount = 0;
      int tsCount = 0;
      int cppCount = 0;
      
      await for (final entity in directory.list(recursive: true, followLinks: false)) {
        if (entity is File) {
          final extension = path.extension(entity.path).toLowerCase();
          
          switch (extension) {
            case '.dart':
              dartCount++;
              break;
            case '.js':
              jsCount++;
              break;
            case '.py':
              pythonCount++;
              break;
            case '.ts':
              tsCount++;
              break;
            case '.cpp':
            case '.cc':
            case '.cxx':
              cppCount++;
              break;
          }
        }
      }
      
      // Return the language with the most files
      final counts = {
        'Dart': dartCount,
        'JavaScript': jsCount,
        'Python': pythonCount,
        'TypeScript': tsCount,
        'C++': cppCount,
      };
      
      String? primaryLanguage;
      int maxCount = 0;
      
      counts.forEach((lang, count) {
        if (count > maxCount) {
          maxCount = count;
          primaryLanguage = lang;
        }
      });
      
      return primaryLanguage;
    } catch (e) {
      _logger.error('Failed to determine primary language', error: e);
      return null;
    }
  }
  
  // Helper methods
  Future<List<GitCommit>> getRecentCommits(String repoId, {int limit = 5}) async {
    try {
      final repository = await getRepository(repoId);
      if (repository == null || repository.path == null) {
        return [];
      }
      
      // Handle web mock repositories
      if (repository.path!.startsWith('/virtual/')) {
        final now = DateTime.now();
        // Create a mock commit
        return [
          GitCommit(
            sha: 'mock-commit-${DateTime.now().millisecondsSinceEpoch}',
            parentShas: ['mock-parent-hash'],
            author: 'Web User',
            email: 'web.user@example.com',
            message: 'Initial commit (web simulation)',
            date: now.subtract(const Duration(days: 1)),
            stats: {
              'fileChanges': 1,
              'insertions': 10,
              'deletions': 0,
            },
          )
        ];
      }
      
      return await _gitService.getCommits(repository.path!, limit: limit);
    } catch (e) {
      _logger.error('Failed to get recent commits', error: e);
      return [];
    }
  }
  
  Future<List<GitBranch>> getBranches(String repoId) async {
    try {
      final repository = await getRepository(repoId);
      if (repository == null || repository.path == null) {
        return [];
      }
      
      // Handle web mock repositories
      if (repository.path!.startsWith('/virtual/')) {
        // Create a mock branch
        return [
          GitBranch(
            name: 'main',
            shortName: 'main',
            targetCommitSha: 'mock-commit-1',
            isLocal: true,
            isHead: true,
            isRemote: false,
            upstream: 'origin/main',
            ahead: 0,
            behind: 0,
          )
        ];
      }
      
      return await _gitService.getBranches(repository.path!);
    } catch (e) {
      _logger.error('Failed to get branches', error: e);
      return [];
    }
  }
  
  // Git operations through activity manager
  Future<void> fetchRepository(String repoId, {String? remote}) async {
    try {
      final repository = await getRepository(repoId);
      if (repository == null || repository.path == null) {
        throw Exception('Repository not found');
      }
      
      // Skip web mock repositories
      if (repository.path!.startsWith('/virtual/')) {
        _logger.info('Skipping fetch for web mock repository ${repository.name}');
        return;
      }
      
      await _activityManager.executeWithActivity(
        action: 'Fetch ${remote ?? 'all remotes'}',
        repositoryId: repoId,
        operation: () async {
          await _gitService.fetch(repository.path!, remote: remote);
          await _updateRepositoryStats(repoId);
        }
      );
    } catch (e) {
      _logger.error('Failed to fetch repository', error: e);
      rethrow;
    }
  }
  
  Future<void> pullRepository(String repoId, {String? remote, String? branch}) async {
    try {
      final repository = await getRepository(repoId);
      if (repository == null || repository.path == null) {
        throw Exception('Repository not found');
      }
      
      // Skip web mock repositories
      if (repository.path!.startsWith('/virtual/')) {
        _logger.info('Skipping pull for web mock repository ${repository.name}');
        return;
      }
      
      await _activityManager.executeWithActivity(
        action: 'Pull ${remote ?? 'origin'}/${branch ?? 'current branch'}',
        repositoryId: repoId,
        operation: () async {
          await _gitService.pull(repository.path!, remote: remote, branch: branch);
          await _updateRepositoryStats(repoId);
        }
      );
    } catch (e) {
      _logger.error('Failed to pull repository', error: e);
      rethrow;
    }
  }
  
  Future<void> pushRepository(String repoId, {String? remote, String? branch, bool force = false}) async {
    try {
      final repository = await getRepository(repoId);
      if (repository == null || repository.path == null) {
        throw Exception('Repository not found');
      }
      
      // Skip web mock repositories
      if (repository.path!.startsWith('/virtual/')) {
        _logger.info('Skipping push for web mock repository ${repository.name}');
        return;
      }
      
      await _activityManager.executeWithActivity(
        action: 'Push to ${remote ?? 'origin'}/${branch ?? 'current branch'}${force ? ' (force)' : ''}',
        repositoryId: repoId,
        operation: () async {
          await _gitService.push(repository.path!, remote: remote, branch: branch, force: force);
          await _updateRepositoryStats(repoId);
        }
      );
    } catch (e) {
      _logger.error('Failed to push repository', error: e);
      rethrow;
    }
  }
}