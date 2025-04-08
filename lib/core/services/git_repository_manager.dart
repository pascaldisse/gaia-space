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
    bool isWebReal = false,
    bool isNewRepo = false,
    bool isFork = false,
    String? parentRepositoryUrl,
    String? remoteUrl,
    String? originalPath,
  }) async {
    try {
      _logger.info('Adding repository: name=$name, path=$path, isWebMock=$isWebMock, isWebReal=$isWebReal');
      
      // If not web mock or web real, validate it's a Git repository
      if (!isWebMock && !isWebReal) {
        _logger.info('Validating repository is a git repository');
        try {
          await _gitService.openRepository(path);
          _logger.info('Git repository validated successfully');
        } catch (e) {
          _logger.error('Failed to open git repository', error: e);
          rethrow;
        }
      } else {
        _logger.info('Skipping git validation for web repository');
      }
      
      // Create repository metadata
      final repositoryId = const Uuid().v4();
      _logger.info('Creating repository with ID: $repositoryId');
      
      // Store original path for web real repositories
      Map<String, dynamic> metadata = {};
      if (isWebReal && originalPath != null) {
        metadata['originalPath'] = originalPath;
      }
      if (isWebReal) {
        metadata['isWebReal'] = true;
      }
      
      final repository = GitRepository(
        id: repositoryId,
        name: name,
        description: description,
        path: path,
        workspaceId: workspaceId ?? 'default',
        createdBy: createdBy ?? 'system',
        createdAt: DateTime.now(),
        lastActivityAt: DateTime.now(),
        branchesCount: (isWebMock || isWebReal) ? 1 : 0, // Default to 1 branch for web
        commitsCount: (isWebMock || isWebReal) ? 1 : 0,  // Default to 1 commit for web
        language: (isWebMock || isWebReal) ? 'Flutter' : null, // Default language for web
        isFork: isFork,
        parentRepositoryUrl: parentRepositoryUrl,
        remoteUrl: remoteUrl,
        metadata: metadata.isNotEmpty ? metadata : null,
      );
      
      _logger.info('Adding repository to in-memory store');
      _repositories.add(repository);
      
      // Only update stats for real non-web repositories
      if (!isWebMock && !isWebReal) {
        _logger.info('Updating repository stats');
        await _updateRepositoryStats(repository.id);
      } else {
        _logger.info('Skipping stats update for web repository');
      }
      
      _logger.info('Repository added successfully with ID: ${repository.id}');
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
      
      // Skip web mock or web real repositories
      if (repository.isWebMock || repository.isWebReal) {
        _logger.info('Skipping stats update for web repository ${repository.name}');
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
      // Check if running on web
      bool isWeb = identical(0, 0.0);
      
      // Skip for web mode or virtual repositories
      if (isWeb || repoPath.startsWith('/virtual/')) {
        return 'Flutter';
      }
      
      // This is just a simple implementation - in a real app we would analyze files by extension
      // or use a language detection library
      try {
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
        _logger.error('Error scanning directory: $e');
        return 'Unknown';
      }
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
      
      // Handle web mock or web real repositories
      if (repository.isWebMock || repository.isWebReal) {
        final now = DateTime.now();
        // Create a mock commit
        String commitType = repository.isWebReal ? "real-web" : "mock";
        String commitPath = repository.isWebReal ? 
            (repository.originalPath ?? repository.path!) : 
            repository.path!;
            
        return [
          GitCommit(
            sha: '$commitType-commit-${DateTime.now().millisecondsSinceEpoch}',
            parentShas: ['$commitType-parent-hash'],
            author: 'Web User',
            email: 'web.user@example.com',
            message: repository.isWebReal ? 
                'Initial commit from ${repository.originalPath ?? "web file system"}' : 
                'Initial commit (web simulation)',
            date: now.subtract(const Duration(days: 1)),
            stats: {
              'fileChanges': 1,
              'insertions': 10,
              'deletions': 0,
              'path': commitPath,
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
      
      // Handle web mock or web real repositories
      if (repository.isWebMock || repository.isWebReal) {
        // Create a mock branch
        String branchName = repository.isWebReal ? "main-web" : "main";
        String branchType = repository.isWebReal ? "web-real" : "web-mock";
        
        return [
          GitBranch(
            name: branchName,
            shortName: branchName,
            targetCommitSha: '$branchType-commit-1',
            isLocal: true,
            isHead: true,
            isRemote: false,
            upstream: 'origin/$branchName',
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
      
      // Skip web repositories (mock or real)
      if (repository.isWebMock || repository.isWebReal) {
        String repoType = repository.isWebReal ? "web real" : "web mock";
        _logger.info('Skipping fetch for $repoType repository ${repository.name}');
        
        // For web real repos, show a message that operation is not supported
        if (repository.isWebReal) {
          _logger.warning('Git operations on web real repositories are limited due to browser security restrictions');
        }
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
      
      // Skip web repositories (mock or real)
      if (repository.isWebMock || repository.isWebReal) {
        String repoType = repository.isWebReal ? "web real" : "web mock";
        _logger.info('Skipping pull for $repoType repository ${repository.name}');
        
        // For web real repos, show a message that operation is not supported
        if (repository.isWebReal) {
          _logger.warning('Git operations on web real repositories are limited due to browser security restrictions');
        }
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
      
      // Skip web repositories (mock or real)
      if (repository.isWebMock || repository.isWebReal) {
        String repoType = repository.isWebReal ? "web real" : "web mock";
        _logger.info('Skipping push for $repoType repository ${repository.name}');
        
        // For web real repos, show a message that operation is not supported
        if (repository.isWebReal) {
          _logger.warning('Git operations on web real repositories are limited due to browser security restrictions');
        }
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