import 'package:gaia_space/core/models/branch_protection.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/models/git_branch.dart';
import 'package:gaia_space/core/services/git_repository_manager.dart';
import 'package:gaia_space/core/services/git_service.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:uuid/uuid.dart';

/// Service to handle branch protection rules
class BranchProtectionService {
  static final BranchProtectionService _instance = BranchProtectionService._internal();
  factory BranchProtectionService() => _instance;
  
  static final _logger = AppLogger('BranchProtectionService');
  final GitService _gitService = GitService();
  final GitRepositoryManager _repositoryManager = GitRepositoryManager();
  
  // In-memory storage
  final List<BranchProtectionRule> _protectionRules = [];
  final List<CodeOwnerConfiguration> _codeOwners = [];
  
  BranchProtectionService._internal();
  
  /// Get all branch protection rules
  Future<List<BranchProtectionRule>> getProtectionRules({String? repositoryId}) async {
    try {
      if (repositoryId != null) {
        return _protectionRules.where((rule) => rule.repositoryId == repositoryId).toList();
      }
      return _protectionRules;
    } catch (e) {
      _logger.error('Failed to get protection rules', error: e);
      rethrow;
    }
  }
  
  /// Get a specific branch protection rule
  Future<BranchProtectionRule?> getProtectionRule(String id) async {
    try {
      return _protectionRules.firstWhere((rule) => rule.id == id);
    } catch (e) {
      return null;
    }
  }
  
  /// Create a branch protection rule
  Future<BranchProtectionRule> createProtectionRule({
    required String repositoryId,
    required String pattern,
    required String createdBy,
    bool requirePullRequest = true,
    int requiredApprovalsCount = 1,
    bool dismissStaleReviews = false,
    bool requireCodeOwnerReviews = false,
    bool restrictPushes = false,
    List<String> allowedPusherIds = const [],
    bool requireStatusChecks = false,
    List<String> requiredStatusChecks = const [],
    bool requireLinearHistory = false,
    bool allowForcePushes = false,
    bool allowDeletions = false,
    bool enforceAdmins = true,
  }) async {
    try {
      _logger.info('Creating branch protection rule for pattern: $pattern');
      
      // Verify repository exists
      final repository = await _repositoryManager.getRepository(repositoryId);
      if (repository == null) {
        throw Exception('Repository not found');
      }
      
      // Create the protection rule
      final now = DateTime.now();
      final rule = BranchProtectionRule(
        id: const Uuid().v4(),
        repositoryId: repositoryId,
        pattern: pattern,
        requirePullRequest: requirePullRequest,
        requiredApprovalsCount: requiredApprovalsCount,
        dismissStaleReviews: dismissStaleReviews,
        requireCodeOwnerReviews: requireCodeOwnerReviews,
        restrictPushes: restrictPushes,
        allowedPusherIds: allowedPusherIds,
        requireStatusChecks: requireStatusChecks,
        requiredStatusChecks: requiredStatusChecks,
        requireLinearHistory: requireLinearHistory,
        allowForcePushes: allowForcePushes,
        allowDeletions: allowDeletions,
        enforceAdmins: enforceAdmins,
        createdAt: now,
        updatedAt: now,
        createdBy: createdBy,
      );
      
      _protectionRules.add(rule);
      _logger.info('Branch protection rule created: ${rule.id}');
      
      return rule;
    } catch (e) {
      _logger.error('Failed to create branch protection rule', error: e);
      rethrow;
    }
  }
  
  /// Update a branch protection rule
  Future<BranchProtectionRule> updateProtectionRule(BranchProtectionRule rule) async {
    try {
      final index = _protectionRules.indexWhere((r) => r.id == rule.id);
      if (index >= 0) {
        final updatedRule = rule.copyWith(
          updatedAt: DateTime.now(),
        );
        _protectionRules[index] = updatedRule;
        return updatedRule;
      } else {
        throw Exception('Branch protection rule not found');
      }
    } catch (e) {
      _logger.error('Failed to update branch protection rule', error: e);
      rethrow;
    }
  }
  
  /// Delete a branch protection rule
  Future<void> deleteProtectionRule(String id) async {
    try {
      _protectionRules.removeWhere((rule) => rule.id == id);
      _logger.info('Branch protection rule deleted: $id');
    } catch (e) {
      _logger.error('Failed to delete branch protection rule', error: e);
      rethrow;
    }
  }
  
  /// Check if a branch is protected
  Future<bool> isBranchProtected(String repositoryId, String branchName) async {
    try {
      final rules = await getProtectionRules(repositoryId: repositoryId);
      for (final rule in rules) {
        if (_matchesPattern(branchName, rule.pattern)) {
          return true;
        }
      }
      return false;
    } catch (e) {
      _logger.error('Failed to check if branch is protected', error: e);
      return false;
    }
  }
  
