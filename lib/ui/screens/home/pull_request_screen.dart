import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/pull_request.dart';
import 'package:gaia_space/core/models/git_diff.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/services/pull_request_service.dart';
import 'package:gaia_space/core/services/git_repository_manager.dart';
import 'package:gaia_space/core/services/git_service.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:gaia_space/ui/widgets/git/diff_viewer.dart';

final pullRequestServiceProvider = Provider<PullRequestService>((ref) => PullRequestService());

/// Screen for listing pull requests
class PullRequestListScreen extends ConsumerWidget {
  final String repositoryId;
  
  const PullRequestListScreen({
    Key? key,
    required this.repositoryId,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pullRequestService = ref.read(pullRequestServiceProvider);
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pull Requests'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (context) => CreatePullRequestScreen(
                    repositoryId: repositoryId,
                  ),
                ),
              );
            },
          ),
        ],
      ),
      body: FutureBuilder<List<PullRequest>>(
        future: pullRequestService.getPullRequests(
          repositoryId: repositoryId,
          includeDetails: true,
        ),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          
          if (snapshot.hasError) {
            return Center(
              child: Text('Error loading pull requests: ${snapshot.error}'),
            );
          }
          
          final pullRequests = snapshot.data ?? [];
          
          if (pullRequests.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.merge_type, size: 64, color: Colors.grey),
                  const SizedBox(height: 16),
                  const Text(
                    'No Pull Requests',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  const Text('Create a pull request to propose changes'),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (context) => CreatePullRequestScreen(
                            repositoryId: repositoryId,
                          ),
                        ),
                      );
                    },
                    child: const Text('Create Pull Request'),
                  ),
                ],
              ),
            );
          }
          
          return ListView.builder(
            itemCount: pullRequests.length,
            itemBuilder: (context, index) {
              final pr = pullRequests[index];
              
              return Card(
                margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: ListTile(
                  title: Text(
                    pr.title,
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  subtitle: Text('Created at: ${pr.createdAt.toString().substring(0, 19)}'),
                  leading: _buildStatusIcon(pr.status),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Chip(
                        label: Text('${pr.commitsCount} commits'),
                        backgroundColor: Colors.blue.shade100,
                      ),
                      const SizedBox(width: 8),
                      Chip(
                        label: Text('${pr.commentsCount} comments'),
                        backgroundColor: Colors.green.shade100,
                      ),
                    ],
                  ),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (context) => PullRequestDetailScreen(
                          pullRequestId: pr.id,
                        ),
                      ),
                    );
                  },
                ),
              );
            },
          );
        },
      ),
    );
  }
  
  Widget _buildStatusIcon(PullRequestStatus status) {
    switch (status) {
      case PullRequestStatus.open:
        return const CircleAvatar(
          backgroundColor: Colors.green,
          child: Icon(Icons.merge, color: Colors.white),
        );
      case PullRequestStatus.merged:
        return const CircleAvatar(
          backgroundColor: Colors.purple,
          child: Icon(Icons.done_all, color: Colors.white),
        );
      case PullRequestStatus.closed:
        return const CircleAvatar(
          backgroundColor: Colors.red,
          child: Icon(Icons.close, color: Colors.white),
        );
      case PullRequestStatus.draft:
        return const CircleAvatar(
          backgroundColor: Colors.grey,
          child: Icon(Icons.edit, color: Colors.white),
        );
    }
  }
}

/// Screen for creating a new pull request
class CreatePullRequestScreen extends ConsumerStatefulWidget {
  final String repositoryId;
  
  const CreatePullRequestScreen({
    Key? key,
    required this.repositoryId,
  }) : super(key: key);
  
  @override
  ConsumerState<CreatePullRequestScreen> createState() => _CreatePullRequestScreenState();
}

