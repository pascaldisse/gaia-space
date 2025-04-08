import 'dart:io';
import 'dart:async';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/utils/app_logger.dart';

/// A service for measuring repository performance metrics
class RepositoryBenchmarkService {
  static final RepositoryBenchmarkService _instance = RepositoryBenchmarkService._internal();
  factory RepositoryBenchmarkService() => _instance;
  
  final AppLogger _logger = AppLogger('RepoBenchmark');
  
  RepositoryBenchmarkService._internal();
  
  /// Run all benchmarks on a repository
  Future<RepositoryBenchmarkResult> benchmarkRepository(GitRepository repository) async {
    if (repository.path == null) {
      throw Exception('Repository path is null');
    }
    
    _logger.info('Running benchmarks on repository: ${repository.name}');
    
    final stopwatch = Stopwatch()..start();
    
    try {
      // Run all benchmarks
      final statusTime = await _benchmarkGitStatus(repository.path!);
      final logTime = await _benchmarkGitLog(repository.path!);
      final countObjectsTime = await _benchmarkGitCountObjects(repository.path!);
      final branchTime = await _benchmarkGitBranch(repository.path!);
      final fsckTime = await _benchmarkGitFsck(repository.path!);
      final sizeStats = await _calculateRepoSize(repository.path!);
      
      stopwatch.stop();
      _logger.info('Benchmarks completed in ${stopwatch.elapsedMilliseconds}ms');
      
      return RepositoryBenchmarkResult(
        repositoryId: repository.id,
        benchmarkDate: DateTime.now(),
        gitStatusTime: statusTime,
        gitLogTime: logTime,
        gitCountObjectsTime: countObjectsTime,
        gitBranchTime: branchTime,
        gitFsckTime: fsckTime,
        totalObjects: sizeStats.objectCount,
        diskSize: sizeStats.diskSize,
        packSize: sizeStats.packSize,
        totalTime: stopwatch.elapsedMilliseconds,
      );
    } catch (e) {
      _logger.error('Error benchmarking repository', error: e);
      rethrow;
    }
  }
  
  /// Benchmark git status operation
  Future<int> _benchmarkGitStatus(String repoPath) async {
    _logger.debug('Benchmarking git status');
    
    final stopwatch = Stopwatch()..start();
    final result = await Process.run('git', ['status'], workingDirectory: repoPath);
    stopwatch.stop();
    
    if (result.exitCode != 0) {
      _logger.warning('Git status failed: ${result.stderr}');
    }
    
    return stopwatch.elapsedMilliseconds;
  }
  
  /// Benchmark git log operation
  Future<int> _benchmarkGitLog(String repoPath) async {
    _logger.debug('Benchmarking git log');
    
    final stopwatch = Stopwatch()..start();
    final result = await Process.run('git', ['log', '-n', '100', '--oneline'], workingDirectory: repoPath);
    stopwatch.stop();
    
    if (result.exitCode != 0) {
      _logger.warning('Git log failed: ${result.stderr}');
    }
    
    return stopwatch.elapsedMilliseconds;
  }
  
  /// Benchmark git branch operation
  Future<int> _benchmarkGitBranch(String repoPath) async {
    _logger.debug('Benchmarking git branch');
    
    final stopwatch = Stopwatch()..start();
    final result = await Process.run('git', ['branch', '-a'], workingDirectory: repoPath);
    stopwatch.stop();
    
    if (result.exitCode != 0) {
      _logger.warning('Git branch failed: ${result.stderr}');
    }
    
    return stopwatch.elapsedMilliseconds;
  }
  
  /// Benchmark git count-objects operation
  Future<int> _benchmarkGitCountObjects(String repoPath) async {
    _logger.debug('Benchmarking git count-objects');
    
    final stopwatch = Stopwatch()..start();
    final result = await Process.run('git', ['count-objects', '-v'], workingDirectory: repoPath);
    stopwatch.stop();
    
    if (result.exitCode != 0) {
      _logger.warning('Git count-objects failed: ${result.stderr}');
    }
    
    return stopwatch.elapsedMilliseconds;
  }
  
  /// Benchmark git fsck operation
  Future<int> _benchmarkGitFsck(String repoPath) async {
    _logger.debug('Benchmarking git fsck');
    
    final stopwatch = Stopwatch()..start();
    final result = await Process.run('git', ['fsck'], workingDirectory: repoPath);
    stopwatch.stop();
    
    if (result.exitCode != 0) {
      _logger.warning('Git fsck failed: ${result.stderr}');
    }
    
    return stopwatch.elapsedMilliseconds;
  }
  
