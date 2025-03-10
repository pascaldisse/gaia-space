import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/workspace.dart';
import 'package:gaia_space/core/services/auth_service.dart';
import 'package:gaia_space/ui/screens/home/discord_integration_screen.dart';
import 'package:gaia_space/ui/widgets/empty_state.dart';
import 'package:gaia_space/ui/widgets/loading_overlay.dart';
import 'package:uuid/uuid.dart';

// Workspace State Notifier
class WorkspaceNotifier extends StateNotifier<List<Workspace>> {
  WorkspaceNotifier() : super([]) {
    _loadWorkspaces();
  }

  Future<void> _loadWorkspaces() async {
    // Simulate API call
    await Future.delayed(const Duration(seconds: 1));
    
    state = _mockWorkspaces;
  }

  void addWorkspace(Workspace workspace) {
    state = [...state, workspace];
  }

  void updateWorkspace(Workspace updatedWorkspace) {
    state = state.map((workspace) => 
      workspace.id == updatedWorkspace.id ? updatedWorkspace : workspace
    ).toList();
  }

  void deleteWorkspace(String workspaceId) {
    state = state.where((workspace) => workspace.id != workspaceId).toList();
  }
}

// Workspaces Provider
final workspacesProvider = StateNotifierProvider<WorkspaceNotifier, List<Workspace>>((ref) {
  return WorkspaceNotifier();
});

// Selected Workspace Provider
final selectedWorkspaceProvider = StateProvider<Workspace?>((ref) => null);

// Mock data
final _mockWorkspaces = [
  Workspace(
    id: '1',
    name: 'Engineering',
    description: 'Engineering department workspace for software development, DevOps, QA, and infrastructure teams. Collaborate on code reviews, technical designs, and release planning.',
    createdBy: 'User1',
    createdAt: DateTime.now().subtract(const Duration(days: 30)),
    membersCount: 15,
    channelsCount: 8,
  ),
  Workspace(
    id: '2',
    name: 'Product',
    description: 'Product management and design workspace for roadmap planning, feature specification, UX design, and user research. Track product development lifecycle and market feedback.',
    createdBy: 'User2',
    createdAt: DateTime.now().subtract(const Duration(days: 20)),
    membersCount: 10,
    channelsCount: 5,
    avatarUrl: 'https://via.placeholder.com/150/4a90e2/ffffff?text=P',
  ),
  Workspace(
    id: '3',
    name: 'Marketing',
    description: 'Marketing and communications workspace for campaign planning, content creation, social media management, and analytics tracking. Coordinate go-to-market strategies.',
    createdBy: 'User3',
    createdAt: DateTime.now().subtract(const Duration(days: 15)),
    membersCount: 8,
    channelsCount: 4,
    avatarUrl: 'https://via.placeholder.com/150/e24a76/ffffff?text=M',
  ),
  Workspace(
    id: '4',
    name: 'Sales',
    description: 'Sales and customer success workspace for prospect tracking, deal management, customer onboarding, and revenue analysis. Collaborate on sales strategies and customer engagement.',
    createdBy: 'User3',
    createdAt: DateTime.now().subtract(const Duration(days: 10)),
    membersCount: 12,
    channelsCount: 6,
    avatarUrl: 'https://via.placeholder.com/150/4ae24a/ffffff?text=S',
  ),
  Workspace(
    id: '5',
    name: 'Operations',
    description: 'Operations workspace for company-wide announcements, HR policies, finance updates, and administrative information. Central hub for organizational management.',
    createdBy: 'User1',
    createdAt: DateTime.now().subtract(const Duration(days: 45)),
    membersCount: 20,
    channelsCount: 10,
    avatarUrl: 'https://via.placeholder.com/150/e2c84a/ffffff?text=O',
  ),
];

// Workspace view type
enum WorkspaceViewType {
  grid,
  list,
}

// Display view provider
final workspaceViewTypeProvider = StateProvider<WorkspaceViewType>((ref) {
  return WorkspaceViewType.grid;
});

// Search query provider
final workspaceSearchQueryProvider = StateProvider<String>((ref) {
  return '';
});

