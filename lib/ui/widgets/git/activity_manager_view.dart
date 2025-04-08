import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/services/git_activity_manager.dart';

class ActivityManagerView extends ConsumerWidget {
  final String? repositoryId;
  final bool showCompleted;
  final double maxHeight;
  
  const ActivityManagerView({
    Key? key,
    this.repositoryId,
    this.showCompleted = true,
    this.maxHeight = 200.0,
  }) : super(key: key);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Use a StreamProvider to get activities
    final activitiesProvider = StreamProvider<List<GitActivity>>((ref) {
      final activityManager = GitActivityManager();
      return activityManager.activityStream;
    });
    
    final activitiesAsyncValue = ref.watch(activitiesProvider);
    
    return activitiesAsyncValue.when(
      data: (activities) {
        // Filter activities
        final filteredActivities = activities.where((activity) {
          // Filter by repository
          if (repositoryId != null && activity.repositoryId != repositoryId) {
            return false;
          }
          
          // Filter by status
          if (!showCompleted && activity.status != GitActivityStatus.running) {
            return false;
          }
          
          return true;
        }).toList();
        
        if (filteredActivities.isEmpty) {
          return Container(
            padding: const EdgeInsets.all(16),
            child: Center(
              child: Text(
                'No activities',
                style: TextStyle(
                  color: Theme.of(context).textTheme.bodySmall?.color,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ),
          );
        }
        
        return Container(
          constraints: BoxConstraints(
            maxHeight: maxHeight,
          ),
          child: ListView.builder(
            itemCount: filteredActivities.length,
            itemBuilder: (context, index) {
              return _buildActivityItem(context, filteredActivities[index]);
            },
          ),
        );
      },
      loading: () => const Center(
        child: CircularProgressIndicator(),
      ),
      error: (error, stackTrace) => Center(
        child: Text('Error: $error'),
      ),
    );
  }
  
  Widget _buildActivityItem(BuildContext context, GitActivity activity) {
    // Choose icon and color based on status
    IconData icon;
    Color color;
    
    switch (activity.status) {
      case GitActivityStatus.running:
        icon = Icons.hourglass_top;
        color = Colors.blue;
        break;
      case GitActivityStatus.completed:
        icon = Icons.check_circle;
        color = Colors.green;
        break;
      case GitActivityStatus.failed:
        icon = Icons.error;
        color = Colors.red;
        break;
      case GitActivityStatus.cancelled:
        icon = Icons.cancel;
        color = Colors.orange;
        break;
    }
    
    return ExpansionTile(
      leading: Icon(
        icon,
        color: color,
      ),
      title: Text(
        activity.action,
        style: TextStyle(
          fontWeight: activity.status == GitActivityStatus.running 
              ? FontWeight.bold 
              : FontWeight.normal,
        ),
      ),
      subtitle: Text(
        _formatTime(activity.startTime, activity.endTime),
        style: Theme.of(context).textTheme.bodySmall,
      ),
      trailing: activity.status == GitActivityStatus.running
          ? SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                value: activity.progress,
              ),
            )
          : null,
      children: [
        // Output
        if (activity.output != null && activity.output!.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(16),
            width: double.infinity,
            decoration: BoxDecoration(
              color: Theme.of(context).brightness == Brightness.dark
                  ? Colors.grey.shade900
                  : Colors.grey.shade200,
              borderRadius: BorderRadius.circular(4),
            ),
            margin: const EdgeInsets.all(16),
            child: Text(
              activity.output!,
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                color: Theme.of(context).textTheme.bodyMedium?.color,
              ),
            ),
          ),
        
        // Error message
        if (activity.error != null && activity.error!.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(16),
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.red.withOpacity(0.1),
              borderRadius: BorderRadius.circular(4),
              border: Border.all(
                color: Colors.red.withOpacity(0.3),
              ),
            ),
            margin: const EdgeInsets.all(16),
            child: Text(
              activity.error!,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                color: Colors.red,
              ),
            ),
          ),
      ],
    );
  }
  
  String _formatTime(DateTime startTime, DateTime? endTime) {
    final start = '${startTime.hour}:${startTime.minute.toString().padLeft(2, '0')}';
    
    if (endTime == null) {
      return 'Started $start';
    }
    
    final duration = endTime.difference(startTime);
    String durationStr;
    
    if (duration.inMinutes < 1) {
      durationStr = '${duration.inSeconds}s';
    } else if (duration.inHours < 1) {
      durationStr = '${duration.inMinutes}m ${duration.inSeconds % 60}s';
    } else {
      durationStr = '${duration.inHours}h ${duration.inMinutes % 60}m';
    }
    
    return 'Completed in $durationStr';
  }
}