  /// Get protection rule for a specific branch
  Future<BranchProtectionRule?> getProtectionRuleForBranch(String repositoryId, String branchName) async {
    try {
      final rules = await getProtectionRules(repositoryId: repositoryId);
      for (final rule in rules) {
        if (_matchesPattern(branchName, rule.pattern)) {
          return rule;
        }
      }
      return null;
    } catch (e) {
      _logger.error('Failed to get protection rule for branch', error: e);
      return null;
    }
  }
  
  /// Check if a user can push to a branch
  Future<bool> canPushToBranch(String repositoryId, String branchName, String userId) async {
    try {
      final rule = await getProtectionRuleForBranch(repositoryId, branchName);
      
      // Not protected, anyone can push
      if (rule == null) {
        return true;
      }
      
      // If pushes are restricted, check if user is allowed
      if (rule.restrictPushes) {
        return rule.allowedPusherIds.contains(userId);
      }
      
      // No restrictions, allowed to push
      return true;
    } catch (e) {
      _logger.error('Failed to check if user can push to branch', error: e);
      return false;
    }
  }
  
  /// Get all code owner configurations
  Future<List<CodeOwnerConfiguration>> getCodeOwnerConfigurations({String? repositoryId}) async {
    try {
      if (repositoryId != null) {
        return _codeOwners.where((owner) => owner.repositoryId == repositoryId).toList();
      }
      return _codeOwners;
    } catch (e) {
      _logger.error('Failed to get code owner configurations', error: e);
      rethrow;
    }
  }
  
  /// Get a specific code owner configuration
  Future<CodeOwnerConfiguration?> getCodeOwnerConfiguration(String id) async {
    try {
      return _codeOwners.firstWhere((owner) => owner.id == id);
    } catch (e) {
      return null;
    }
  }
  
  /// Create a code owner configuration
  Future<CodeOwnerConfiguration> createCodeOwnerConfiguration({
    required String repositoryId,
    required String path,
    required List<String> ownerIds,
    required String createdBy,
  }) async {
    try {
      _logger.info('Creating code owner configuration for path: $path');
      
      // Verify repository exists
      final repository = await _repositoryManager.getRepository(repositoryId);
      if (repository == null) {
        throw Exception('Repository not found');
      }
      
      // Create the code owner configuration
      final now = DateTime.now();
      final codeOwner = CodeOwnerConfiguration(
        id: const Uuid().v4(),
        repositoryId: repositoryId,
        path: path,
        ownerIds: ownerIds,
        createdAt: now,
        updatedAt: now,
        createdBy: createdBy,
      );
      
      _codeOwners.add(codeOwner);
      _logger.info('Code owner configuration created: ${codeOwner.id}');
      
      return codeOwner;
    } catch (e) {
      _logger.error('Failed to create code owner configuration', error: e);
      rethrow;
    }
  }
  
  /// Update a code owner configuration
  Future<CodeOwnerConfiguration> updateCodeOwnerConfiguration(CodeOwnerConfiguration codeOwner) async {
    try {
      final index = _codeOwners.indexWhere((c) => c.id == codeOwner.id);
      if (index >= 0) {
        final updatedCodeOwner = codeOwner.copyWith(
          updatedAt: DateTime.now(),
        );
        _codeOwners[index] = updatedCodeOwner;
        return updatedCodeOwner;
      } else {
        throw Exception('Code owner configuration not found');
      }
    } catch (e) {
      _logger.error('Failed to update code owner configuration', error: e);
      rethrow;
    }
  }
  
  /// Delete a code owner configuration
  Future<void> deleteCodeOwnerConfiguration(String id) async {
    try {
      _codeOwners.removeWhere((codeOwner) => codeOwner.id == id);
      _logger.info('Code owner configuration deleted: $id');
    } catch (e) {
      _logger.error('Failed to delete code owner configuration', error: e);
      rethrow;
    }
  }
  
  /// Find code owners for a specific file path
  Future<List<String>> getCodeOwnersForFile(String repositoryId, String filePath) async {
    try {
      final allOwners = await getCodeOwnerConfigurations(repositoryId: repositoryId);
      final matchingOwners = allOwners.where((owner) => _matchesPattern(filePath, owner.path)).toList();
      
      // Get unique owner IDs
      final Set<String> ownerIds = {};
      for (final owner in matchingOwners) {
        ownerIds.addAll(owner.ownerIds);
      }
      
      return ownerIds.toList();
    } catch (e) {
      _logger.error('Failed to get code owners for file', error: e);
      return [];
    }
  }
  
  /// Helper method to check if a string matches a pattern
  /// Supports simple glob patterns like "main", "release/*", etc.
  bool _matchesPattern(String input, String pattern) {
    if (pattern == input) {
      return true;
    }
    
    if (pattern.endsWith('/*')) {
      final prefix = pattern.substring(0, pattern.length - 2);
      return input.startsWith(prefix);
    }
    
    if (pattern.startsWith('*')) {
      final suffix = pattern.substring(1);
      return input.endsWith(suffix);
    }
    
    if (pattern.contains('*')) {
      final parts = pattern.split('*');
      if (parts.length == 2) {
        return input.startsWith(parts[0]) && input.endsWith(parts[1]);
      }
    }
    
    return false;
  }
}