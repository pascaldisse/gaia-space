import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/project.dart';
import 'package:gaia_space/core/services/avatar_service/avatar_service.dart';
import 'package:gaia_space/ui/widgets/empty_state.dart';
import 'package:uuid/uuid.dart';
import 'package:drag_and_drop_lists/drag_and_drop_lists.dart';
import 'package:flutter_colorpicker/flutter_colorpicker.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart' as url_launcher;

// Task state notifier
class TaskNotifier extends StateNotifier<List<Task>> {
  TaskNotifier() : super([]) {
    _loadTasks();
  }

  Future<void> _loadTasks() async {
    // Simulate API call
    await Future.delayed(const Duration(seconds: 1));
    
    state = _mockTasks;
  }

  void updateTask(Task updatedTask) {
    state = state.map((task) => 
      task.id == updatedTask.id ? updatedTask : task
    ).toList();
  }

  void updateTaskStatus(String taskId, TaskStatus newStatus) {
    state = state.map((task) => 
      task.id == taskId ? task.copyWith(status: newStatus) : task
    ).toList();
  }

  void addSubTask(String taskId, String title) {
    final task = state.firstWhere((p) => p.id == taskId);
    final newSubTask = SubTask(
      id: const Uuid().v4(),
      title: title,
    );
    
    final updatedSubTasks = [...task.subTasks, newSubTask];
    updateTask(task.copyWith(subTasks: updatedSubTasks));
  }

  void toggleSubTaskCompletion(String taskId, String subTaskId) {
    final task = state.firstWhere((p) => p.id == taskId);
    final updatedSubTasks = task.subTasks.map((subtask) => 
      subtask.id == subTaskId ? subtask.copyWith(isCompleted: !subtask.isCompleted) : subtask
    ).toList();
    
    updateTask(task.copyWith(subTasks: updatedSubTasks));
  }

  void addAssignee(String taskId, TaskRole assignee) {
    final task = state.firstWhere((p) => p.id == taskId);
    final updatedAssignees = [...task.assignees, assignee];
    
    updateTask(task.copyWith(assignees: updatedAssignees));
  }

  void addGitReference(String taskId, GitReference reference) {
    final task = state.firstWhere((p) => p.id == taskId);
    final updatedReferences = [...task.gitReferences, reference];
    
    updateTask(task.copyWith(gitReferences: updatedReferences));
  }

  void updateTaskNotes(String taskId, String notes) {
    final task = state.firstWhere((p) => p.id == taskId);
    updateTask(task.copyWith(notes: notes));
  }

  void reorderTasks(List<Task> newOrder) {
    state = newOrder;
  }
}

// Tasks provider
final tasksProvider = StateNotifierProvider<TaskNotifier, List<Task>>((ref) {
  return TaskNotifier();
});

