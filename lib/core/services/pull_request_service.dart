import 'package:gaia_space/core/models/pull_request.dart';
import 'package:gaia_space/core/models/git_diff.dart';
import 'package:gaia_space/core/models/git_commit.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/services/git_repository_manager.dart';
import 'package:gaia_space/core/services/git_service.dart';
import 'package:gaia_space/core/services/fork_service.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:uuid/uuid.dart';

/// Service to handle pull request operations
class PullRequestService {
  static final PullRequestService _instance = PullRequestService._internal();
  factory PullRequestService() => _instance;
  
  static final _logger = AppLogger('PullRequestService');
  final GitService _gitService = GitService();
  final GitRepositoryManager _repositoryManager = GitRepositoryManager();
  final ForkService _forkService = ForkService();
  
  // In-memory storage
  final List<PullRequest> _pullRequests = [];
  final List<PullRequestComment> _comments = [];
  final List<PullRequestReview> _reviews = [];
  
  PullRequestService._internal();
  
  /// Get all pull requests
  Future<List<PullRequest>> getPullRequests({
    String? repositoryId,
    String? authorId,
    PullRequestStatus? status,
    bool includeDetails = false,
  }) async {
    try {
      List<PullRequest> requests = _pullRequests;
      
      if (repositoryId != null) {
        requests = requests.where((pr) => 
          pr.sourceRepositoryId == repositoryId || 
          pr.targetRepositoryId == repositoryId
        ).toList();
      }
      
      if (authorId != null) {
        requests = requests.where((pr) => pr.authorId == authorId).toList();
      }
      
      if (status != null) {
        requests = requests.where((pr) => pr.status == status).toList();
      }
      
      // Include counts if requested
      if (includeDetails) {
        List<PullRequest> detailedRequests = [];
        
        for (final pr in requests) {
          final commentsCount = _comments
            .where((c) => c.pullRequestId == pr.id)
            .length;
            
          detailedRequests.add(pr.copyWith(
            commentsCount: commentsCount,
          ));
        }
        
        return detailedRequests;
      }
      
      return requests;
    } catch (e) {
      _logger.error('Failed to get pull requests', error: e);
      rethrow;
    }
  }
  
  /// Get pull request by ID
  Future<PullRequest?> getPullRequest(String id) async {
    try {
      final request = _pullRequests.firstWhere((pr) => pr.id == id);
      final commentsCount = _comments
        .where((c) => c.pullRequestId == id)
        .length;
        
      return request.copyWith(
        commentsCount: commentsCount,
      );
    } catch (e) {
      return null;
    }
  }
  
  /// Create a new pull request
  Future<PullRequest> createPullRequest({
    required String title,
    required String description,
    required String sourceRepositoryId,
    required String sourceBranch,
    required String targetRepositoryId,
    required String targetBranch,
    required String authorId,
    List<String> reviewerIds = const [],
    List<String> assigneeIds = const [],
    List<String> labels = const [],
    MergeStrategy mergeStrategy = MergeStrategy.merge,
  }) async {
    try {
      _logger.info('Creating pull request: $title');
      
      // Validate branch information
      final sourceRepo = await _repositoryManager.getRepository(sourceRepositoryId);
      final targetRepo = await _repositoryManager.getRepository(targetRepositoryId);
      
      if (sourceRepo == null) {
        throw Exception('Source repository not found');
      }
      
      if (targetRepo == null) {
        throw Exception('Target repository not found');
      }
      
      // For web repositories, we'll just create a mock PR
      bool isWebMock = (sourceRepo.isWebMock || targetRepo.isWebMock);
      
      final now = DateTime.now();
      final pullRequest = PullRequest(
        id: const Uuid().v4(),
        title: title,
        description: description,
        sourceRepositoryId: sourceRepositoryId,
        sourceBranch: sourceBranch,
        targetRepositoryId: targetRepositoryId,
        targetBranch: targetBranch,
        authorId: authorId,
        createdAt: now,
        updatedAt: now,
        status: PullRequestStatus.open,
        mergeStrategy: mergeStrategy,
        reviewerIds: reviewerIds,
        assigneeIds: assigneeIds,
        labels: labels,
        commitsCount: isWebMock ? 1 : 0,
        commentsCount: 0,
        mergeable: true,
        hasConflicts: false,
      );
      
      _pullRequests.add(pullRequest);
      
      _logger.info('Pull request created: ${pullRequest.id}');
      
      // If not a web mock, calculate real values for commits and conflicts
      if (!isWebMock && sourceRepo.path != null && targetRepo.path != null) {
        // This would be a real implementation that compares the branches
        // For now, we'll just use some mock data
        try {
          final updatedPR = await _updatePullRequestStats(pullRequest.id);
          return updatedPR ?? pullRequest;
        } catch (e) {
          _logger.error('Failed to update pull request stats, returning basic PR', error: e);
          return pullRequest;
        }
      }
      
      return pullRequest;
    } catch (e) {
      _logger.error('Failed to create pull request', error: e);
      rethrow;
    }
  }
  
