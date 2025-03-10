import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/ui/widgets/empty_state.dart';

// Mock data provider for repositories
final repositoriesProvider = FutureProvider<List<GitRepository>>((ref) async {
  // Simulate API call
  await Future.delayed(const Duration(seconds: 1));
  
  // Return mock data
  return [
    GitRepository(
      id: '1',
      name: 'mobile-app',
      description: 'Mobile application codebase',
      workspaceId: '1',
      createdBy: 'User1',
      createdAt: DateTime.now().subtract(const Duration(days: 120)),
      lastActivityAt: DateTime.now().subtract(const Duration(hours: 3)),
      branchesCount: 8,
      language: 'Flutter',
    ),
    GitRepository(
      id: '2',
      name: 'api-server',
      description: 'Backend API server code',
      workspaceId: '1',
      createdBy: 'User2',
      createdAt: DateTime.now().subtract(const Duration(days: 90)),
      lastActivityAt: DateTime.now().subtract(const Duration(days: 1)),
      branchesCount: 5,
      language: 'Kotlin',
    ),
    GitRepository(
      id: '3',
      name: 'web-client',
      description: 'Web client application',
      workspaceId: '1',
      createdBy: 'User3',
      createdAt: DateTime.now().subtract(const Duration(days: 60)),
      lastActivityAt: DateTime.now().subtract(const Duration(hours: 12)),
      branchesCount: 3,
      language: 'TypeScript',
    ),
    GitRepository(
      id: '4',
      name: 'documentation',
      description: 'Project documentation',
      workspaceId: '2',
      createdBy: 'User2',
      createdAt: DateTime.now().subtract(const Duration(days: 30)),
      lastActivityAt: DateTime.now().subtract(const Duration(days: 2)),
      branchesCount: 2,
      language: 'Markdown',
    ),
  ];
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
            return const EmptyState(
              icon: Icons.code,
              title: 'No Repositories',
              message: 'Create your first Git repository to get started',
              actionText: 'Create Repository',
            );
          }
          
          return RefreshIndicator(
            onRefresh: () async => await Future.delayed(const Duration(seconds: 1)),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: repositories.length,
              separatorBuilder: (context, index) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final repository = repositories[index];
                
                return RepositoryCard(repository: repository);
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
        onPressed: () {
          // TODO: Implement repository creation
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}

class RepositoryCard extends StatelessWidget {
  final GitRepository repository;
  
  const RepositoryCard({
    super.key,
    required this.repository,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      child: InkWell(
        onTap: () {
          // TODO: Navigate to repository detail
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
                  IconButton(
                    icon: const Icon(Icons.more_vert),
                    onPressed: () {
                      // TODO: Show repository options menu
                    },
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