// Mock data
final _mockTasks = [
  Task(
    id: '1',
    name: 'Mobile App Redesign',
    description: 'Redesign the mobile app UI/UX for better usability and performance',
    workspaceId: '1',
    projectId: 'proj1',
    createdBy: 'User1',
    createdAt: DateTime.now().subtract(const Duration(days: 15)),
    dueDate: DateTime.now().add(const Duration(days: 30)),
    status: TaskStatus.inProgress,
    assignees: [
      TaskRole(
        id: '101',
        userId: 'user123',
        userName: 'Jane Smith',
        role: 'Designer',
        avatarUrl: 'https://i.pravatar.cc/150?img=1',
      ),
      TaskRole(
        id: '102',
        userId: 'user456',
        userName: 'Mike Johnson',
        role: 'Developer',
        avatarUrl: 'https://i.pravatar.cc/150?img=2',
      ),
    ],
    subTasks: [
      SubTask(
        id: '1001',
        title: 'Create wireframes',
        isCompleted: true,
        assignedTo: 'Jane Smith',
        dueDate: DateTime.now().add(const Duration(days: 5)),
      ),
      SubTask(
        id: '1002',
        title: 'Implement new navigation',
        isCompleted: false,
        assignedTo: 'Mike Johnson',
        dueDate: DateTime.now().add(const Duration(days: 12)),
      ),
      SubTask(
        id: '1003',
        title: 'User testing',
        isCompleted: false,
        assignedTo: 'Jane Smith',
        dueDate: DateTime.now().add(const Duration(days: 20)),
      ),
    ],
    gitReferences: [
      GitReference(
        id: 'git1',
        url: 'https://github.com/organization/mobile-app/pull/123',
        title: 'UI Redesign PR',
        branch: 'feature/ui-redesign',
        pullRequest: '123',
      ),
    ],
    notes: 'Focus on accessibility improvements and responsive design for tablets.',
    completionPercentage: 33.3,
    priority: 'High',
    order: 0,
  ),
  Task(
    id: '2',
    name: 'Backend API Migration',
    description: 'Migrate our APIs to the new infrastructure with improved security',
    workspaceId: '1',
    projectId: 'proj1',
    createdBy: 'User2',
    createdAt: DateTime.now().subtract(const Duration(days: 30)),
    dueDate: DateTime.now().add(const Duration(days: 15)),
    status: TaskStatus.inProgress,
    assignees: [
      TaskRole(
        id: '103',
        userId: 'user789',
        userName: 'Alex Chen',
        role: 'Backend Developer',
        avatarUrl: 'https://i.pravatar.cc/150?img=3',
      ),
    ],
    subTasks: [
      SubTask(
        id: '2001',
        title: 'Design new API endpoints',
        isCompleted: true,
        assignedTo: 'Alex Chen',
        dueDate: DateTime.now().subtract(const Duration(days: 5)),
      ),
      SubTask(
        id: '2002',
        title: 'Implement authentication changes',
        isCompleted: true,
        assignedTo: 'Alex Chen',
        dueDate: DateTime.now().subtract(const Duration(days: 1)),
      ),
      SubTask(
        id: '2003',
        title: 'Write data migration scripts',
        isCompleted: false,
        assignedTo: 'Alex Chen',
        dueDate: DateTime.now().add(const Duration(days: 5)),
      ),
      SubTask(
        id: '2004',
        title: 'Deploy to staging',
        isCompleted: false,
        assignedTo: 'Alex Chen',
        dueDate: DateTime.now().add(const Duration(days: 10)),
      ),
    ],
    gitReferences: [
      GitReference(
        id: 'git2',
        url: 'https://github.com/organization/backend/commit/abc123',
        title: 'Initial API refactoring',
        commitId: 'abc123',
        branch: 'main',
      ),
    ],
    notes: 'Need to coordinate with DevOps for deployment window. Security team needs to review changes.',
    completionPercentage: 50.0,
    priority: 'Critical',
    order: 1,
  ),
  Task(
    id: '3',
    name: 'Documentation Update',
    description: 'Update all product documentation for the new release',
    workspaceId: '2',
    projectId: 'proj2',
    createdBy: 'User1',
    createdAt: DateTime.now().subtract(const Duration(days: 10)),
    dueDate: DateTime.now().add(const Duration(days: 5)),
    status: TaskStatus.todo,
    assignees: [
      TaskRole(
        id: '104',
        userId: 'user101',
        userName: 'Sarah Lee',
        role: 'Technical Writer',
        avatarUrl: 'https://i.pravatar.cc/150?img=4',
      ),
    ],
    subTasks: [
      SubTask(
        id: '3001',
        title: 'Review existing docs',
        isCompleted: false,
        assignedTo: 'Sarah Lee',
        dueDate: DateTime.now().add(const Duration(days: 1)),
      ),
      SubTask(
        id: '3002',
        title: 'Update API reference',
        isCompleted: false,
        assignedTo: 'Sarah Lee',
        dueDate: DateTime.now().add(const Duration(days: 3)),
      ),
      SubTask(
        id: '3003',
        title: 'Create tutorial videos',
        isCompleted: false,
        assignedTo: 'Sarah Lee',
        dueDate: DateTime.now().add(const Duration(days: 5)),
      ),
    ],
    notes: 'Need to prioritize API changes documentation for external developers.',
    completionPercentage: 0.0,
    priority: 'Medium',
    order: 0,
  ),
  Task(
    id: '4',
    name: 'Performance Optimization',
    description: 'Optimize application performance for better user experience',
    workspaceId: '1',
    projectId: 'proj1',
    createdBy: 'User3',
    createdAt: DateTime.now().subtract(const Duration(days: 45)),
    dueDate: DateTime.now().subtract(const Duration(days: 10)),
    status: TaskStatus.completed,
    assignees: [
      TaskRole(
        id: '105',
        userId: 'user202',
        userName: 'David Kim',
        role: 'Full-stack Developer',
        avatarUrl: 'https://i.pravatar.cc/150?img=5',
      ),
    ],
    subTasks: [
      SubTask(
        id: '4001',
        title: 'Profile application performance',
        isCompleted: true,
        assignedTo: 'David Kim',
        dueDate: DateTime.now().subtract(const Duration(days: 30)),
      ),
      SubTask(
        id: '4002',
        title: 'Optimize database queries',
        isCompleted: true,
        assignedTo: 'David Kim',
        dueDate: DateTime.now().subtract(const Duration(days: 25)),
      ),
      SubTask(
        id: '4003',
        title: 'Implement caching',
        isCompleted: true,
        assignedTo: 'David Kim',
        dueDate: DateTime.now().subtract(const Duration(days: 20)),
      ),
      SubTask(
        id: '4004',
        title: 'Verify improvements',
        isCompleted: true,
        assignedTo: 'David Kim',
        dueDate: DateTime.now().subtract(const Duration(days: 15)),
      ),
    ],
    gitReferences: [
      GitReference(
        id: 'git3',
        url: 'https://github.com/organization/app/pull/89',
        title: 'Performance Improvements',
        pullRequest: '89',
        branch: 'feature/perf-improvements',
      ),
    ],
    completionPercentage: 100.0,
    priority: 'High',
    order: 0,
  ),
  Task(
    id: '5',
    name: 'Security Audit',
    description: 'Perform comprehensive security audit across all systems',
    workspaceId: '3',
    projectId: 'proj3',
    createdBy: 'User4',
    createdAt: DateTime.now().subtract(const Duration(days: 5)),
    dueDate: DateTime.now().add(const Duration(days: 25)),
    status: TaskStatus.todo,
    assignees: [
      TaskRole(
        id: '106',
        userId: 'user303',
        userName: 'Emma Wilson',
        role: 'Security Engineer',
        avatarUrl: 'https://i.pravatar.cc/150?img=6',
      ),
    ],
    subTasks: [
      SubTask(
        id: '5001',
        title: 'Set up security scanning tools',
        isCompleted: false,
        assignedTo: 'Emma Wilson',
        dueDate: DateTime.now().add(const Duration(days: 2)),
      ),
      SubTask(
        id: '5002',
        title: 'Review authentication system',
        isCompleted: false,
        assignedTo: 'Emma Wilson',
        dueDate: DateTime.now().add(const Duration(days: 10)),
      ),
      SubTask(
        id: '5003',
        title: 'Penetration testing',
        isCompleted: false,
        assignedTo: 'Emma Wilson',
        dueDate: DateTime.now().add(const Duration(days: 15)),
      ),
      SubTask(
        id: '5004',
        title: 'Document findings',
        isCompleted: false,
        assignedTo: 'Emma Wilson',
        dueDate: DateTime.now().add(const Duration(days: 20)),
      ),
    ],
    priority: 'High',
    order: 1,
  ),
];