  /// Update an existing pull request
  Future<PullRequest> updatePullRequest(PullRequest pullRequest) async {
    try {
      final index = _pullRequests.indexWhere((pr) => pr.id == pullRequest.id);
      if (index >= 0) {
        final updatedPR = pullRequest.copyWith(
          updatedAt: DateTime.now(),
        );
        _pullRequests[index] = updatedPR;
        return updatedPR;
      } else {
        throw Exception('Pull request not found');
      }
    } catch (e) {
      _logger.error('Failed to update pull request', error: e);
      rethrow;
    }
  }
  
  /// Merge a pull request
  Future<PullRequest> mergePullRequest(
    String pullRequestId, {
    required String userId,
    MergeStrategy? mergeStrategy,
    String? commitMessage,
  }) async {
    try {
      final pr = await getPullRequest(pullRequestId);
      if (pr == null) {
        throw Exception('Pull request not found');
      }
      
      if (pr.status != PullRequestStatus.open) {
        throw Exception('Pull request is not open');
      }
      
      if (pr.hasConflicts) {
        throw Exception('Pull request has conflicts that must be resolved');
      }
      
      final sourceRepo = await _repositoryManager.getRepository(pr.sourceRepositoryId);
      final targetRepo = await _repositoryManager.getRepository(pr.targetRepositoryId);
      
      if (sourceRepo == null || targetRepo == null) {
        throw Exception('Repository not found');
      }
      
      // If web repository, just simulate merge
      if (sourceRepo.isWebMock || targetRepo.isWebMock || 
          sourceRepo.isWebReal || targetRepo.isWebReal) {
        _logger.info('Simulating merge for web repositories');
        
        final now = DateTime.now();
        final mergedPR = pr.copyWith(
          status: PullRequestStatus.merged,
          mergedAt: now,
          updatedAt: now,
          mergedBy: userId,
          mergeCommitSha: 'mock-merge-commit-${DateTime.now().millisecondsSinceEpoch}',
          mergeStrategy: mergeStrategy ?? pr.mergeStrategy,
        );
        
        await updatePullRequest(mergedPR);
        return mergedPR;
      }
      
      // Actual implementation would merge the branches
      if (sourceRepo.path == null || targetRepo.path == null) {
        throw Exception('Repository path is null');
      }
      
      // For same repository PRs
      if (sourceRepo.id == targetRepo.id) {
        // Determine merge strategy
        final strategy = mergeStrategy ?? pr.mergeStrategy;
        final now = DateTime.now();
        String mergeCommitSha;
        
        switch (strategy) {
          case MergeStrategy.merge:
            // Standard merge
            mergeCommitSha = await _gitService.mergeBranches(
              sourceRepo.path!,
              sourceBranch: pr.sourceBranch,
              targetBranch: pr.targetBranch,
              message: commitMessage ?? 'Merge pull request #${pr.id}',
            );
            break;
            
          case MergeStrategy.squash:
            // Squash merge
            mergeCommitSha = await _gitService.squashMergeBranches(
              sourceRepo.path!,
              sourceBranch: pr.sourceBranch,
              targetBranch: pr.targetBranch,
              message: commitMessage ?? 'Squash merge pull request #${pr.id}',
            );
            break;
            
          case MergeStrategy.rebase:
            // Rebase merge
            mergeCommitSha = await _gitService.rebaseBranches(
              sourceRepo.path!,
              sourceBranch: pr.sourceBranch,
              targetBranch: pr.targetBranch,
            );
            break;
        }
        
        final mergedPR = pr.copyWith(
          status: PullRequestStatus.merged,
          mergedAt: now,
          updatedAt: now,
          mergedBy: userId,
          mergeCommitSha: mergeCommitSha,
          mergeStrategy: strategy,
        );
        
        await updatePullRequest(mergedPR);
        return mergedPR;
      } else {
        // Cross-repository PR implementation would be more complex
        // This would fetch from the fork, merge, and push
        
        // For now, we'll just simulate it
        final now = DateTime.now();
        final mergedPR = pr.copyWith(
          status: PullRequestStatus.merged,
          mergedAt: now,
          updatedAt: now,
          mergedBy: userId,
          mergeCommitSha: 'cross-repo-merge-${DateTime.now().millisecondsSinceEpoch}',
          mergeStrategy: mergeStrategy ?? pr.mergeStrategy,
        );
        
        await updatePullRequest(mergedPR);
        return mergedPR;
      }
    } catch (e) {
      _logger.error('Failed to merge pull request', error: e);
      rethrow;
    }
  }
  