  /// Calculate repository size metrics
  Future<RepositorySizeStats> _calculateRepoSize(String repoPath) async {
    _logger.debug('Calculating repository size');
    
    try {
      // Get object count and sizes using git count-objects
      final result = await Process.run('git', ['count-objects', '-v'], workingDirectory: repoPath);
      
      if (result.exitCode != 0) {
        _logger.warning('Git count-objects failed: ${result.stderr}');
        return RepositorySizeStats(
          objectCount: 0,
          diskSize: 0,
          packSize: 0,
        );
      }
      
      final output = result.stdout.toString();
      final lines = output.split('\n');
      
      int objectCount = 0;
      int diskSize = 0;
      int packSize = 0;
      
      for (final line in lines) {
        if (line.startsWith('count:')) {
          objectCount = int.tryParse(line.split(':')[1].trim()) ?? 0;
        } else if (line.startsWith('size:')) {
          diskSize = int.tryParse(line.split(':')[1].trim()) ?? 0;
        } else if (line.startsWith('size-pack:')) {
          packSize = int.tryParse(line.split(':')[1].trim()) ?? 0;
        }
      }
      
      return RepositorySizeStats(
        objectCount: objectCount,
        diskSize: diskSize * 1024, // Convert from KB to bytes
        packSize: packSize * 1024, // Convert from KB to bytes
      );
    } catch (e) {
      _logger.error('Error calculating repository size', error: e);
      return RepositorySizeStats(
        objectCount: 0,
        diskSize: 0,
        packSize: 0,
      );
    }
  }
  
  /// Generate optimization recommendations based on benchmark results
  List<OptimizationRecommendation> generateRecommendations(RepositoryBenchmarkResult result) {
    final recommendations = <OptimizationRecommendation>[];
    
    // Check for slow git status
    if (result.gitStatusTime > 500) {
      recommendations.add(OptimizationRecommendation(
        title: 'Slow git status',
        description: 'Consider running "git gc" to optimize repository objects',
        command: 'git gc',
        severity: RecommendationSeverity.medium,
      ));
    }
    
    // Check repository size
    if (result.diskSize > 100 * 1024 * 1024) { // > 100 MB
      recommendations.add(OptimizationRecommendation(
        title: 'Large repository size',
        description: 'Consider using Git LFS for large files or cleaning history with BFG/git-filter-branch',
        command: '',
        severity: RecommendationSeverity.high,
      ));
    }
    
    // Check for many objects
    if (result.totalObjects > 10000) {
      recommendations.add(OptimizationRecommendation(
        title: 'High object count',
        description: 'Run git repack to optimize object storage',
        command: 'git repack -a -d -f',
        severity: RecommendationSeverity.medium,
      ));
    }
    
    // Add general recommendation for slow repositories
    if (result.gitStatusTime > 200 ||
        result.gitLogTime > 500 ||
        result.gitBranchTime > 100) {
      recommendations.add(OptimizationRecommendation(
        title: 'General performance optimization',
        description: 'Run git maintenance to improve repository performance',
        command: 'git maintenance start',
        severity: RecommendationSeverity.low,
      ));
    }
    
    return recommendations;
  }
}

/// Repository size information
class RepositorySizeStats {
  final int objectCount;
  final int diskSize;
  final int packSize;
  
  RepositorySizeStats({
    required this.objectCount,
    required this.diskSize,
    required this.packSize,
  });
}

/// Results of repository benchmarking
class RepositoryBenchmarkResult {
  final String repositoryId;
  final DateTime benchmarkDate;
  final int gitStatusTime;
  final int gitLogTime;
  final int gitCountObjectsTime;
  final int gitBranchTime;
  final int gitFsckTime;
  final int totalObjects;
  final int diskSize;
  final int packSize;
  final int totalTime;
  
  RepositoryBenchmarkResult({
    required this.repositoryId,
    required this.benchmarkDate,
    required this.gitStatusTime,
    required this.gitLogTime,
    required this.gitCountObjectsTime,
    required this.gitBranchTime,
    required this.gitFsckTime,
    required this.totalObjects,
    required this.diskSize,
    required this.packSize,
    required this.totalTime,
  });
  
  // Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'repositoryId': repositoryId,
      'benchmarkDate': benchmarkDate.toIso8601String(),
      'gitStatusTime': gitStatusTime,
      'gitLogTime': gitLogTime,
      'gitCountObjectsTime': gitCountObjectsTime,
      'gitBranchTime': gitBranchTime,
      'gitFsckTime': gitFsckTime,
      'totalObjects': totalObjects,
      'diskSize': diskSize,
      'packSize': packSize,
      'totalTime': totalTime,
    };
  }
  
  // Create from JSON
  factory RepositoryBenchmarkResult.fromJson(Map<String, dynamic> json) {
    return RepositoryBenchmarkResult(
      repositoryId: json['repositoryId'],
      benchmarkDate: DateTime.parse(json['benchmarkDate']),
      gitStatusTime: json['gitStatusTime'],
      gitLogTime: json['gitLogTime'],
      gitCountObjectsTime: json['gitCountObjectsTime'],
      gitBranchTime: json['gitBranchTime'],
      gitFsckTime: json['gitFsckTime'],
      totalObjects: json['totalObjects'],
      diskSize: json['diskSize'],
      packSize: json['packSize'],
      totalTime: json['totalTime'],
    );
  }
}

/// Optimization recommendation
class OptimizationRecommendation {
  final String title;
  final String description;
  final String command;
  final RecommendationSeverity severity;
  
  OptimizationRecommendation({
    required this.title,
    required this.description,
    required this.command,
    required this.severity,
  });
}

/// Severity of a recommendation
enum RecommendationSeverity {
  low,
  medium,
  high,
}