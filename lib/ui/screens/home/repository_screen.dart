import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/services/git_repository_manager.dart';
import 'package:gaia_space/core/services/git_service.dart';
import 'package:gaia_space/ui/screens/home/create_repository_screen.dart';
import 'package:gaia_space/ui/screens/home/git_repository_detail_screen.dart';
import 'package:gaia_space/ui/widgets/empty_state.dart';

// Repository provider
final repositoriesProvider = FutureProvider<List<GitRepository>>((ref) async {
  final repositoryManager = GitRepositoryManager();
  
  // Get all repositories
  final repositories = await repositoryManager.getRepositories();
  
  // If no repositories exist, create test repository if it's the first run
  if (repositories.isEmpty) {
    // Create a temporary test repository for first-time users
    try {
      final tempDir = Directory.systemTemp.createTempSync('gaia_space_demo');
      
      await repositoryManager.addRepository(
        name: 'Sample Repository',
        path: tempDir.path,
        description: 'A sample repository for demonstration',
        workspaceId: 'default',
        createdBy: 'system',
      );
      
      // Initialize the repository
      final gitService = GitService();
      await gitService.initRepository(tempDir.path);
      
      // Reload repositories
      return await repositoryManager.getRepositories();
    } catch (e) {
      // Return empty list if sample can't be created
      return [];
    }
  }
  
  return repositories;
});

class RepositoryScreen extends ConsumerWidget {
  const RepositoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repositoriesAsync = ref.watch(repositoriesProvider);
    
    return Scaffold(
      body: repositoriesAsync.when(
        data: (repositories) {
          if (repositories.isEmpty) {
            return EmptyState(
              icon: Icons.code,
              title: 'No Repositories',
              message: 'Create your first Git repository to get started',
              actionText: 'Create Repository',
              onActionPressed: () async {
                final result = await Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => const CreateRepositoryScreen(),
                  ),
                );
                
                if (result == true) {
                  // Refresh repositories list
                  ref.refresh(repositoriesProvider);
                }
              },
            );
          }
          
          return RefreshIndicator(
            onRefresh: () async {
              ref.refresh(repositoriesProvider);
            },
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: repositories.length,
              separatorBuilder: (context, index) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final repository = repositories[index];
                
                return RepositoryCard(
                  repository: repository,
                  onDelete: () async {
                    final confirm = await showDialog<bool>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: const Text('Remove Repository'),
                        content: Text('Are you sure you want to remove "${repository.name}" from Gaia Space?'),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.of(context).pop(false),
                            child: const Text('Cancel'),
                          ),
                          ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.red,
                            ),
                            onPressed: () => Navigator.of(context).pop(true),
                            child: const Text('Remove'),
                          ),
                        ],
                      ),
                    );
                    
                    if (confirm == true) {
                      final repositoryManager = GitRepositoryManager();
                      await repositoryManager.deleteRepository(repository.id);
                      ref.refresh(repositoriesProvider);
                    }
                  },
                );
              },
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Center(
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.error_outline,
                  color: Colors.red,
                  size: 48,
                ),
                const SizedBox(height: 16),
                Text(
                  'Error loading repositories',
                  style: Theme.of(context).textTheme.displaySmall,
                ),
                const SizedBox(height: 8),
                Text(
                  error.toString(),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => ref.refresh(repositoriesProvider),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final result = await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (context) => const CreateRepositoryScreen(),
            ),
          );
          
          if (result == true) {
            // Refresh repositories list
            ref.refresh(repositoriesProvider);
          }
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}

class RepositoryCard extends StatelessWidget {
  final GitRepository repository;
  final VoidCallback? onDelete;
  
  const RepositoryCard({
    super.key,
    required this.repository,
    this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      child: InkWell(
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (context) => GitRepositoryDetailScreen(
                repositoryId: repository.id,
              ),
            ),
          );
        },
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _buildLanguageIcon(context),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          repository.name,
                          style: Theme.of(context).textTheme.displaySmall,
                        ),
                        Text(
                          'Created by ${repository.createdBy} · ${_formatDate(repository.createdAt)}',
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
                      if (value == 'delete' && onDelete != null) {
                        onDelete!();
                      }
                    },
                    itemBuilder: (context) => [
                      const PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            Icon(Icons.delete, color: Colors.red),
                            SizedBox(width: 8),
                            Text('Remove Repository'),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              if (repository.description != null && repository.description!.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  repository.description!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  _buildStat(
                    context,
                    Icons.call_split,
                    '${repository.branchesCount} branches',
                  ),
                  const SizedBox(width: 24),
                  _buildStat(
                    context,
                    Icons.update,
                    'Updated ${_formatLastActivity(repository.lastActivityAt)}',
                  ),
                  const SizedBox(width: 24),
                  if (repository.path != null) ...[
                    _buildStat(
                      context,
                      Icons.folder,
                      repository.path!.split(Platform.pathSeparator).last,
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
  
  Widget _buildLanguageIcon(BuildContext context) {
    // Select color based on language
    Color color;
    IconData icon;
    
    switch (repository.language?.toLowerCase()) {
      case 'kotlin':
        color = Colors.purple;
        icon = Icons.code;
        break;
      case 'typescript':
      case 'javascript':
        color = Colors.amber;
        icon = Icons.code;
        break;
      case 'flutter':
      case 'dart':
        color = Colors.blue;
        icon = Icons.code;
        break;
      case 'markdown':
        color = Colors.blue.shade800;
        icon = Icons.article;
        break;
      case 'python':
        color = Colors.green;
        icon = Icons.code;
        break;
      case 'java':
        color = Colors.orange;
        icon = Icons.code;
        break;
      default:
        color = Colors.grey;
        icon = Icons.code;
    }
    
    return CircleAvatar(
      backgroundColor: color,
      radius: 20,
      child: Icon(icon, color: Colors.white, size: 20),
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
    } else {
      return 'Today';
    }
  }
  
  String _formatLastActivity(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);
    
    if (difference.inDays > 30) {
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