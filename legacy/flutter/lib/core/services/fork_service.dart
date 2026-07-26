import 'dart:io';
import 'package:gaia_space/core/models/fork_relationship.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/models/git_branch.dart';
import 'package:gaia_space/core/models/git_remote.dart';
import 'package:gaia_space/core/services/git_repository_manager.dart';
import 'package:gaia_space/core/services/git_service.dart';
import 'package:gaia_space/core/services/git_activity_manager.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:path/path.dart' as path;
import 'package:uuid/uuid.dart';

/// Service to handle fork operations
class ForkService {
  static final ForkService _instance = ForkService._internal();
  factory ForkService() => _instance;
  
  static final _logger = AppLogger('ForkService');
  final GitService _gitService = GitService();
  final GitRepositoryManager _repositoryManager = GitRepositoryManager();
  final GitActivityManager _activityManager = GitActivityManager();
  
  // In-memory storage until we have a database
  final List<ForkRelationship> _forkRelationships = [];
  
  ForkService._internal();
  
  /// Get all fork relationships
  Future<List<ForkRelationship>> getForkRelationships() async {
    try {
      return _forkRelationships;
    } catch (e) {
      _logger.error('Failed to get fork relationships', error: e);
      rethrow;
    }
  }
  
  /// Get fork relationships for a specific repository
  Future<List<ForkRelationship>> getForkRelationshipsForRepository(String repoId, {bool isUpstream = false}) async {
    try {
      if (isUpstream) {
        // Return repositories that are forked from this one
        return _forkRelationships.where((relationship) => relationship.upstreamRepositoryId == repoId).toList();
      } else {
        // Return fork relationship for this repository (if it's a fork)
        return _forkRelationships.where((relationship) => relationship.forkRepositoryId == repoId).toList();
      }
    } catch (e) {
      _logger.error('Failed to get fork relationships for repository', error: e);
      rethrow;
    }
  }
  
  /// Get a specific fork relationship
  Future<ForkRelationship?> getForkRelationship(String id) async {
    try {
      return _forkRelationships.firstWhere((relationship) => relationship.id == id);
    } catch (e) {
      return null;
    }
  }
  
  /// Fork a repository
  Future<GitRepository> forkRepository({
    required String sourceRepositoryId,
    required String destinationPath,
    String? forkName,
    String? description,
    String? workspaceId,
    String? createdBy,
  }) async {
    try {
      _logger.info('Forking repository: $sourceRepositoryId');
      
      // Get source repository
      final sourceRepository = await _repositoryManager.getRepository(sourceRepositoryId);
      if (sourceRepository == null) {
        throw Exception('Source repository not found');
      }
      
      if (sourceRepository.path == null) {
        throw Exception('Source repository path is null');
      }
      
      // Check if running on web
      bool isWeb = identical(0, 0.0);
      
      // Web repositories require special handling
      if (isWeb || sourceRepository.isWebMock || sourceRepository.isWebReal) {
        _logger.info('Creating web fork');
        
        final name = forkName ?? '${sourceRepository.name}-fork';
        
        // For web, we'll just create a mock fork pointing to the original
        return _createWebFork(
          sourceRepository: sourceRepository,
          name: name,
          description: description ?? 'Fork of ${sourceRepository.name}',
          workspaceId: workspaceId ?? sourceRepository.workspaceId,
          createdBy: createdBy ?? 'system',
        );
      }
      
      return await _activityManager.executeWithActivity(
        action: 'Fork repository',
        repositoryId: sourceRepositoryId,
        operation: () async {
          // Clone source repository to destination
          final forkedRepositoryPath = path.join(
            destinationPath,
            forkName ?? '${sourceRepository.name}-fork',
          );
          
          _logger.info('Cloning source repository to $forkedRepositoryPath');
          
          // Clone the source repository
          await _gitService.cloneRepository(
            sourceRepository.path!,
            forkedRepositoryPath,
          );
          
          // Update remote to point to the source repository
          await _gitService.addRemote(
            forkedRepositoryPath,
            'upstream',
            sourceRepository.path!,
          );
          
          // Create the forked repository
          final now = DateTime.now();
          final forkedRepository = await _repositoryManager.addRepository(
            name: forkName ?? '${sourceRepository.name}-fork',
            path: forkedRepositoryPath,
            description: description ?? 'Fork of ${sourceRepository.name}',
            workspaceId: workspaceId ?? sourceRepository.workspaceId,
            createdBy: createdBy ?? 'system',
            isNewRepo: false,
            isFork: true,
            parentRepositoryUrl: sourceRepository.path,
          );
          
          // Create fork relationship
          final forkRelationship = ForkRelationship(
            id: const Uuid().v4(),
            forkRepositoryId: forkedRepository.id,
            upstreamRepositoryId: sourceRepository.id,
            upstreamUrl: sourceRepository.path,
            createdAt: now,
            lastSyncedAt: now,
            aheadCount: 0,
            behindCount: 0,
            syncing: false,
            hasActiveSync: true,
            remoteName: 'upstream',
          );
          
          _forkRelationships.add(forkRelationship);
          _logger.info('Fork relationship created: ${forkRelationship.id}');
          
          return forkedRepository;
        },
      );
    } catch (e) {
      _logger.error('Failed to fork repository', error: e);
      rethrow;
    }
  }
  