// Filtered workspaces provider
final filteredWorkspacesProvider = Provider<List<Workspace>>((ref) {
  final workspaces = ref.watch(workspacesProvider);
  final searchQuery = ref.watch(workspaceSearchQueryProvider);
  
  if (searchQuery.isEmpty) {
    return workspaces;
  }
  
  return workspaces.where((workspace) {
    final query = searchQuery.toLowerCase();
    return workspace.name.toLowerCase().contains(query) ||
           (workspace.description?.toLowerCase().contains(query) ?? false);
  }).toList();
});

class WorkspaceScreen extends ConsumerStatefulWidget {
  const WorkspaceScreen({super.key});

  @override
  ConsumerState<WorkspaceScreen> createState() => _WorkspaceScreenState();
}

class _WorkspaceScreenState extends ConsumerState<WorkspaceScreen> {
  final TextEditingController _searchController = TextEditingController();
  
  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    final workspaces = ref.watch(filteredWorkspacesProvider);
    final viewType = ref.watch(workspaceViewTypeProvider);
    final selectedWorkspace = ref.watch(selectedWorkspaceProvider);
    
    // If a workspace is selected, show its details
    if (selectedWorkspace != null) {
      return WorkspaceDetailScreen(
        workspace: selectedWorkspace,
        onBack: () {
          ref.read(selectedWorkspaceProvider.notifier).state = null;
        },
      );
    }
    
