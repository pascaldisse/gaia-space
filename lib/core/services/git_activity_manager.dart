import 'dart:async';
import 'package:equatable/equatable.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:uuid/uuid.dart';

enum GitActivityStatus { running, completed, failed, cancelled }

class GitActivity extends Equatable {
  final String id;
  final String action;
  final String repositoryId;
  final DateTime startTime;
  final DateTime? endTime;
  final GitActivityStatus status;
  final String? output;
  final String? error;
  final double? progress;

  const GitActivity({
    required this.id,
    required this.action,
    required this.repositoryId,
    required this.startTime,
    this.endTime,
    required this.status,
    this.output,
    this.error,
    this.progress,
  });

  GitActivity copyWith({
    String? id,
    String? action,
    String? repositoryId,
    DateTime? startTime,
    DateTime? endTime,
    GitActivityStatus? status,
    String? output,
    String? error,
    double? progress,
  }) {
    return GitActivity(
      id: id ?? this.id,
      action: action ?? this.action,
      repositoryId: repositoryId ?? this.repositoryId,
      startTime: startTime ?? this.startTime,
      endTime: endTime ?? this.endTime,
      status: status ?? this.status,
      output: output ?? this.output,
      error: error ?? this.error,
      progress: progress ?? this.progress,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'action': action,
      'repositoryId': repositoryId,
      'startTime': startTime.toIso8601String(),
      'endTime': endTime?.toIso8601String(),
      'status': status.toString().split('.').last,
      'output': output,
      'error': error,
      'progress': progress,
    };
  }

  factory GitActivity.fromJson(Map<String, dynamic> json) {
    return GitActivity(
      id: json['id'],
      action: json['action'],
      repositoryId: json['repositoryId'],
      startTime: DateTime.parse(json['startTime']),
      endTime: json['endTime'] != null ? DateTime.parse(json['endTime']) : null,
      status: GitActivityStatus.values.firstWhere(
        (e) => e.toString().split('.').last == json['status'],
        orElse: () => GitActivityStatus.running,
      ),
      output: json['output'],
      error: json['error'],
      progress: json['progress'],
    );
  }

  @override
  List<Object?> get props => [id, action, repositoryId, startTime, endTime, status, output, error, progress];
}

class GitActivityManager {
  static final GitActivityManager _instance = GitActivityManager._internal();
  factory GitActivityManager() => _instance;
  
  final AppLogger _logger = AppLogger('GitActivityManager');
  final List<GitActivity> _activities = [];
  
  // Stream controllers for live updates
  final _activityStreamController = StreamController<List<GitActivity>>.broadcast();
  
  Stream<List<GitActivity>> get activityStream => _activityStreamController.stream;
  
  GitActivityManager._internal();
  
  // Activity management
  List<GitActivity> getActivities({String? repositoryId}) {
    if (repositoryId != null) {
      return _activities.where((activity) => activity.repositoryId == repositoryId).toList();
    }
    return List.of(_activities); // Return a copy to prevent external modification
  }
  
  GitActivity startActivity({
    required String action,
    required String repositoryId,
  }) {
    final activity = GitActivity(
      id: const Uuid().v4(),
      action: action,
      repositoryId: repositoryId,
      startTime: DateTime.now(),
      status: GitActivityStatus.running,
    );
    
    _activities.add(activity);
    _notifyListeners();
    
    return activity;
  }
  
  void updateActivity({
    required String id,
    GitActivityStatus? status,
    String? output,
    String? error,
    double? progress,
  }) {
    try {
      final index = _activities.indexWhere((activity) => activity.id == id);
      if (index >= 0) {
        final activity = _activities[index];
        
        _activities[index] = GitActivity(
          id: activity.id,
          action: activity.action,
          repositoryId: activity.repositoryId,
          startTime: activity.startTime,
          endTime: status != null && status != GitActivityStatus.running ? DateTime.now() : activity.endTime,
          status: status ?? activity.status,
          output: output != null ? (activity.output ?? '') + output : activity.output,
          error: error ?? activity.error,
          progress: progress ?? activity.progress,
        );
        
        _notifyListeners();
      }
    } catch (e) {
      _logger.error('Failed to update activity', error: e);
    }
  }
  
  void completeActivity(String id, {String? output, String? error}) {
    updateActivity(
      id: id,
      status: error != null ? GitActivityStatus.failed : GitActivityStatus.completed,
      output: output,
      error: error,
    );
  }
  
  void cancelActivity(String id, {String? reason}) {
    updateActivity(
      id: id,
      status: GitActivityStatus.cancelled,
      error: reason,
    );
  }
  
  void clearCompletedActivities({String? repositoryId}) {
    if (repositoryId != null) {
      _activities.removeWhere((activity) => 
        activity.repositoryId == repositoryId && 
        activity.status != GitActivityStatus.running);
    } else {
      _activities.removeWhere((activity) => activity.status != GitActivityStatus.running);
    }
    
    _notifyListeners();
  }
  
  void _notifyListeners() {
    if (!_activityStreamController.isClosed) {
      _activityStreamController.add(List.of(_activities));
    }
  }
  
  void dispose() {
    _activityStreamController.close();
  }

  // Helper method to execute Git operations as activities
  Future<T> executeWithActivity<T>({
    required String action,
    required String repositoryId,
    required Future<T> Function() operation,
  }) async {
    final activity = startActivity(
      action: action,
      repositoryId: repositoryId,
    );
    
    try {
      final result = await operation();
      completeActivity(activity.id, output: 'Operation completed successfully');
      return result;
    } catch (e) {
      _logger.error('Failed to execute $action', error: e);
      completeActivity(activity.id, error: e.toString());
      rethrow;
    }
  }
}