  /// Update fork relationship sync status
  Future<ForkRelationship> updateForkRelationship(ForkRelationship relationship) async {
    try {
      final index = _forkRelationships.indexWhere((r) => r.id == relationship.id);
      if (index >= 0) {
        _forkRelationships[index] = relationship;
        return relationship;
      } else {
        throw Exception('Fork relationship not found');
      }
    } catch (e) {
      _logger.error('Failed to update fork relationship', error: e);
      rethrow;
    }
  }
  
  /// Delete fork relationship
  Future<void> deleteForkRelationship(String id) async {
    try {
      _forkRelationships.removeWhere((relationship) => relationship.id == id);
      _logger.info('Fork relationship deleted: $id');
    } catch (e) {
      _logger.error('Failed to delete fork relationship', error: e);
      rethrow;
    }
  }
  
  /// Sync fork with upstream
  Future<ForkRelationship> syncForkWithUpstream(String forkRelationshipId) async {
    try {
      final relationship = await getForkRelationship(forkRelationshipId);
      if (relationship == null) {
        throw Exception('Fork relationship not found');
      }
      
      // Update status to syncing
      final updatedRelationship = relationship.copyWith(
        syncing: true,
        lastSyncedAt: DateTime.now(),
      );
      await updateForkRelationship(updatedRelationship);
      
      return await _activityManager.executeWithActivity(
        action: 'Sync fork with upstream',
        repositoryId: relationship.forkRepositoryId,
        operation: () async {
          final forkRepo = await _repositoryManager.getRepository(relationship.forkRepositoryId);
          if (forkRepo == null || forkRepo.path == null) {
            throw Exception('Fork repository not found');
          }
          
          // Check if web repository
          if (forkRepo.isWebMock || forkRepo.isWebReal) {
            // Simulate sync for web repositories
            await Future.delayed(const Duration(seconds: 1));
            
            final now = DateTime.now();
            final synced = updatedRelationship.copyWith(
              syncing: false,
              lastSyncedAt: now,
              aheadCount: 0,
              behindCount: 0,
            );
            await updateForkRelationship(synced);
            return synced;
          }
          
          // Fetch from upstream
          await _gitService.fetch(
            forkRepo.path!,
            remote: relationship.remoteName ?? 'upstream',
          );
          
          // Get ahead/behind counts for all branches
          final branches = await _gitService.getBranches(forkRepo.path!);
          int totalBehind = 0;
          int totalAhead = 0;
          
          for (final branch in branches) {
            if (branch.upstream != null) {
              totalBehind += branch.behind ?? 0;
              totalAhead += branch.ahead ?? 0;
            }
          }
          
          // Update relationship status
          final now = DateTime.now();
          final synced = updatedRelationship.copyWith(
            syncing: false,
            lastSyncedAt: now,
            aheadCount: totalAhead,
            behindCount: totalBehind,
          );
          await updateForkRelationship(synced);
          
          return synced;
        },
      );
    } catch (e) {
      _logger.error('Failed to sync fork with upstream', error: e);
      
      // Update status to not syncing in case of error
      try {
        final relationship = await getForkRelationship(forkRelationshipId);
        if (relationship != null) {
          final updated = relationship.copyWith(
            syncing: false,
            lastSyncedAt: DateTime.now(),
          );
          await updateForkRelationship(updated);
        }
      } catch (e2) {
        _logger.error('Failed to update fork relationship after sync error', error: e2);
      }
      
      rethrow;
    }
  }
  
  /// Check if a repository is a fork
  Future<bool> isRepositoryFork(String repoId) async {
    try {
      final relationships = await getForkRelationshipsForRepository(repoId);
      return relationships.isNotEmpty;
    } catch (e) {
      _logger.error('Failed to check if repository is a fork', error: e);
      return false;
    }
  }
  
  /// Get upstream repository for a fork
  Future<GitRepository?> getUpstreamRepository(String forkId) async {
    try {
      final relationships = await getForkRelationshipsForRepository(forkId);
      if (relationships.isEmpty) {
        return null;
      }
      
      final relationship = relationships.first;
      return await _repositoryManager.getRepository(relationship.upstreamRepositoryId);
    } catch (e) {
      _logger.error('Failed to get upstream repository', error: e);
      return null;
    }
  }
  
  /// Helper to create a mock fork for web
  Future<GitRepository> _createWebFork({
    required GitRepository sourceRepository,
    required String name,
    required String description,
    required String workspaceId,
    required String createdBy,
  }) async {
    // Generate mock path for the web fork
    final mockPath = '/virtual/forks/${name.toLowerCase().replaceAll(' ', '-')}-${DateTime.now().millisecondsSinceEpoch}';
    
    // Create the forked repository
    final now = DateTime.now();
    final forkedRepository = await _repositoryManager.addRepository(
      name: name,
      path: mockPath,
      description: description,
      workspaceId: workspaceId,
      createdBy: createdBy,
      isNewRepo: false,
      isWebMock: true,
      isFork: true,
      parentRepositoryUrl: sourceRepository.path,
    );
    
    // Create fork relationship
    final forkRelationship = ForkRelationship(
      id: const Uuid().v4(),
      forkRepositoryId: forkedRepository.id,
      upstreamRepositoryId: sourceRepository.id,
      upstreamUrl: sourceRepository.path,
      createdAt: now,
      lastSyncedAt: now,
      aheadCount: 0,
      behindCount: 0,
      syncing: false,
      hasActiveSync: true,
      remoteName: 'upstream',
    );
    
    _forkRelationships.add(forkRelationship);
    _logger.info('Web fork relationship created: ${forkRelationship.id}');
    
    return forkedRepository;
  }
}