    return Scaffold(
      body: Column(
        children: [
          // Search and filter bar
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'Search workspaces...',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: _searchController.text.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear),
                              onPressed: () {
                                _searchController.clear();
                                ref.read(workspaceSearchQueryProvider.notifier).state = '';
                              },
                            )
                          : null,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      contentPadding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                    ),
                    onChanged: (value) {
                      ref.read(workspaceSearchQueryProvider.notifier).state = value;
                    },
                  ),
                ),
                const SizedBox(width: 16),
                IconButton(
                  icon: Icon(viewType == WorkspaceViewType.grid
                      ? Icons.view_list
                      : Icons.grid_view),
                  onPressed: () {
                    ref.read(workspaceViewTypeProvider.notifier).state =
                        viewType == WorkspaceViewType.grid
                            ? WorkspaceViewType.list
                            : WorkspaceViewType.grid;
                  },
                  tooltip: viewType == WorkspaceViewType.grid
                      ? 'Switch to list view'
                      : 'Switch to grid view',
                ),
              ],
            ),
          ),
          
          // Workspace content
          Expanded(
            child: workspaces.isEmpty
                ? EmptyState(
                    icon: Icons.workspaces,
                    title: 'No Workspaces',
                    message: _searchController.text.isNotEmpty
                        ? 'No workspaces match your search'
                        : 'Create your first workspace to get started',
                    actionText: _searchController.text.isNotEmpty ? 'Clear Search' : 'Create Workspace',
                    onActionPressed: () {
                      if (_searchController.text.isNotEmpty) {
                        _searchController.clear();
                        ref.read(workspaceSearchQueryProvider.notifier).state = '';
                      } else {
                        _showCreateWorkspaceDialog(context);
                      }
                    },
                  )
                : viewType == WorkspaceViewType.grid
                    ? _buildGridView(context, workspaces)
                    : _buildListView(context, workspaces),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCreateWorkspaceDialog(context),
        tooltip: 'Create Workspace',
        child: const Icon(Icons.add),
      ),
    );
  }
  
  Widget _buildGridView(BuildContext context, List<Workspace> workspaces) {
    return RefreshIndicator(
      onRefresh: () async {
        // Invalidate the providers to force a refresh
        ref.invalidate(workspacesProvider);
        await Future.delayed(const Duration(milliseconds: 300)); // Wait for the UI to update
      },
      child: GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          childAspectRatio: 1.2,
          crossAxisSpacing: 16,
          mainAxisSpacing: 16,
        ),
        itemCount: workspaces.length,
        itemBuilder: (context, index) {
          final workspace = workspaces[index];
          return WorkspaceGridCard(
            workspace: workspace,
            onTap: () {
              ref.read(selectedWorkspaceProvider.notifier).state = workspace;
            },
            onEdit: () => _showEditWorkspaceDialog(context, workspace),
            onDelete: () => _showDeleteWorkspaceDialog(context, workspace),
          );
        },
      ),
    );
  }
  
  Widget _buildListView(BuildContext context, List<Workspace> workspaces) {
    return RefreshIndicator(
      onRefresh: () async {
        // Invalidate the providers to force a refresh
        ref.invalidate(workspacesProvider);
        await Future.delayed(const Duration(milliseconds: 300)); // Wait for the UI to update
      },
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: workspaces.length,
        separatorBuilder: (context, index) => const SizedBox(height: 12),
        itemBuilder: (context, index) {
          final workspace = workspaces[index];
          return WorkspaceListCard(
            workspace: workspace,
            onTap: () {
              ref.read(selectedWorkspaceProvider.notifier).state = workspace;
            },
            onEdit: () => _showEditWorkspaceDialog(context, workspace),
            onDelete: () => _showDeleteWorkspaceDialog(context, workspace),
          );
        },
      ),
    );
  }
  
  Future<void> _showCreateWorkspaceDialog(BuildContext context) async {
    final nameController = TextEditingController();
    final descriptionController = TextEditingController();
    
    return showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create Workspace'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(
                  labelText: 'Workspace Name',
                  hintText: 'Enter workspace name',
                ),
                textCapitalization: TextCapitalization.words,
                autofocus: true,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: descriptionController,
                decoration: const InputDecoration(
                  labelText: 'Description',
                  hintText: 'Enter workspace description',
                ),
                minLines: 2,
                maxLines: 4,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              if (nameController.text.trim().isNotEmpty) {
                final currentUser = AuthService.currentUser;
                final newWorkspace = Workspace(
                  id: const Uuid().v4(),
                  name: nameController.text.trim(),
                  description: descriptionController.text.trim().isNotEmpty
                      ? descriptionController.text.trim()
                      : null,
                  createdBy: currentUser?.displayName ?? 'Unknown User',
                  createdAt: DateTime.now(),
                  membersCount: 1, // Start with just the creator
                  channelsCount: 1, // Start with a general channel
                );
                
                ref.read(workspacesProvider.notifier).addWorkspace(newWorkspace);
                
                Navigator.of(context).pop();
                
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Workspace "${newWorkspace.name}" created successfully'),
                    behavior: SnackBarBehavior.floating,
                    action: SnackBarAction(
                      label: 'View',
                      onPressed: () {
                        ref.read(selectedWorkspaceProvider.notifier).state = newWorkspace;
                      },
                    ),
                  ),
                );
              }
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
  }
  
  Future<void> _showEditWorkspaceDialog(BuildContext context, Workspace workspace) async {
    final nameController = TextEditingController(text: workspace.name);
    final descriptionController = TextEditingController(text: workspace.description ?? '');
    
    return showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit Workspace'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(
                  labelText: 'Workspace Name',
                  hintText: 'Enter workspace name',
                ),
                textCapitalization: TextCapitalization.words,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: descriptionController,
                decoration: const InputDecoration(
                  labelText: 'Description',
                  hintText: 'Enter workspace description',
                ),
                minLines: 2,
                maxLines: 4,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              if (nameController.text.trim().isNotEmpty) {
                final updatedWorkspace = workspace.copyWith(
                  name: nameController.text.trim(),
                  description: descriptionController.text.trim().isNotEmpty
                      ? descriptionController.text.trim()
                      : null,
                );
                
                ref.read(workspacesProvider.notifier).updateWorkspace(updatedWorkspace);
                
                // If this workspace was selected, update the selection
                if (ref.read(selectedWorkspaceProvider)?.id == workspace.id) {
                  ref.read(selectedWorkspaceProvider.notifier).state = updatedWorkspace;
                }
                
                Navigator.of(context).pop();
                
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Workspace "${updatedWorkspace.name}" updated successfully'),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }
  
  Future<void> _showDeleteWorkspaceDialog(BuildContext context, Workspace workspace) async {
    return showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Workspace'),
        content: Text(
          'Are you sure you want to delete the workspace "${workspace.name}"? This action cannot be undone.'
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            onPressed: () {
              ref.read(workspacesProvider.notifier).deleteWorkspace(workspace.id);
              
              // If this workspace was selected, clear selection
              if (ref.read(selectedWorkspaceProvider)?.id == workspace.id) {
                ref.read(selectedWorkspaceProvider.notifier).state = null;
              }
              
              Navigator.of(context).pop();
              
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Workspace "${workspace.name}" deleted'),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            },
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}

class WorkspaceGridCard extends StatelessWidget {
  final Workspace workspace;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  
  const WorkspaceGridCard({
    super.key,
    required this.workspace,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _buildAvatar(),
                  const Spacer(),
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert),
                    onSelected: (value) {
                      if (value == 'edit') {
                        onEdit();
                      } else if (value == 'delete') {
                        onDelete();
                      }
                    },
                    itemBuilder: (context) => [
                      const PopupMenuItem(
                        value: 'edit',
                        child: Row(
                          children: [
                            Icon(Icons.edit, size: 18),
                            SizedBox(width: 8),
                            Text('Edit'),
                          ],
                        ),
                      ),
                      const PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            Icon(Icons.delete, size: 18, color: Colors.red),
                            SizedBox(width: 8),
                            Text('Delete', style: TextStyle(color: Colors.red)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      workspace.name,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (workspace.description != null && workspace.description!.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        workspace.description!,
                        style: Theme.of(context).textTheme.bodySmall,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildStat(context, Icons.people, workspace.membersCount.toString()),
                  _buildStat(context, Icons.forum, workspace.channelsCount.toString()),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
  
  Widget _buildAvatar() {
    if (workspace.avatarUrl != null) {
      return CircleAvatar(
        radius: 24,
        backgroundImage: NetworkImage(workspace.avatarUrl!),
        backgroundColor: Colors.grey.shade200,
      );
    }
    
    // Generate a color based on name
    final colorValue = workspace.name.hashCode % Colors.primaries.length;
    final color = Colors.primaries[colorValue];
    
    return CircleAvatar(
      radius: 24,
      backgroundColor: color,
      child: Text(
        workspace.name[0].toUpperCase(),
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.bold,
          fontSize: 20,
        ),
      ),
    );
  }
  
  Widget _buildStat(BuildContext context, IconData icon, String count) {
    return Row(
      children: [
        Icon(
          icon,
          size: 16,
          color: Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
        ),
        const SizedBox(width: 4),
        Text(
          count,
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
          ),
        ),
      ],
    );
  }
}

class WorkspaceListCard extends StatelessWidget {
  final Workspace workspace;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  
  const WorkspaceListCard({
    super.key,
    required this.workspace,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _buildAvatar(context),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          workspace.name,
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          'Created by ${workspace.createdBy} · ${_formatDate(workspace.createdAt)}',
                          style: TextStyle(
                            fontSize: 12,
                            color: Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
                          ),
                        ),
                      ],
                    ),
                  ),
                  PopupMenuButton<String>(
                    icon: const Icon(Icons.more_vert),
                    onSelected: (value) {
                      if (value == 'edit') {
                        onEdit();
                      } else if (value == 'delete') {
                        onDelete();
                      }
                    },
                    itemBuilder: (context) => [
                      const PopupMenuItem(
                        value: 'edit',
                        child: Row(
                          children: [
                            Icon(Icons.edit, size: 18),
                            SizedBox(width: 8),
                            Text('Edit'),
                          ],
                        ),
                      ),
                      const PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            Icon(Icons.delete, size: 18, color: Colors.red),
                            SizedBox(width: 8),
                            Text('Delete', style: TextStyle(color: Colors.red)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              if (workspace.description != null && workspace.description!.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  workspace.description!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  _buildStat(
                    context,
                    Icons.people,
                    '${workspace.membersCount} members',
                  ),
                  const SizedBox(width: 24),
                  _buildStat(
                    context,
                    Icons.forum,
                    '${workspace.channelsCount} channels',
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
  
  Widget _buildAvatar(BuildContext context) {
    if (workspace.avatarUrl != null) {
      return CircleAvatar(
        radius: 24,
        backgroundImage: NetworkImage(workspace.avatarUrl!),
        backgroundColor: Colors.grey.shade200,
      );
    }
    
    // Generate a color based on name
    final colorValue = workspace.name.hashCode % Colors.primaries.length;
    final color = Colors.primaries[colorValue];
    
    return CircleAvatar(
      radius: 24,
      backgroundColor: color,
      child: Text(
        workspace.name[0].toUpperCase(),
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.bold,
          fontSize: 20,
        ),
      ),
    );
  }
  
  Widget _buildStat(BuildContext context, IconData icon, String text) {
    return Row(
      children: [
        Icon(
          icon,
          size: 16,
          color: Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
        ),
        const SizedBox(width: 4),
        Text(
          text,
          style: TextStyle(
            color: Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
          ),
        ),
      ],
    );
  }
  
  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);
    
    if (difference.inDays > 365) {
      return '${(difference.inDays / 365).floor()} years ago';
    } else if (difference.inDays > 30) {
      return '${(difference.inDays / 30).floor()} months ago';
    } else if (difference.inDays > 0) {
      return '${difference.inDays} days ago';
    } else if (difference.inHours > 0) {
      return '${difference.inHours} hours ago';
    } else if (difference.inMinutes > 0) {
      return '${difference.inMinutes} minutes ago';
    } else {
      return 'Just now';
    }
  }
}

// Workspace Detail Screen
class WorkspaceDetailScreen extends StatelessWidget {
  final Workspace workspace;
  final VoidCallback onBack;
  
  const WorkspaceDetailScreen({
    super.key,
    required this.workspace,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: onBack,
        ),
        title: Text(workspace.name),
        actions: [
          IconButton(
            icon: const Icon(Icons.groups),
            onPressed: () {
              // Show members management
            },
            tooltip: 'Manage Members',
          ),
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () {
              // Show workspace settings
            },
            tooltip: 'Workspace Settings',
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Workspace header
          _buildWorkspaceHeader(context),
          
          const SizedBox(height: 24),
          
          // Channels section
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: Theme.of(context).dividerColor),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Channels',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.add),
                        onPressed: () {
                          // Add channel functionality
                        },
                        tooltip: 'Add Channel',
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  _buildChannelTile(context, 'general', 'General discussion channel'),
                  _buildChannelTile(context, 'announcements', 'Important workspace announcements'),
                  if (workspace.name == 'Engineering')
                    _buildChannelTile(context, 'development', 'Software development discussions'),
                  if (workspace.name == 'Engineering')
                    _buildChannelTile(context, 'deployments', 'Release and deployment coordination'),
                  if (workspace.name == 'Product')
                    _buildChannelTile(context, 'roadmap', 'Product roadmap planning'),
                  if (workspace.name == 'Product')
                    _buildChannelTile(context, 'design', 'UI/UX design discussions'),
                  if (workspace.name == 'Marketing')
                    _buildChannelTile(context, 'campaigns', 'Marketing campaign planning'),
                  if (workspace.name == 'Marketing')
                    _buildChannelTile(context, 'social-media', 'Social media strategy and content'),
                ],
              ),
            ),
          ),
          
          const SizedBox(height: 24),
          
          // Members section
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: Theme.of(context).dividerColor),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Members',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.add),
                        onPressed: () {
                          // Add member functionality
                        },
                        tooltip: 'Add Member',
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  _buildMemberTile(context, 'John Doe', 'Admin', 'https://via.placeholder.com/150/92c952?text=JD'),
                  _buildMemberTile(context, 'Jane Smith', 'Member', 'https://via.placeholder.com/150/771796?text=JS'),
                  _buildMemberTile(context, 'Alex Johnson', 'Member', 'https://via.placeholder.com/150/24f355?text=AJ'),
                  _buildMemberTile(context, AuthService.currentUser?.displayName ?? 'You', 'Admin', null),
                ],
              ),
            ),
          ),
          
          const SizedBox(height: 24),
          
          // Projects section
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(color: Theme.of(context).dividerColor),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Projects',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      TextButton.icon(
                        icon: const Icon(Icons.add),
                        label: const Text('Create Project'),
                        onPressed: () {
                          // Create project functionality
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (workspace.name == 'Engineering')
                    _buildProjectTile(context, 'API Refactoring', 'In Progress'),
                  if (workspace.name == 'Engineering')
                    _buildProjectTile(context, 'Mobile App Bugfixes', 'To Do'),
                  if (workspace.name == 'Product')
                    _buildProjectTile(context, 'Q3 Roadmap Planning', 'Completed'),
                  if (workspace.name == 'Product')
                    _buildProjectTile(context, 'User Research', 'In Progress'),
                  if (workspace.name == 'Marketing')
                    _buildProjectTile(context, 'Summer Campaign', 'In Progress'),
                  if (workspace.membersCount < 3)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 16),
                      child: Center(child: Text('No projects yet')),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          // Start a new conversation
        },
        icon: const Icon(Icons.chat),
        label: const Text('New Discussion'),
      ),
    );
  }
  
  Widget _buildWorkspaceHeader(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _buildWorkspaceAvatar(context),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    workspace.name,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    'Created by ${workspace.createdBy} · ${_formatDate(workspace.createdAt)}',
                    style: TextStyle(
                      color: Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (workspace.description != null && workspace.description!.isNotEmpty)
          Text(
            workspace.description!,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        const SizedBox(height: 16),
        Row(
          children: [
            _buildStat(context, Icons.people, '${workspace.membersCount} members'),
            const SizedBox(width: 24),
            _buildStat(context, Icons.forum, '${workspace.channelsCount} channels'),
          ],
        ),
      ],
    );
  }
  
  Widget _buildWorkspaceAvatar(BuildContext context) {
    if (workspace.avatarUrl != null) {
      return CircleAvatar(
        radius: 32,
        backgroundImage: NetworkImage(workspace.avatarUrl!),
        backgroundColor: Colors.grey.shade200,
      );
    }
    
    // Generate a color based on name
    final colorValue = workspace.name.hashCode % Colors.primaries.length;
    final color = Colors.primaries[colorValue];
    
    return CircleAvatar(
      radius: 32,
      backgroundColor: color,
      child: Text(
        workspace.name[0].toUpperCase(),
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.bold,
          fontSize: 24,
        ),
      ),
    );
  }
  
  Widget _buildChannelTile(BuildContext context, String name, String description) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.tag),
      title: Text('#$name'),
      subtitle: Text(
        description,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      onTap: () {
        // Navigate to channel
      },
    );
  }
  
  Widget _buildMemberTile(BuildContext context, String name, String role, String? avatarUrl) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: avatarUrl != null
          ? CircleAvatar(
              backgroundImage: NetworkImage(avatarUrl),
              backgroundColor: Colors.grey.shade200,
            )
          : CircleAvatar(
              backgroundColor: Theme.of(context).primaryColor,
              child: Text(
                name[0].toUpperCase(),
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
      title: Text(name),
      subtitle: Text(role),
      trailing: role == 'Admin'
          ? Chip(
              label: Text(
                'Admin',
                style: TextStyle(
                  fontSize: 12,
                  color: Theme.of(context).primaryColor,
                ),
              ),
              backgroundColor: Theme.of(context).primaryColor.withOpacity(0.1),
              visualDensity: VisualDensity.compact,
            )
          : null,
    );
  }
  
  Widget _buildProjectTile(BuildContext context, String name, String status) {
    Color statusColor;
    
    switch (status) {
      case 'To Do':
        statusColor = Colors.grey;
        break;
      case 'In Progress':
        statusColor = Theme.of(context).primaryColor;
        break;
      case 'Completed':
        statusColor = Colors.green;
        break;
      default:
        statusColor = Colors.grey;
    }
    
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.task_alt),
      title: Text(name),
      subtitle: Text(status),
      trailing: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: statusColor.withOpacity(0.1),
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: statusColor.withOpacity(0.5)),
        ),
        child: Text(
          status,
          style: TextStyle(
            fontSize: 12,
            color: statusColor,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      onTap: () {
        // Navigate to project
      },
    );
  }
  
  Widget _buildStat(BuildContext context, IconData icon, String text) {
    return Row(
      children: [
        Icon(
          icon,
          size: 16,
          color: Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
        ),
        const SizedBox(width: 4),
        Text(
          text,
          style: TextStyle(
            color: Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
          ),
        ),
      ],
    );
  }
  
  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);
    
    if (difference.inDays > 365) {
      return '${(difference.inDays / 365).floor()} years ago';
    } else if (difference.inDays > 30) {
      return '${(difference.inDays / 30).floor()} months ago';
    } else if (difference.inDays > 0) {
      return '${difference.inDays} days ago';
    } else if (difference.inHours > 0) {
      return '${difference.inHours} hours ago';
    } else if (difference.inMinutes > 0) {
      return '${difference.inMinutes} minutes ago';
    } else {
      return 'Just now';
    }
  }
}