class _CreatePullRequestScreenState extends ConsumerState<CreatePullRequestScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  
  String? _selectedSourceRepo;
  String? _selectedTargetRepo;
  String? _selectedSourceBranch;
  String? _selectedTargetBranch;
  
  List<GitRepository> _repositories = [];
  Map<String, List<String>> _branches = {};
  
  bool _isLoading = true;
  bool _isCreatingPR = false;
  final _logger = AppLogger('CreatePR');
  
  @override
  void initState() {
    super.initState();
    _loadRepositories();
  }
  
  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }
  
  Future<void> _loadRepositories() async {
    setState(() {
      _isLoading = true;
    });
    
    try {
      final repoManager = ref.read(Provider<GitRepositoryManager>((ref) => GitRepositoryManager()));
      _repositories = await repoManager.getRepositories();
      
      // Set default source repo to the current repo
      _selectedSourceRepo = widget.repositoryId;
      _selectedTargetRepo = widget.repositoryId;
      
      // Load branches for selected repos
      await _loadBranches(_selectedSourceRepo!);
      if (_selectedTargetRepo != _selectedSourceRepo) {
        await _loadBranches(_selectedTargetRepo!);
      }
    } catch (e) {
      _logger.error('Error loading repositories', error: e);
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  Future<void> _loadBranches(String repoId) async {
    try {
      final repoManager = ref.read(Provider<GitRepositoryManager>((ref) => GitRepositoryManager()));
      final branches = await repoManager.getBranches(repoId);
      
      setState(() {
        _branches[repoId] = branches.map((b) => b.name).toList();
        
        // Set default branches if not already set
        if (_selectedSourceRepo == repoId && _selectedSourceBranch == null && _branches[repoId]!.isNotEmpty) {
          _selectedSourceBranch = _branches[repoId]!.first;
        }
        
        if (_selectedTargetRepo == repoId && _selectedTargetBranch == null && _branches[repoId]!.isNotEmpty) {
          // Try to find 'main' or 'master' as default target branch
          final defaultBranch = _branches[repoId]!.contains('main')
              ? 'main'
              : _branches[repoId]!.contains('master')
                  ? 'master'
                  : _branches[repoId]!.first;
          
          _selectedTargetBranch = defaultBranch;
        }
      });
    } catch (e) {
      _logger.error('Error loading branches', error: e);
    }
  }
  
  Future<void> _createPullRequest() async {
    if (_formKey.currentState!.validate() &&
        _selectedSourceRepo != null &&
        _selectedTargetRepo != null &&
        _selectedSourceBranch != null &&
        _selectedTargetBranch != null) {
      
      setState(() {
        _isCreatingPR = true;
      });
      
      try {
        final pullRequestService = ref.read(pullRequestServiceProvider);
        
        final createdPR = await pullRequestService.createPullRequest(
          title: _titleController.text,
          description: _descriptionController.text,
          sourceRepositoryId: _selectedSourceRepo!,
          sourceBranch: _selectedSourceBranch!,
          targetRepositoryId: _selectedTargetRepo!,
          targetBranch: _selectedTargetBranch!,
          authorId: 'current_user', // In a real app, this would be the current user's ID
        );
        
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Pull request created successfully'),
              backgroundColor: Colors.green,
            ),
          );
          
          // Navigate to the detail screen for the new PR
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(
              builder: (context) => PullRequestDetailScreen(
                pullRequestId: createdPR.id,
              ),
            ),
          );
        }
      } catch (e) {
        _logger.error('Error creating pull request', error: e);
        
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Error creating pull request: ${e.toString()}'),
              backgroundColor: Colors.red,
            ),
          );
        }
      } finally {
        if (mounted) {
          setState(() {
            _isCreatingPR = false;
          });
        }
      }
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Create Pull Request'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16.0),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // From repository selection
                    const Text(
                      'Source',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          flex: 2,
                          child: DropdownButtonFormField<String>(
                            decoration: const InputDecoration(
                              labelText: 'From Repository',
                              border: OutlineInputBorder(),
                            ),
                            value: _selectedSourceRepo,
                            items: _repositories
                                .map((repo) => DropdownMenuItem(
                                      value: repo.id,
                                      child: Text(repo.name),
                                    ))
                                .toList(),
                            onChanged: (value) {
                              setState(() {
                                _selectedSourceRepo = value;
                                _selectedSourceBranch = null;
                              });
                              if (value != null) {
                                _loadBranches(value);
                              }
                            },
                            validator: (value) {
                              if (value == null || value.isEmpty) {
                                return 'Please select a source repository';
                              }
                              return null;
                            },
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          flex: 1,
                          child: DropdownButtonFormField<String>(
                            decoration: const InputDecoration(
                              labelText: 'From Branch',
                              border: OutlineInputBorder(),
                            ),
                            value: _selectedSourceBranch,
                            items: _selectedSourceRepo != null &&
                                    _branches.containsKey(_selectedSourceRepo)
                                ? _branches[_selectedSourceRepo]!
                                    .map((branch) => DropdownMenuItem(
                                          value: branch,
                                          child: Text(branch),
                                        ))
                                    .toList()
                                : [],
                            onChanged: (value) {
                              setState(() {
                                _selectedSourceBranch = value;
                              });
                            },
                            validator: (value) {
                              if (value == null || value.isEmpty) {
                                return 'Please select a source branch';
                              }
                              return null;
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    
                    // To repository selection
                    const Text(
                      'Target',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          flex: 2,
                          child: DropdownButtonFormField<String>(
                            decoration: const InputDecoration(
                              labelText: 'To Repository',
                              border: OutlineInputBorder(),
                            ),
                            value: _selectedTargetRepo,
                            items: _repositories
                                .map((repo) => DropdownMenuItem(
                                      value: repo.id,
                                      child: Text(repo.name),
                                    ))
                                .toList(),
                            onChanged: (value) {
                              setState(() {
                                _selectedTargetRepo = value;
                                _selectedTargetBranch = null;
                              });
                              if (value != null) {
                                _loadBranches(value);
                              }
                            },
                            validator: (value) {
                              if (value == null || value.isEmpty) {
                                return 'Please select a target repository';
                              }
                              return null;
                            },
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          flex: 1,
                          child: DropdownButtonFormField<String>(
                            decoration: const InputDecoration(
                              labelText: 'To Branch',
                              border: OutlineInputBorder(),
                            ),
                            value: _selectedTargetBranch,
                            items: _selectedTargetRepo != null &&
                                    _branches.containsKey(_selectedTargetRepo)
                                ? _branches[_selectedTargetRepo]!
                                    .map((branch) => DropdownMenuItem(
                                          value: branch,
                                          child: Text(branch),
                                        ))
                                    .toList()
                                : [],
                            onChanged: (value) {
                              setState(() {
                                _selectedTargetBranch = value;
                              });
                            },
                            validator: (value) {
                              if (value == null || value.isEmpty) {
                                return 'Please select a target branch';
                              }
                              return null;
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    
                    // Title and description
                    TextFormField(
                      controller: _titleController,
                      decoration: const InputDecoration(
                        labelText: 'Title',
                        hintText: 'Enter a title for your pull request',
                        border: OutlineInputBorder(),
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return 'Please enter a title';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _descriptionController,
                      decoration: const InputDecoration(
                        labelText: 'Description',
                        hintText: 'Enter a description for your pull request',
                        border: OutlineInputBorder(),
                      ),
                      maxLines: 5,
                    ),
                    const SizedBox(height: 24),
                    
                    // Create button
                    SizedBox(
                      width: double.infinity,
                      height: 50,
                      child: ElevatedButton(
                        onPressed: _isCreatingPR ? null : _createPullRequest,
                        child: _isCreatingPR
                            ? const CircularProgressIndicator()
                            : const Text('Create Pull Request'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}

/// Screen for viewing a pull request's details
class PullRequestDetailScreen extends ConsumerStatefulWidget {
  final String pullRequestId;
  
  const PullRequestDetailScreen({
    Key? key,
    required this.pullRequestId,
  }) : super(key: key);
  
  @override
  ConsumerState<PullRequestDetailScreen> createState() => _PullRequestDetailScreenState();
}

class _PullRequestDetailScreenState extends ConsumerState<PullRequestDetailScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  PullRequest? _pullRequest;
  bool _isLoading = true;
  bool _isMerging = false;
  final _commentController = TextEditingController();
  final _logger = AppLogger('PRDetail');
  
  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadPullRequest();
  }
  
  @override
  void dispose() {
    _tabController.dispose();
    _commentController.dispose();
    super.dispose();
  }
  
  Future<void> _loadPullRequest() async {
    setState(() {
      _isLoading = true;
    });
    
    try {
      final pullRequestService = ref.read(pullRequestServiceProvider);
      _pullRequest = await pullRequestService.getPullRequest(widget.pullRequestId);
    } catch (e) {
      _logger.error('Error loading pull request', error: e);
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  Future<void> _mergePullRequest() async {
    if (_pullRequest == null) return;
    
    setState(() {
      _isMerging = true;
    });
    
    try {
      final pullRequestService = ref.read(pullRequestServiceProvider);
      
      await pullRequestService.mergePullRequest(
        widget.pullRequestId,
        userId: 'current_user', // In a real app, this would be the current user's ID
      );
      
      await _loadPullRequest();
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Pull request merged successfully'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      _logger.error('Error merging pull request', error: e);
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error merging pull request: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isMerging = false;
        });
      }
    }
  }
  
  Future<void> _closePullRequest() async {
    if (_pullRequest == null) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      final pullRequestService = ref.read(pullRequestServiceProvider);
      
      await pullRequestService.closePullRequest(
        widget.pullRequestId,
        userId: 'current_user', // In a real app, this would be the current user's ID
      );
      
      await _loadPullRequest();
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Pull request closed successfully'),
            backgroundColor: Colors.orange,
          ),
        );
      }
    } catch (e) {
      _logger.error('Error closing pull request', error: e);
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error closing pull request: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }
  
  Future<void> _reopenPullRequest() async {
    if (_pullRequest == null) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      final pullRequestService = ref.read(pullRequestServiceProvider);
      
      await pullRequestService.reopenPullRequest(widget.pullRequestId);
      
      await _loadPullRequest();
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Pull request reopened successfully'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      _logger.error('Error reopening pull request', error: e);
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error reopening pull request: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }
  
  Future<void> _addComment() async {
    if (_pullRequest == null || _commentController.text.isEmpty) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      final pullRequestService = ref.read(pullRequestServiceProvider);
      
      await pullRequestService.addComment(
        pullRequestId: widget.pullRequestId,
        content: _commentController.text,
        authorId: 'current_user', // In a real app, this would be the current user's ID
      );
      
      _commentController.clear();
      await _loadPullRequest();
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Comment added successfully'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      _logger.error('Error adding comment', error: e);
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error adding comment: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_pullRequest?.title ?? 'Pull Request'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Overview'),
            Tab(text: 'Files'),
            Tab(text: 'Commits'),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _pullRequest == null
              ? const Center(child: Text('Pull request not found'))
              : Column(
                  children: [
                    _buildHeader(),
                    Expanded(
                      child: TabBarView(
                        controller: _tabController,
                        children: [
                          _buildOverviewTab(),
                          _buildFilesTab(),
                          _buildCommitsTab(),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
  
  Widget _buildHeader() {
    final statusColor = _pullRequest!.status == PullRequestStatus.open
        ? Colors.green
        : _pullRequest!.status == PullRequestStatus.merged
            ? Colors.purple
            : Colors.red;
    
    final statusText = _pullRequest!.status == PullRequestStatus.open
        ? 'Open'
        : _pullRequest!.status == PullRequestStatus.merged
            ? 'Merged'
            : 'Closed';
    
    return Container(
      padding: const EdgeInsets.all(16),
      color: Colors.grey.shade100,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: statusColor,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      _pullRequest!.status == PullRequestStatus.open
                          ? Icons.merge
                          : _pullRequest!.status == PullRequestStatus.merged
                              ? Icons.done_all
                              : Icons.close,
                      color: Colors.white,
                      size: 16,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      statusText,
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              if (_pullRequest!.status == PullRequestStatus.open)
                Row(
                  children: [
                    ElevatedButton(
                      onPressed: _isMerging ? null : _mergePullRequest,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                      ),
                      child: _isMerging
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                color: Colors.white,
                                strokeWidth: 2,
                              ),
                            )
                          : const Text('Merge'),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      onPressed: _closePullRequest,
                      child: const Text('Close'),
                    ),
                  ],
                ),
              if (_pullRequest!.status == PullRequestStatus.closed)
                ElevatedButton(
                  onPressed: _reopenPullRequest,
                  child: const Text('Reopen'),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            _pullRequest!.description,
            style: const TextStyle(fontSize: 16),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.person, size: 16, color: Colors.grey),
              const SizedBox(width: 4),
              Text('Author: ${_pullRequest!.authorId}'),
              const SizedBox(width: 16),
              const Icon(Icons.calendar_today, size: 16, color: Colors.grey),
              const SizedBox(width: 4),
              Text('Created: ${_pullRequest!.createdAt.toString().substring(0, 10)}'),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.merge_type, size: 16, color: Colors.grey),
              const SizedBox(width: 4),
              Text('${_pullRequest!.sourceBranch} → ${_pullRequest!.targetBranch}'),
            ],
          ),
        ],
      ),
    );
  }
  
  Widget _buildOverviewTab() {
    final pullRequestService = ref.read(pullRequestServiceProvider);
    
    return Column(
      children: [
        Expanded(
          child: FutureBuilder<List<PullRequestComment>>(
            future: pullRequestService.getComments(widget.pullRequestId),
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              
              if (snapshot.hasError) {
                return Center(
                  child: Text('Error loading comments: ${snapshot.error}'),
                );
              }
              
              final comments = snapshot.data ?? [];
              
              if (comments.isEmpty) {
                return const Center(
                  child: Text('No comments yet'),
                );
              }
              
              return ListView.builder(
                itemCount: comments.length,
                itemBuilder: (context, index) {
                  final comment = comments[index];
                  
                  return Card(
                    margin: const EdgeInsets.all(8),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const CircleAvatar(
                                child: Icon(Icons.person),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                comment.authorId,
                                style: const TextStyle(fontWeight: FontWeight.bold),
                              ),
                              const Spacer(),
                              Text(
                                comment.createdAt.toString().substring(0, 19),
                                style: const TextStyle(color: Colors.grey),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(comment.content),
                        ],
                      ),
                    ),
                  );
                },
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(8.0),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _commentController,
                  decoration: const InputDecoration(
                    hintText: 'Add a comment...',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 3,
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                icon: const Icon(Icons.send),
                onPressed: _addComment,
              ),
            ],
          ),
        ),
      ],
    );
  }
  
  Widget _buildFilesTab() {
    final pullRequestService = ref.read(pullRequestServiceProvider);
    
    return FutureBuilder<List<GitDiff>>(
      future: pullRequestService.getDiff(widget.pullRequestId),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        
        if (snapshot.hasError) {
          return Center(
            child: Text('Error loading diff: ${snapshot.error}'),
          );
        }
        
        final diffs = snapshot.data ?? [];
        
        if (diffs.isEmpty) {
          return const Center(
            child: Text('No changes'),
          );
        }
        
        return SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Summary
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Changes Summary',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                      ),
                      const SizedBox(height: 8),
                      Text('${diffs.length} files changed'),
                      Text(
                          '${diffs.fold(0, (prev, diff) => prev + diff.additions)} additions, ${diffs.fold(0, (prev, diff) => prev + diff.deletions)} deletions'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              
              // File diffs
              for (final diff in diffs) ...[
                Card(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ListTile(
                        title: Text(diff.file),
                        subtitle: Text(
                            '${diff.additions} additions, ${diff.deletions} deletions'),
                        leading: Icon(
                          diff.status == 'added'
                              ? Icons.add_circle
                              : diff.status == 'removed'
                                  ? Icons.remove_circle
                                  : Icons.edit,
                          color: diff.status == 'added'
                              ? Colors.green
                              : diff.status == 'removed'
                                  ? Colors.red
                                  : Colors.blue,
                        ),
                      ),
                      GitDiffViewer(diff: diff),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
              ],
            ],
          ),
        );
      },
    );
  }
  
  Widget _buildCommitsTab() {
    final pullRequestService = ref.read(pullRequestServiceProvider);
    
    return FutureBuilder<List<dynamic>>(
      future: pullRequestService.getCommits(widget.pullRequestId),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        
        if (snapshot.hasError) {
          return Center(
            child: Text('Error loading commits: ${snapshot.error}'),
          );
        }
        
        final commits = snapshot.data ?? [];
        
        if (commits.isEmpty) {
          return const Center(
            child: Text('No commits'),
          );
        }
        
        return ListView.builder(
          itemCount: commits.length,
          itemBuilder: (context, index) {
            final commit = commits[index];
            
            return Card(
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: ListTile(
                title: Text(commit.message),
                subtitle: Text(
                    'Author: ${commit.author}\nDate: ${commit.date.toString().substring(0, 19)}'),
                leading: const CircleAvatar(
                  child: Icon(Icons.commit),
                ),
                trailing: Text(
                  commit.sha.substring(0, 7),
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }
}