  /// Close a pull request (without merging)
  Future<PullRequest> closePullRequest(String pullRequestId, {required String userId}) async {
    try {
      final pr = await getPullRequest(pullRequestId);
      if (pr == null) {
        throw Exception('Pull request not found');
      }
      
      if (pr.status != PullRequestStatus.open) {
        throw Exception('Pull request is not open');
      }
      
      final now = DateTime.now();
      final closedPR = pr.copyWith(
        status: PullRequestStatus.closed,
        closedAt: now,
        updatedAt: now,
      );
      
      await updatePullRequest(closedPR);
      return closedPR;
    } catch (e) {
      _logger.error('Failed to close pull request', error: e);
      rethrow;
    }
  }
  
  /// Reopen a closed pull request
  Future<PullRequest> reopenPullRequest(String pullRequestId) async {
    try {
      final pr = await getPullRequest(pullRequestId);
      if (pr == null) {
        throw Exception('Pull request not found');
      }
      
      if (pr.status == PullRequestStatus.merged) {
        throw Exception('Cannot reopen a merged pull request');
      }
      
      final now = DateTime.now();
      final reopenedPR = pr.copyWith(
        status: PullRequestStatus.open,
        closedAt: null,
        updatedAt: now,
      );
      
      await updatePullRequest(reopenedPR);
      
      // Update the PR stats
      return await _updatePullRequestStats(pullRequestId) ?? reopenedPR;
    } catch (e) {
      _logger.error('Failed to reopen pull request', error: e);
      rethrow;
    }
  }
  
  /// Add a comment to a pull request
  Future<PullRequestComment> addComment({
    required String pullRequestId,
    required String content,
    required String authorId,
    String? inReplyToId,
    String? filePath,
    int? lineNumber,
    String? commitSha,
  }) async {
    try {
      // Verify PR exists
      final pr = await getPullRequest(pullRequestId);
      if (pr == null) {
        throw Exception('Pull request not found');
      }
      
      final now = DateTime.now();
      final comment = PullRequestComment(
        id: const Uuid().v4(),
        pullRequestId: pullRequestId,
        content: content,
        authorId: authorId,
        createdAt: now,
        inReplyToId: inReplyToId,
        filePath: filePath,
        lineNumber: lineNumber,
        commitSha: commitSha,
      );
      
      _comments.add(comment);
      
      // Update PR with new comment count
      final commentsCount = _comments.where((c) => c.pullRequestId == pullRequestId).length;
      final updatedPR = pr.copyWith(
        updatedAt: now,
        commentsCount: commentsCount,
      );
      await updatePullRequest(updatedPR);
      
      return comment;
    } catch (e) {
      _logger.error('Failed to add comment', error: e);
      rethrow;
    }
  }
  
  /// Get comments for a pull request
  Future<List<PullRequestComment>> getComments(String pullRequestId, {
    String? filePath,
    int? lineNumber,
    String? commitSha,
  }) async {
    try {
      List<PullRequestComment> filtered = _comments.where(
        (comment) => comment.pullRequestId == pullRequestId
      ).toList();
      
      if (filePath != null) {
        filtered = filtered.where((comment) => comment.filePath == filePath).toList();
      }
      
      if (lineNumber != null) {
        filtered = filtered.where((comment) => comment.lineNumber == lineNumber).toList();
      }
      
      if (commitSha != null) {
        filtered = filtered.where((comment) => comment.commitSha == commitSha).toList();
      }
      
      return filtered;
    } catch (e) {
      _logger.error('Failed to get comments', error: e);
      rethrow;
    }
  }
  