// Task board view toggle
enum TaskViewType {
  kanban,
  list,
}

final taskViewTypeProvider = StateProvider<TaskViewType>((ref) {
  return TaskViewType.kanban;
});

class TaskScreen extends ConsumerStatefulWidget {
  const TaskScreen({super.key});

  @override
  ConsumerState<TaskScreen> createState() => _TaskScreenState();
}

class _TaskScreenState extends ConsumerState<TaskScreen> {
  late List<DragAndDropList> _kanbanLists;
  bool _isExpanded = false;
  
  @override
  Widget build(BuildContext context) {
    final tasks = ref.watch(tasksProvider);
    final viewType = ref.watch(taskViewTypeProvider);
    
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: const Text('Tasks'),
        actions: [
          IconButton(
            icon: Icon(viewType == TaskViewType.kanban ? Icons.view_list : Icons.dashboard),
            onPressed: () {
              ref.read(taskViewTypeProvider.notifier).state = 
                viewType == TaskViewType.kanban ? TaskViewType.list : TaskViewType.kanban;
            },
            tooltip: viewType == TaskViewType.kanban ? 'Switch to list view' : 'Switch to kanban view',
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              // Refresh tasks
              ref.invalidate(tasksProvider);
            },
            tooltip: 'Refresh tasks',
          ),
        ],
      ),
      body: tasks.isEmpty
          ? const EmptyState(
              icon: Icons.task_alt,
              title: 'No Tasks',
              message: 'Create your first task to get started',
              actionText: 'Create Task',
            )
          : viewType == TaskViewType.kanban
              ? _buildKanbanBoard(context, tasks)
              : _buildListView(context, tasks),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          // TODO: Implement task creation
          _showCreateTaskDialog(context);
        },
        tooltip: 'Create new task',
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildKanbanBoard(BuildContext context, List<Task> allTasks) {
    // Group tasks by status
    final Map<TaskStatus, List<Task>> groupedTasks = {
      TaskStatus.todo: [],
      TaskStatus.inProgress: [],
      TaskStatus.completed: [],
    };
    
    for (final task in allTasks) {
      groupedTasks[task.status]!.add(task);
    }
    
    // Sort each list by order property
    for (final status in groupedTasks.keys) {
      groupedTasks[status]!.sort((a, b) => 
        (a.order ?? 0).compareTo(b.order ?? 0)
      );
    }
    
    // Create DragAndDropLists
    _kanbanLists = [
      _buildKanbanList(context, 'To Do', groupedTasks[TaskStatus.todo]!, TaskStatus.todo),
      _buildKanbanList(context, 'In Progress', groupedTasks[TaskStatus.inProgress]!, TaskStatus.inProgress),
      _buildKanbanList(context, 'Completed', groupedTasks[TaskStatus.completed]!, TaskStatus.completed),
    ];
    
    // Use horizontal layout for the Kanban board
    return DragAndDropLists(
      children: _kanbanLists,
      onItemReorder: _onItemReorder,
      onListReorder: _onListReorder,
      axis: Axis.horizontal,
      listWidth: MediaQuery.of(context).size.width * 0.32,
      listDraggingWidth: MediaQuery.of(context).size.width * 0.32,
      listPadding: const EdgeInsets.all(8),
      listInnerDecoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 5.0,
            spreadRadius: 1.0,
          ),
        ],
      ),
      itemDivider: const Divider(height: 1, thickness: 1),
      itemDecorationWhileDragging: BoxDecoration(
        color: Theme.of(context).colorScheme.primary.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: Theme.of(context).colorScheme.primary,
          width: 2, 
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.3),
            blurRadius: 8.0,
            spreadRadius: 2.0,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      // We'll implement our own drag feedback
      itemDraggingWidth: MediaQuery.of(context).size.width * 0.32,
      disableScrolling: false,
      contentsWhenEmpty: const Center(
        child: Text('No projects in this category'),
      ),
      lastItemTargetHeight: 8,
      addLastItemTargetHeightToTop: true,
      lastListTargetSize: 8,
    );
  }
  
  DragAndDropList _buildKanbanList(
    BuildContext context, 
    String title, 
    List<Task> tasks,
    TaskStatus status,
  ) {
    final Color statusColor = _getStatusColor(context, status);
    
    return DragAndDropList(
      header: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
        decoration: BoxDecoration(
          color: statusColor.withOpacity(0.1),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
          border: Border.all(
            color: statusColor.withOpacity(0.2),
            width: 1,
          ),
        ),
        foregroundDecoration: BoxDecoration(
          border: Border(
            top: BorderSide(color: statusColor, width: 3),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Icon(_getIconForStatus(status), color: statusColor, size: 20),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: statusColor.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    '${tasks.length}',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: statusColor,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              title,
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: statusColor,
                fontSize: 16,
              ),
            ),
          ],
        ),
      ),
      children: tasks.isEmpty
          ? [
              DragAndDropItem(
                child: Container(
                  padding: const EdgeInsets.all(16),
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          _getIconForStatus(status),
                          size: 36,
                          color: Theme.of(context).disabledColor.withOpacity(0.3),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'No tasks',
                          style: TextStyle(
                            color: Theme.of(context).disabledColor,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Drag and drop tasks here',
                          style: TextStyle(
                            fontSize: 12,
                            color: Theme.of(context).disabledColor.withOpacity(0.7),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ]
          : tasks.map((task) {
              return DragAndDropItem(
                child: TaskCard(
                  task: task,
                  expanded: _isExpanded,
                  onTap: () => _showTaskDetailsDialog(context, task),
                  onStatusChange: (newStatus) {
                    ref.read(tasksProvider.notifier).updateTaskStatus(
                      task.id, 
                      newStatus,
                    );
                  },
                ),
              );
            }).toList(),
    );
  }

  Widget _buildListView(BuildContext context, List<Task> allTasks) {
    // Sort tasks by status
    final sortedTasks = List<Task>.from(allTasks)
      ..sort((a, b) {
        // First by status order (todo, inProgress, completed)
        final statusComparison = a.status.index.compareTo(b.status.index);
        if (statusComparison != 0) return statusComparison;
        
        // Then by order within status
        return (a.order ?? 0).compareTo(b.order ?? 0);
      });

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16.0),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '${allTasks.length} Tasks',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              TextButton.icon(
                icon: Icon(_isExpanded ? Icons.unfold_less : Icons.unfold_more),
                label: Text(_isExpanded ? 'Collapse All' : 'Expand All'),
                onPressed: () {
                  setState(() {
                    _isExpanded = !_isExpanded;
                  });
                },
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: sortedTasks.length,
            separatorBuilder: (context, index) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final task = sortedTasks[index];
              
              return TaskCard(
                task: task,
                expanded: _isExpanded,
                onTap: () => _showTaskDetailsDialog(context, task),
                onStatusChange: (newStatus) {
                  ref.read(tasksProvider.notifier).updateTaskStatus(
                    task.id, 
                    newStatus,
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }

  void _onItemReorder(
    int oldItemIndex, 
    int oldListIndex, 
    int newItemIndex, 
    int newListIndex,
  ) {
    setState(() {
      // Get the item that was dragged
      final movedItem = _kanbanLists[oldListIndex].children.removeAt(oldItemIndex);
      
      // Insert it into new place
      _kanbanLists[newListIndex].children.insert(newItemIndex, movedItem);
      
      // Update task status based on the list it was moved to
      final TaskStatus newStatus = _getStatusForListIndex(newListIndex);
      
      // Extract task card from the moved item
      final taskCard = movedItem.child as TaskCard;
      final Task task = taskCard.task;
      
      // First update status change
      if (task.status != newStatus) {
        ref.read(tasksProvider.notifier).updateTaskStatus(task.id, newStatus);
      }
      
      // Then update order for both lists if needed
      _updateProjectOrders(newListIndex);
      
      // Also update the original list if it's different from the target list
      if (oldListIndex != newListIndex) {
        _updateProjectOrders(oldListIndex);
      }
    });
    
    // Trigger a visual feedback
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Project moved successfully'),
        duration: const Duration(seconds: 1),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
        ),
      ),
    );
  }

  void _onListReorder(int oldListIndex, int newListIndex) {
    setState(() {
      final movedList = _kanbanLists.removeAt(oldListIndex);
      _kanbanLists.insert(newListIndex, movedList);
    });
  }

  TaskStatus _getStatusForListIndex(int index) {
    switch (index) {
      case 0:
        return TaskStatus.todo;
      case 1:
        return TaskStatus.inProgress;
      case 2:
        return TaskStatus.completed;
      default:
        return TaskStatus.todo;
    }
  }

  void _updateProjectOrders(int listIndex) {
    final status = _getStatusForListIndex(listIndex);
    final tasks = ref.read(tasksProvider);
    
    // Get all tasks of the given status
    final statusTasks = tasks.where((t) => t.status == status).toList();
    
    // Determine new order from the kanban list
    final List<String> newOrderIds = [];
    for (final item in _kanbanLists[listIndex].children) {
      final taskCard = item.child as TaskCard;
      newOrderIds.add(taskCard.task.id);
    }
    
    // Update order for each task
    for (int i = 0; i < statusTasks.length; i++) {
      final task = statusTasks[i];
      if (newOrderIds.contains(task.id)) {
        final newOrder = newOrderIds.indexOf(task.id);
        if (task.order != newOrder) {
          ref.read(tasksProvider.notifier).updateTask(
            task.copyWith(order: newOrder)
          );
        }
      }
    }
  }

  Color _getStatusColor(BuildContext context, TaskStatus status) {
    switch (status) {
      case TaskStatus.todo:
        return Colors.grey;
      case TaskStatus.inProgress:
        return Theme.of(context).primaryColor;
      case TaskStatus.completed:
        return Colors.green;
    }
  }

  IconData _getIconForStatus(TaskStatus status) {
    switch (status) {
      case TaskStatus.todo:
        return Icons.assignment;
      case TaskStatus.inProgress:
        return Icons.build;
      case TaskStatus.completed:
        return Icons.check_circle;
    }
  }

  void _showTaskDetailsDialog(BuildContext context, Task task) {
    showDialog(
      context: context,
      builder: (context) => TaskDetailsDialog(
        task: task,
        onUpdate: (updatedTask) {
          ref.read(tasksProvider.notifier).updateTask(updatedTask);
          Navigator.of(context).pop();
        },
      ),
    );
  }

  void _showCreateTaskDialog(BuildContext context) {
    // Implementation will be added later
    // This will show a dialog to create a new task
  }
}

class TaskCard extends StatelessWidget {
  final Task task;
  final bool expanded;
  final Function(TaskStatus) onStatusChange;
  final VoidCallback onTap;
  
  const TaskCard({
    super.key,
    required this.task,
    this.expanded = false,
    required this.onStatusChange,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: _getPriorityColor(task.priority).withOpacity(0.5),
          width: 1.5,
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header with priority and more options
            Container(
              decoration: BoxDecoration(
                color: _getPriorityColor(task.priority).withOpacity(0.05),
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(10)
                ),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      // Drag handle indicator
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: Icon(
                          Icons.drag_indicator,
                          size: 18,
                          color: Colors.grey.withOpacity(0.7),
                        ),
                      ),
                      _buildPriorityIndicator(context),
                    ],
                  ),
                  Row(
                    children: [
                      if (task.gitReferences.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: Tooltip(
                            message: '${task.gitReferences.length} git references',
                            child: Container(
                              padding: const EdgeInsets.all(4),
                              decoration: BoxDecoration(
                                color: Colors.blueGrey.withOpacity(0.1),
                                shape: BoxShape.circle,
                              ),
                              child: Icon(
                                Icons.code, 
                                size: 14,
                                color: Colors.blueGrey,
                              ),
                            ),
                          ),
                        ),
                      PopupMenuButton<TaskStatus>(
                        tooltip: 'Change status',
                        icon: const Icon(Icons.more_vert, size: 18),
                        padding: EdgeInsets.zero,
                        onSelected: onStatusChange,
                        itemBuilder: (context) => [
                          const PopupMenuItem(
                            value: TaskStatus.todo,
                            child: Row(
                              children: [
                                Icon(Icons.assignment, size: 18),
                                SizedBox(width: 8),
                                Text('Move to To Do'),
                              ],
                            ),
                          ),
                          const PopupMenuItem(
                            value: TaskStatus.inProgress,
                            child: Row(
                              children: [
                                Icon(Icons.build, size: 18),
                                SizedBox(width: 8),
                                Text('Move to In Progress'),
                              ],
                            ),
                          ),
                          const PopupMenuItem(
                            value: TaskStatus.completed,
                            child: Row(
                              children: [
                                Icon(Icons.check_circle, size: 18),
                                SizedBox(width: 8),
                                Text('Move to Completed'),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
            
            // Content
            Padding(
              padding: const EdgeInsets.all(12.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Title and description
                  Text(
                    task.name,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  if (task.description != null && task.description!.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      task.description!,
                      maxLines: expanded ? 5 : 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                  const SizedBox(height: 12),
                  
                  // Progress bar
                  if (task.completionPercentage != null) ...[
                    Row(
                      children: [
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: task.completionPercentage! / 100,
                              backgroundColor: Colors.grey.withOpacity(0.2),
                              minHeight: 6,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '${task.completionPercentage!.toInt()}%',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                  ],
                  
                  // Assignees (compact view)
                  if (task.assignees.isNotEmpty) ...[
                    Row(
                      children: [
                        const Icon(Icons.people_outline, size: 16, color: Colors.blueGrey),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Wrap(
                            spacing: -8, // Negative spacing for overlapping effect
                            children: task.assignees.take(3).map((assignee) => 
                              Tooltip(
                                message: '${assignee.userName} (${assignee.role})',
                                child: SizedBox(
                                  width: 24, 
                                  height: 24,
                                  child: AvatarService().avatarWidget(
                                    avatarUrl: assignee.avatarUrl, 
                                    name: assignee.userName,
                                    size: 24,
                                    backgroundColor: Theme.of(context).primaryColor,
                                  ),
                                ),
                              )
                            ).toList(),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                  ],
                  
                  // Expanded content
                  if (expanded) ...[
                    if (task.subTasks.isNotEmpty) ...[
                      const Divider(),
                      const SizedBox(height: 4),
                      Text(
                        'Subtasks (${task.subTasks.where((t) => t.isCompleted).length}/${task.subTasks.length})',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(height: 4),
                      ...task.subTasks.take(3).map((subtask) => _buildSubtaskItem(context, subtask)),
                      if (task.subTasks.length > 3)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            '+ ${task.subTasks.length - 3} more subtasks',
                            style: TextStyle(
                              fontSize: 12,
                              color: Theme.of(context).disabledColor,
                            ),
                          ),
                        ),
                      const SizedBox(height: 8),
                    ],
                    if (task.assignees.length > 3) ...[
                      const Divider(),
                      const SizedBox(height: 4),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.people_outline, size: 16),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: task.assignees.map((assignee) => _buildAssigneeChip(context, assignee)).toList(),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                    ],
                  ],
                  
                  // Footer with due date
                  _buildDueDate(context),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPriorityIndicator(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: _getPriorityColor(task.priority).withOpacity(0.1),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        task.priority ?? 'Normal',
        style: TextStyle(
          fontSize: 12,
          color: _getPriorityColor(task.priority),
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }
  
  Color _getPriorityColor(String? priority) {
    if (priority == null) return Colors.blue;
    
    switch (priority.toLowerCase()) {
      case 'critical':
        return Colors.red;
      case 'high':
        return Colors.orange;
      case 'medium':
        return Colors.blue;
      case 'low':
        return Colors.green;
      default:
        return Colors.blue;
    }
  }
  
  Widget _buildSubtaskItem(BuildContext context, SubTask task) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            task.isCompleted 
                ? Icons.check_box 
                : Icons.check_box_outline_blank,
            size: 16,
            color: task.isCompleted 
                ? Colors.green 
                : Theme.of(context).disabledColor,
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              task.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                decoration: task.isCompleted 
                    ? TextDecoration.lineThrough 
                    : null,
                color: task.isCompleted 
                    ? Theme.of(context).disabledColor
                    : Theme.of(context).textTheme.bodyMedium?.color,
              ),
            ),
          ),
          if (task.dueDate != null) ...[
            const SizedBox(width: 4),
            Text(
              DateFormat('MM/dd').format(task.dueDate!),
              style: TextStyle(
                fontSize: 11,
                color: task.dueDate!.isBefore(DateTime.now()) && !task.isCompleted
                    ? Colors.red
                    : Theme.of(context).disabledColor,
              ),
            ),
          ],
        ],
      ),
    );
  }
  
  Widget _buildAssigneeChip(BuildContext context, TaskRole assignee) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: Theme.of(context).primaryColor.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (assignee.avatarUrl != null) ...[
            AvatarService().avatarWidget(
              avatarUrl: assignee.avatarUrl,
              name: assignee.userName,
              size: 16,
              backgroundColor: Theme.of(context).primaryColor,
            ),
            const SizedBox(width: 4),
          ],
          Text(
            assignee.userName,
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).primaryColor,
            ),
          ),
          if (assignee.role.isNotEmpty) ...[
            const SizedBox(width: 4),
            Text(
              '(${assignee.role})',
              style: TextStyle(
                fontSize: 10,
                color: Theme.of(context).primaryColor.withOpacity(0.7),
              ),
            ),
          ],
        ],
      ),
    );
  }
  
  Widget _buildDueDate(BuildContext context) {
    final bool isOverdue = task.dueDate.isBefore(DateTime.now()) &&
        task.status != TaskStatus.completed;
    
    return Row(
      children: [
        Icon(
          isOverdue ? Icons.warning : Icons.event,
          size: 16,
          color: isOverdue ? Colors.red : Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
        ),
        const SizedBox(width: 4),
        Text(
          'Due ${_formatDueDate(task.dueDate)}',
          style: TextStyle(
            fontSize: 12,
            color: isOverdue ? Colors.red : Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
            fontWeight: isOverdue ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ],
    );
  }
  
  String _formatDueDate(DateTime date) {
    final now = DateTime.now();
    final difference = date.difference(now).inDays;
    
    if (difference < 0) {
      return '${-difference} day${-difference != 1 ? 's' : ''} ago';
    } else if (difference == 0) {
      return 'Today';
    } else if (difference == 1) {
      return 'Tomorrow';
    } else if (difference < 7) {
      return 'in $difference days';
    } else {
      return DateFormat('MMM d').format(date);
    }
  }
}

class TaskDetailsDialog extends StatefulWidget {
  final Task task;
  final Function(Task) onUpdate;

  const TaskDetailsDialog({
    super.key, 
    required this.task,
    required this.onUpdate,
  });

  @override
  State<TaskDetailsDialog> createState() => _TaskDetailsDialogState();
}

class _TaskDetailsDialogState extends State<TaskDetailsDialog> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  late TextEditingController _notesController;
  late Task _editedTask;
  late TextEditingController _newSubtaskController;
  late TextEditingController _newGitRefController;
  late TextEditingController _gitRefTitleController;
  
  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _notesController = TextEditingController(text: widget.task.notes);
    _editedTask = widget.task;
    _newSubtaskController = TextEditingController();
    _newGitRefController = TextEditingController();
    _gitRefTitleController = TextEditingController();
  }
  
  @override
  void dispose() {
    _tabController.dispose();
    _notesController.dispose();
    _newSubtaskController.dispose();
    _newGitRefController.dispose();
    _gitRefTitleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Container(
        width: MediaQuery.of(context).size.width * 0.8,
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    widget.task.name,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (widget.task.description != null && widget.task.description!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(
                  widget.task.description!,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.of(context).size.height * 0.6,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TabBar(
                    controller: _tabController,
                    tabs: const [
                      Tab(text: 'Details'),
                      Tab(text: 'Tasks'),
                      Tab(text: 'Notes'),
                      Tab(text: 'Git'),
                    ],
                  ),
                  Flexible(
                    child: TabBarView(
                      controller: _tabController,
                      children: [
                        SingleChildScrollView(
                          child: _buildDetailsTab(),
                        ),
                        SingleChildScrollView(
                          child: _buildTasksTab(),
                        ),
                        _buildNotesTab(),
                        SingleChildScrollView(
                          child: _buildGitTab(),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Cancel'),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: () {
                    // Save notes from the controller
                    final updatedTask = _editedTask.copyWith(
                      notes: _notesController.text,
                    );
                    widget.onUpdate(updatedTask);
                  },
                  child: const Text('Save Changes'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailsTab() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildDetailRow('Status', _getStatusText(_editedTask.status)),
          _buildDetailRow('Priority', _editedTask.priority ?? 'Not set'),
          _buildDetailRow('Due Date', DateFormat('MMMM d, yyyy').format(_editedTask.dueDate)),
          _buildDetailRow('Created by', _editedTask.createdBy),
          _buildDetailRow('Created on', DateFormat('MMMM d, yyyy').format(_editedTask.createdAt)),
          
          const SizedBox(height: 16),
          const Text(
            'Assignees',
            style: TextStyle(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          if (_editedTask.assignees.isEmpty)
            const Text('No assignees yet')
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _editedTask.assignees.map((assignee) {
                return Chip(
                  avatar: AvatarService().avatarWidget(
                    avatarUrl: assignee.avatarUrl,
                    name: assignee.userName,
                    size: 20,
                    backgroundColor: Theme.of(context).primaryColor,
                  ),
                  label: Text('${assignee.userName} (${assignee.role})'),
                  onDeleted: () {
                    setState(() {
                      final updatedAssignees = List<TaskRole>.from(_editedTask.assignees)
                        ..removeWhere((a) => a.id == assignee.id);
                      _editedTask = _editedTask.copyWith(assignees: updatedAssignees);
                    });
                  },
                );
              }).toList(),
            ),
          
          const SizedBox(height: 16),
          ElevatedButton.icon(
            icon: const Icon(Icons.add),
            label: const Text('Add Assignee'),
            onPressed: () {
              // Show add assignee dialog
            },
          ),
        ],
      ),
    );
  }

  Widget _buildTasksTab() {
    final completedTasks = _editedTask.subTasks.where((subtask) => subtask.isCompleted).length;
    final totalTasks = _editedTask.subTasks.length;
    final completionPercentage = totalTasks > 0 
        ? (completedTasks / totalTasks * 100).roundToDouble() 
        : 0.0;
    
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Progress indicator
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Progress: $completedTasks of $totalTasks tasks completed',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 4),
                    LinearProgressIndicator(
                      value: totalTasks > 0 ? completedTasks / totalTasks : 0,
                      minHeight: 8,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(context).primaryColor.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '${completionPercentage.toStringAsFixed(0)}%',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).primaryColor,
                  ),
                ),
              ),
            ],
          ),
          
          const SizedBox(height: 16),
          const Text(
            'Tasks',
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 8),
          
          // Tasks list
          if (_editedTask.subTasks.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(
                child: Text('No subtasks added yet'),
              ),
            )
          else
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _editedTask.subTasks.length,
              itemBuilder: (context, index) {
                final subtask = _editedTask.subTasks[index];
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Checkbox(
                    value: subtask.isCompleted,
                    onChanged: (value) {
                      setState(() {
                        final updatedSubTasks = List<SubTask>.from(_editedTask.subTasks);
                        updatedSubTasks[index] = subtask.copyWith(isCompleted: value ?? false);
                        _editedTask = _editedTask.copyWith(
                          subTasks: updatedSubTasks,
                          completionPercentage: updatedSubTasks.where((t) => t.isCompleted).length / updatedSubTasks.length * 100,
                        );
                      });
                    },
                  ),
                  title: Text(
                    subtask.title,
                    style: TextStyle(
                      decoration: subtask.isCompleted ? TextDecoration.lineThrough : null,
                    ),
                  ),
                  subtitle: subtask.dueDate != null 
                      ? Text('Due: ${DateFormat('MMM d, yyyy').format(subtask.dueDate!)}')
                      : null,
                  trailing: IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () {
                      setState(() {
                        final updatedSubTasks = List<SubTask>.from(_editedTask.subTasks)
                          ..removeAt(index);
                        _editedTask = _editedTask.copyWith(
                          subTasks: updatedSubTasks,
                          completionPercentage: updatedSubTasks.isEmpty 
                              ? 0 
                              : updatedSubTasks.where((t) => t.isCompleted).length / updatedSubTasks.length * 100,
                        );
                      });
                    },
                  ),
                );
              },
            ),
          
          const SizedBox(height: 16),
          // Add task form
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _newSubtaskController,
                  decoration: const InputDecoration(
                    hintText: 'Add a new task...',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                icon: const Icon(Icons.add_circle),
                onPressed: () {
                  if (_newSubtaskController.text.trim().isNotEmpty) {
                    setState(() {
                      final newSubTask = SubTask(
                        id: const Uuid().v4(),
                        title: _newSubtaskController.text.trim(),
                      );
                      final updatedSubTasks = List<SubTask>.from(_editedTask.subTasks)..add(newSubTask);
                      _editedTask = _editedTask.copyWith(
                        subTasks: updatedSubTasks,
                        completionPercentage: updatedSubTasks.where((t) => t.isCompleted).length / updatedSubTasks.length * 100,
                      );
                      _newSubtaskController.clear();
                    });
                  }
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildNotesTab() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: TextField(
        controller: _notesController,
        decoration: const InputDecoration(
          hintText: 'Add project notes here...',
          border: OutlineInputBorder(),
        ),
        maxLines: 10,
        minLines: 5,
      ),
    );
  }

  Widget _buildGitTab() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Git References',
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 8),
          
          // Git references list
          if (_editedTask.gitReferences.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(
                child: Text('No Git references added yet'),
              ),
            )
          else
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _editedTask.gitReferences.length,
              itemBuilder: (context, index) {
                final ref = _editedTask.gitReferences[index];
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.code),
                  title: Text(ref.title),
                  subtitle: Text(
                    ref.url,
                    style: const TextStyle(
                      fontSize: 12,
                    ),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.open_in_new),
                        onPressed: () async {
                          try {
                            final uri = Uri.parse(ref.url);
                            if (await url_launcher.canLaunchUrl(uri)) {
                              await url_launcher.launchUrl(uri);
                            }
                          } catch (e) {
                            // Handle error
                          }
                        },
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () {
                          setState(() {
                            final updatedRefs = List<GitReference>.from(_editedTask.gitReferences)
                              ..removeAt(index);
                            _editedTask = _editedTask.copyWith(gitReferences: updatedRefs);
                          });
                        },
                      ),
                    ],
                  ),
                );
              },
            ),
          
          const SizedBox(height: 16),
          // Add Git reference form
          ExpansionTile(
            title: const Text('Add Git Reference'),
            leading: const Icon(Icons.add),
            tilePadding: EdgeInsets.zero,
            children: [
              TextField(
                controller: _gitRefTitleController,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  hintText: 'e.g., API Refactoring PR',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _newGitRefController,
                decoration: const InputDecoration(
                  labelText: 'URL',
                  hintText: 'https://github.com/organization/repo/pull/123',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () {
                  if (_newGitRefController.text.trim().isNotEmpty &&
                      _gitRefTitleController.text.trim().isNotEmpty) {
                    setState(() {
                      final newRef = GitReference(
                        id: const Uuid().v4(),
                        url: _newGitRefController.text.trim(),
                        title: _gitRefTitleController.text.trim(),
                      );
                      final updatedRefs = List<GitReference>.from(_editedTask.gitReferences)..add(newRef);
                      _editedTask = _editedTask.copyWith(gitReferences: updatedRefs);
                      _newGitRefController.clear();
                      _gitRefTitleController.clear();
                    });
                  }
                },
                child: const Text('Add Reference'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: const TextStyle(
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          Expanded(
            child: Text(value),
          ),
        ],
      ),
    );
  }

  String _getStatusText(TaskStatus status) {
    switch (status) {
      case TaskStatus.todo:
        return 'To Do';
      case TaskStatus.inProgress:
        return 'In Progress';
      case TaskStatus.completed:
        return 'Completed';
    }
  }
}