  /// Add a review to a pull request
  Future<PullRequestReview> addReview({
    required String pullRequestId,
    required String reviewerId,
    required String state,
    String? comment,
    String? commitSha,
  }) async {
    try {
      // Verify PR exists
      final pr = await getPullRequest(pullRequestId);
      if (pr == null) {
        throw Exception('Pull request not found');
      }
      
      final now = DateTime.now();
      final review = PullRequestReview(
        id: const Uuid().v4(),
        pullRequestId: pullRequestId,
        reviewerId: reviewerId,
        state: state,
        comment: comment,
        createdAt: now,
        commitSha: commitSha,
      );
      
      _reviews.add(review);
      
      // Update the PR
      final updatedPR = pr.copyWith(updatedAt: now);
      await updatePullRequest(updatedPR);
      
      return review;
    } catch (e) {
      _logger.error('Failed to add review', error: e);
      rethrow;
    }
  }
  
  /// Get reviews for a pull request
  Future<List<PullRequestReview>> getReviews(String pullRequestId, {
    String? reviewerId,
    String? state,
  }) async {
    try {
      List<PullRequestReview> filtered = _reviews.where(
        (review) => review.pullRequestId == pullRequestId
      ).toList();
      
      if (reviewerId != null) {
        filtered = filtered.where((review) => review.reviewerId == reviewerId).toList();
      }
      
      if (state != null) {
        filtered = filtered.where((review) => review.state == state).toList();
      }
      
      return filtered;
    } catch (e) {
      _logger.error('Failed to get reviews', error: e);
      rethrow;
    }
  }
  
  /// Get diff for a pull request
  Future<List<GitDiff>> getDiff(String pullRequestId) async {
    try {
      final pr = await getPullRequest(pullRequestId);
      if (pr == null) {
        throw Exception('Pull request not found');
      }
      
      final sourceRepo = await _repositoryManager.getRepository(pr.sourceRepositoryId);
      final targetRepo = await _repositoryManager.getRepository(pr.targetRepositoryId);
      
      if (sourceRepo == null || targetRepo == null) {
        throw Exception('Repository not found');
      }
      
      // For web repositories, return mock diff
      if (sourceRepo.isWebMock || targetRepo.isWebMock ||
          sourceRepo.isWebReal || targetRepo.isWebReal) {
        return [
          GitDiff(
            file: 'README.md',
            status: 'modified',
            additions: 5,
            deletions: 2,
            hunks: [
              GitDiffHunk(
                oldStart: 1,
                oldLines: 3,
                newStart: 1,
                newLines: 6,
                lines: [
                  '+# Fork Demo',
                  ' This is a demo repository',
                  '-Old line removed',
                  '+New line added',
                  ' Some unchanged line',
                  '+Another new line',
                  '+And one more',
                ],
              ),
            ],
          ),
        ];
      }
      
      // If same repository, use local diff
      if (sourceRepo.id == targetRepo.id && sourceRepo.path != null) {
        return await _gitService.getDiffBetweenBranches(
          sourceRepo.path!,
          baseBranch: pr.targetBranch,
          compareBranch: pr.sourceBranch,
        );
      }
      
      // Cross-repository diff (more complex, would require fetching)
      // This would be implemented in a real application
      // For now, return a mock diff
      return [
        GitDiff(
          file: 'src/main.dart',
          status: 'modified',
          additions: 10,
          deletions: 5,
          hunks: [
            GitDiffHunk(
              oldStart: 10,
              oldLines: 7,
              newStart: 10,
              newLines: 12,
              lines: [
                ' import "package:flutter/material.dart";',
                '-void main() {',
                '-  runApp(MyApp());',
                '+Future<void> main() async {',
                '+  await initializeApp();',
                '+  runApp(MyApp());',
                ' }',
                ' ',
                '-class MyApp extends StatelessWidget {',
                '+class MyApp extends StatefulWidget {',
                '+  @override',
                '+  _MyAppState createState() => _MyAppState();',
                '+}',
                '+',
                '+class _MyAppState extends State<MyApp> {',
                ' @override',
                ' Widget build(BuildContext context) {',
              ],
            ),
          ],
        ),
      ];
    } catch (e) {
      _logger.error('Failed to get diff for pull request', error: e);
      rethrow;
    }
  }
  
  /// Get commits for a pull request
  Future<List<GitCommit>> getCommits(String pullRequestId) async {
    try {
      final pr = await getPullRequest(pullRequestId);
      if (pr == null) {
        throw Exception('Pull request not found');
      }
      
      final sourceRepo = await _repositoryManager.getRepository(pr.sourceRepositoryId);
      final targetRepo = await _repositoryManager.getRepository(pr.targetRepositoryId);
      
      if (sourceRepo == null || targetRepo == null) {
        throw Exception('Repository not found');
      }
      
      // For web repositories, return mock commits
      if (sourceRepo.isWebMock || targetRepo.isWebMock ||
          sourceRepo.isWebReal || targetRepo.isWebReal) {
        final now = DateTime.now();
        return [
          GitCommit(
            sha: 'web-mock-commit-${DateTime.now().millisecondsSinceEpoch}',
            parentShas: ['parent-hash-mock'],
            author: 'Web User',
            email: 'web.user@example.com',
            message: 'Update README.md with project information',
            date: now.subtract(const Duration(days: 1)),
            stats: {
              'fileChanges': 1,
              'insertions': 5,
              'deletions': 2,
            },
          ),
        ];
      }
      
      // If same repository, get commits between branches
      if (sourceRepo.id == targetRepo.id && sourceRepo.path != null) {
        return await _gitService.getCommitsBetweenBranches(
          sourceRepo.path!,
          baseBranch: pr.targetBranch,
          compareBranch: pr.sourceBranch,
        );
      }
      
      // Cross-repository commits
      // This would be implemented in a real application
      // For now, return mock commits
      final now = DateTime.now();
      return [
        GitCommit(
          sha: 'mock-commit-1',
          parentShas: ['parent-hash-1'],
          author: 'Mock User',
          email: 'mock.user@example.com',
          message: 'Fix bug in main.dart',
          date: now.subtract(const Duration(days: 2)),
          stats: {
            'fileChanges': 1,
            'insertions': 10,
            'deletions': 5,
          },
        ),
        GitCommit(
          sha: 'mock-commit-2',
          parentShas: ['mock-commit-1'],
          author: 'Mock User',
          email: 'mock.user@example.com',
          message: 'Add new feature',
          date: now.subtract(const Duration(days: 1)),
          stats: {
            'fileChanges': 3,
            'insertions': 25,
            'deletions': 8,
          },
        ),
      ];
    } catch (e) {
      _logger.error('Failed to get commits for pull request', error: e);
      rethrow;
    }
  }
  
  /// Update PR stats (commits count, conflicts, etc.)
  Future<PullRequest?> _updatePullRequestStats(String pullRequestId) async {
    try {
      final pr = await getPullRequest(pullRequestId);
      if (pr == null) {
        return null;
      }
      
      final sourceRepo = await _repositoryManager.getRepository(pr.sourceRepositoryId);
      final targetRepo = await _repositoryManager.getRepository(pr.targetRepositoryId);
      
      if (sourceRepo == null || targetRepo == null) {
        return pr;
      }
      
      // For web repositories, return as is
      if (sourceRepo.isWebMock || targetRepo.isWebMock ||
          sourceRepo.isWebReal || targetRepo.isWebReal) {
        return pr;
      }
      
      int commitsCount = 0;
      bool hasConflicts = false;
      bool mergeable = true;
      
      // If same repository, get real stats
      if (sourceRepo.id == targetRepo.id && sourceRepo.path != null) {
        try {
          // Get commits count
          final commits = await _gitService.getCommitsBetweenBranches(
            sourceRepo.path!,
            baseBranch: pr.targetBranch,
            compareBranch: pr.sourceBranch,
          );
          commitsCount = commits.length;
          
          // Check for conflicts
          hasConflicts = await _gitService.hasMergeConflicts(
            sourceRepo.path!,
            sourceBranch: pr.sourceBranch,
            targetBranch: pr.targetBranch,
          );
          mergeable = !hasConflicts;
        } catch (e) {
          _logger.error('Error calculating PR stats', error: e);
          return pr;
        }
      }
      
      // Update PR with stats
      final updatedPR = pr.copyWith(
        commitsCount: commitsCount,
        hasConflicts: hasConflicts,
        mergeable: mergeable,
      );
      await updatePullRequest(updatedPR);
      
      return updatedPR;
    } catch (e) {
      _logger.error('Failed to update pull request stats', error: e);
      return null;
    }
  }
}