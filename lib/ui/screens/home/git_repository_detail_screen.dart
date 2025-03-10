import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/git_branch.dart';
import 'package:gaia_space/core/models/git_commit.dart';
import 'package:gaia_space/core/models/git_diff.dart';
import 'package:gaia_space/core/models/git_file.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/services/git_repository_manager.dart';
import 'package:gaia_space/core/services/git_service.dart';
import 'package:gaia_space/ui/widgets/git/activity_manager_view.dart';
import 'package:gaia_space/ui/widgets/git/commit_dialog.dart';
import 'package:gaia_space/ui/widgets/git/commit_graph.dart';
import 'package:gaia_space/ui/widgets/git/diff_viewer.dart';
import 'package:gaia_space/ui/widgets/git/file_list.dart';
import 'package:gaia_space/ui/widgets/git/repository_sidebar.dart';
import 'package:gaia_space/ui/widgets/loading_overlay.dart';

// Providers
final selectedRepositoryProvider = StateProvider<GitRepository?>((ref) => null);

final selectedViewProvider = StateProvider<String>((ref) => 'changes');

final selectedSidebarItemProvider = StateProvider<String?>((ref) => 'workspace-changes');

final selectedFileProvider = StateProvider<GitFile?>((ref) => null);

final selectedCommitProvider = StateProvider<GitCommit?>((ref) => null);

final isDiffSideBySideProvider = StateProvider<bool>((ref) => true);

class GitRepositoryDetailScreen extends ConsumerStatefulWidget {
  final String repositoryId;
  
  const GitRepositoryDetailScreen({
    Key? key,
    required this.repositoryId,
  }) : super(key: key);
  
  @override
  ConsumerState<GitRepositoryDetailScreen> createState() => _GitRepositoryDetailScreenState();
}

class _GitRepositoryDetailScreenState extends ConsumerState<GitRepositoryDetailScreen> with SingleTickerProviderStateMixin {
  final GitRepositoryManager _repositoryManager = GitRepositoryManager();
  final GitService _gitService = GitService();
  
  GitRepository? _repository;
  bool _isLoading = true;
  bool _isActivityPanelExpanded = false;
  
  // Data
  List<GitBranch> _branches = [];
  List<GitCommit> _commits = [];
  List<GitFile> _files = [];
  GitDiff? _selectedDiff;
  
  @override
  void initState() {
    super.initState();
    _loadRepository();
  }
  
  Future<void> _loadRepository() async {
    setState(() {
      _isLoading = true;
    });
    
    try {
      final repository = await _repositoryManager.getRepository(widget.repositoryId);
      
      if (repository != null && repository.path != null) {
        // Load initial data
        final branches = await _repositoryManager.getBranches(widget.repositoryId);
        
        final selectedView = ref.read(selectedViewProvider);
        
        if (selectedView == 'changes') {
          // Load files
          _files = await _gitService.getStatus(repository.path!);
        } else {
          // Load commits
          _commits = await _repositoryManager.getRecentCommits(
            widget.repositoryId, 
            limit: 100,
          );
        }
        
        setState(() {
          _repository = repository;
          _branches = branches;
          _isLoading = false;
        });
        
        // Update provider
        ref.read(selectedRepositoryProvider.notifier).state = repository;
      } else {
        setState(() {
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  Future<void> _refreshData() async {
    if (_repository?.path == null) return;
    
    final selectedView = ref.read(selectedViewProvider);
    
    if (selectedView == 'changes') {
      // Refresh files
      final files = await _gitService.getStatus(_repository!.path!);
      setState(() {
        _files = files;
      });
      
      // Update diff if needed
      final selectedFile = ref.read(selectedFileProvider);
      if (selectedFile != null) {
        await _loadFileDiff(selectedFile);
      }
    } else {
      // Refresh commits
      final commits = await _repositoryManager.getRecentCommits(
        widget.repositoryId, 
        limit: 100,
      );
      
      setState(() {
        _commits = commits;
      });
      
      // Update diff if needed
      final selectedCommit = ref.read(selectedCommitProvider);
      if (selectedCommit != null) {
        await _loadCommitDiff(selectedCommit);
      }
    }
    
    // Refresh branches
    final branches = await _repositoryManager.getBranches(widget.repositoryId);
    setState(() {
      _branches = branches;
    });
  }
  
  Future<void> _loadFileDiff(GitFile file) async {
    if (_repository?.path == null) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      final diff = await _gitService.getDiff(
        _repository!.path!,
        file.path,
        staged: file.isStaged,
      );
      
      setState(() {
        _selectedDiff = diff;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  Future<void> _loadCommitDiff(GitCommit commit) async {
    if (_repository?.path == null) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      final diff = await _gitService.getCommitDiff(
        _repository!.path!,
        commit.sha,
      );
      
      setState(() {
        _selectedDiff = diff;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  void _handleSidebarItemSelected(SidebarItem item) {
    // Update selected item
    ref.read(selectedSidebarItemProvider.notifier).state = item.id;
    
    // Handle different item types
    if (item.id == 'workspace-changes') {
      ref.read(selectedViewProvider.notifier).state = 'changes';
      ref.read(selectedFileProvider.notifier).state = null;
      ref.read(selectedCommitProvider.notifier).state = null;
      _selectedDiff = null;
      _refreshData();
    } else if (item.id == 'workspace-history') {
      ref.read(selectedViewProvider.notifier).state = 'history';
      ref.read(selectedFileProvider.notifier).state = null;
      ref.read(selectedCommitProvider.notifier).state = null;
      _selectedDiff = null;
      _refreshData();
    } else if (item.data is GitBranch) {
      // Handle branch selection
      final branch = item.data as GitBranch;
      _checkoutBranch(branch);
    }
  }
  
  Future<void> _checkoutBranch(GitBranch branch) async {
    if (_repository?.path == null) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      await _gitService.checkoutBranch(_repository!.path!, branch.name);
      
      // Refresh data after checkout
      await _refreshData();
      
      // Show confirmation
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Switched to branch ${branch.name}'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to checkout branch: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  void _handleFileSelected(GitFile file) {
    ref.read(selectedFileProvider.notifier).state = file;
    _loadFileDiff(file);
  }
  
  void _handleCommitSelected(GitCommit commit) {
    ref.read(selectedCommitProvider.notifier).state = commit;
    _loadCommitDiff(commit);
  }
  
  Future<void> _handleFileAction(GitFile file, String action) async {
    if (_repository?.path == null) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      switch (action) {
        case 'stage':
          await _gitService.stageFile(_repository!.path!, file.path);
          break;
        case 'unstage':
          await _gitService.unstageFile(_repository!.path!, file.path);
          break;
        case 'discard':
          // Confirm discard
          final confirmed = await showDialog<bool>(
            context: context,
            builder: (context) => AlertDialog(
              title: const Text('Discard Changes?'),
              content: Text('Are you sure you want to discard changes to ${file.fileName}? This cannot be undone.'),
              actions: [
                TextButton(
                  child: const Text('Cancel'),
                  onPressed: () => Navigator.of(context).pop(false),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red,
                  ),
                  child: const Text('Discard Changes'),
                  onPressed: () => Navigator.of(context).pop(true),
                ),
              ],
            ),
          );
          
          if (confirmed == true) {
            await _gitService.discardChanges(_repository!.path!, file.path);
          }
          break;
        case 'resolve':
          // TODO: Implement conflict resolution
          break;
        case 'ignore':
          // TODO: Implement ignore file
          break;
      }
      
      // Refresh data
      await _refreshData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  Future<void> _handleCommitAction(GitCommit commit, String action) async {
    if (_repository?.path == null) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      switch (action) {
        case 'checkout':
          await _gitService.checkoutBranch(_repository!.path!, commit.sha);
          break;
        case 'create_branch':
          // Show dialog to get branch name
          final branchName = await showDialog<String>(
            context: context,
            builder: (context) => _CreateBranchDialog(
              commitSha: commit.sha.substring(0, 7),
            ),
          );
          
          if (branchName != null && branchName.isNotEmpty) {
            await _gitService.createBranch(
              _repository!.path!, 
              branchName,
              startPoint: commit.sha,
            );
            await _gitService.checkoutBranch(_repository!.path!, branchName);
          }
          break;
        case 'cherry_pick':
          await _gitService.cherryPick(_repository!.path!, commit.sha);
          break;
        case 'reset':
          // Confirm reset
          final resetType = await showDialog<String>(
            context: context,
            builder: (context) => _ResetDialog(
              commitSha: commit.sha.substring(0, 7),
            ),
          );
          
          if (resetType != null) {
            await _gitService.reset(
              _repository!.path!, 
              commit.sha,
              hard: resetType == 'hard',
            );
          }
          break;
        case 'copy_sha':
          await Clipboard.setData(ClipboardData(text: commit.sha));
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Commit SHA copied to clipboard'),
              ),
            );
          }
          break;
      }
      
      // Refresh data
      await _refreshData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  Future<void> _handleCreateCommit() async {
    if (_repository?.path == null) return;
    
    final stagedFiles = _files.where((file) => file.isStaged).toList();
    
    if (stagedFiles.isEmpty) {
      // Show warning
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No staged changes to commit'),
          ),
        );
      }
      return;
    }
    
    // Show commit dialog
    if (mounted) {
      await CommitDialog.show(
        context: context,
        stagedFiles: stagedFiles,
        onCommit: (message, amend) async {
          setState(() {
            _isLoading = true;
          });
          
          try {
            await _gitService.createCommit(
              _repository!.path!,
              message,
              amend: amend,
            );
            
            // Refresh data
            await _refreshData();
            
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(amend 
                      ? 'Changes amended to previous commit' 
                      : 'Changes committed successfully'),
                ),
              );
            }
          } catch (e) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Failed to commit changes: $e'),
                  backgroundColor: Colors.red,
                ),
              );
            }
          } finally {
            setState(() {
              _isLoading = false;
            });
          }
        },
      );
    }
  }
  
  Future<void> _handleStagingAction(bool stageAll) async {
    if (_repository?.path == null) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      if (stageAll) {
        // Stage all unstaged files
        final filesToStage = _files.where((file) => 
            !file.isStaged && !file.isUntracked).toList();
        
        for (final file in filesToStage) {
          await _gitService.stageFile(_repository!.path!, file.path);
        }
      } else {
        // Unstage all staged files
        final filesToUnstage = _files.where((file) => file.isStaged).toList();
        
        for (final file in filesToUnstage) {
          await _gitService.unstageFile(_repository!.path!, file.path);
        }
      }
      
      // Refresh data
      await _refreshData();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  Future<void> _handlePull() async {
    if (_repository?.path == null) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      await _repositoryManager.pullRepository(widget.repositoryId);
      
      // Refresh data
      await _refreshData();
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Pull completed successfully'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to pull changes: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  Future<void> _handlePush() async {
    if (_repository?.path == null) return;
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      await _repositoryManager.pushRepository(widget.repositoryId);
      
      // Refresh data
      await _refreshData();
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Push completed successfully'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to push changes: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  Widget _buildChangesView() {
    final selectedFile = ref.watch(selectedFileProvider);
    final isSideBySide = ref.watch(isDiffSideBySideProvider);
    
    return Column(
      children: [
        // Toolbar for changes view
        _buildChangesToolbar(),
        
        // Files and diff
        Expanded(
          child: Row(
            children: [
              // File list
              SizedBox(
                width: 300,
                child: GitFileList(
                  files: _files,
                  selectedFilePath: selectedFile?.path,
                  onFileSelected: _handleFileSelected,
                  onFileAction: _handleFileAction,
                ),
              ),
              
              // Divider
              Container(
                width: 1,
                color: Theme.of(context).dividerColor,
              ),
              
              // Diff viewer
              Expanded(
                child: selectedFile == null
                    ? const Center(
                        child: Text('Select a file to view changes'),
                      )
                    : GitDiffViewer(
                        diff: _selectedDiff,
                        sideBySide: isSideBySide,
                        isDarkMode: Theme.of(context).brightness == Brightness.dark,
                      ),
              ),
            ],
          ),
        ),
      ],
    );
  }
  
  Widget _buildHistoryView() {
    final selectedCommit = ref.watch(selectedCommitProvider);
    final isSideBySide = ref.watch(isDiffSideBySideProvider);
    
    return Column(
      children: [
        // Toolbar for history view
        _buildHistoryToolbar(),
        
        // Commits and diff
        Expanded(
          child: Row(
            children: [
              // Commit list
              SizedBox(
                width: 450,
                child: CommitGraph(
                  commits: _commits,
                  branches: _branches,
                  selectedCommitSha: selectedCommit?.sha,
                  onCommitSelected: _handleCommitSelected,
                  onCommitAction: _handleCommitAction,
                ),
              ),
              
              // Divider
              Container(
                width: 1,
                color: Theme.of(context).dividerColor,
              ),
              
              // Diff viewer
              Expanded(
                child: selectedCommit == null
                    ? const Center(
                        child: Text('Select a commit to view changes'),
                      )
                    : GitDiffViewer(
                        diff: _selectedDiff,
                        sideBySide: isSideBySide,
                        isDarkMode: Theme.of(context).brightness == Brightness.dark,
                      ),
              ),
            ],
          ),
        ),
      ],
    );
  }
  
  Widget _buildChangesToolbar() {
    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? Colors.grey.shade900
            : Colors.grey.shade200,
        border: Border(
          bottom: BorderSide(
            color: Theme.of(context).dividerColor,
          ),
        ),
      ),
      child: Row(
        children: [
          // Stage all button
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'Stage all changes',
            onPressed: () => _handleStagingAction(true),
          ),
          
          // Unstage all button
          IconButton(
            icon: const Icon(Icons.remove),
            tooltip: 'Unstage all changes',
            onPressed: () => _handleStagingAction(false),
          ),
          
          const SizedBox(width: 8),
          
          // Commit button
          ElevatedButton.icon(
            icon: const Icon(Icons.check),
            label: const Text('Commit'),
            onPressed: _handleCreateCommit,
          ),
          
          const Spacer(),
          
          // Refresh button
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: _refreshData,
          ),
          
          // Pull button
          IconButton(
            icon: const Icon(Icons.download),
            tooltip: 'Pull',
            onPressed: _handlePull,
          ),
          
          // Push button
          IconButton(
            icon: const Icon(Icons.upload),
            tooltip: 'Push',
            onPressed: _handlePush,
          ),
          
          const SizedBox(width: 8),
          
          // Diff view toggle
          IconButton(
            icon: Icon(
              ref.watch(isDiffSideBySideProvider)
                  ? Icons.view_column
                  : Icons.view_headline,
            ),
            tooltip: 'Toggle diff view',
            onPressed: () {
              ref.read(isDiffSideBySideProvider.notifier).state = 
                  !ref.read(isDiffSideBySideProvider);
            },
          ),
        ],
      ),
    );
  }
  
  Widget _buildHistoryToolbar() {
    return Container(
      height: 48,
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? Colors.grey.shade900
            : Colors.grey.shade200,
        border: Border(
          bottom: BorderSide(
            color: Theme.of(context).dividerColor,
          ),
        ),
      ),
      child: Row(
        children: [
          // Search field (placeholder)
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(8.0),
              child: TextField(
                decoration: const InputDecoration(
                  hintText: 'Search commits',
                  prefixIcon: Icon(Icons.search),
                  contentPadding: EdgeInsets.symmetric(vertical: 8.0),
                  border: OutlineInputBorder(),
                ),
                onChanged: (value) {
                  // TODO: Implement search
                },
              ),
            ),
          ),
          
          // Refresh button
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: _refreshData,
          ),
          
          // Pull button
          IconButton(
            icon: const Icon(Icons.download),
            tooltip: 'Pull',
            onPressed: _handlePull,
          ),
          
          // Push button
          IconButton(
            icon: const Icon(Icons.upload),
            tooltip: 'Push',
            onPressed: _handlePush,
          ),
          
          const SizedBox(width: 8),
          
          // Diff view toggle
          IconButton(
            icon: Icon(
              ref.watch(isDiffSideBySideProvider)
                  ? Icons.view_column
                  : Icons.view_headline,
            ),
            tooltip: 'Toggle diff view',
            onPressed: () {
              ref.read(isDiffSideBySideProvider.notifier).state = 
                  !ref.read(isDiffSideBySideProvider);
            },
          ),
        ],
      ),
    );
  }
  
  @override
  Widget build(BuildContext context) {
    final selectedView = ref.watch(selectedViewProvider);
    final selectedSidebarItem = ref.watch(selectedSidebarItemProvider);
    
    if (_isLoading) {
      return const LoadingOverlay();
    }
    
    if (_repository == null) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Repository Not Found'),
        ),
        body: const Center(
          child: Text('The specified repository could not be found.'),
        ),
      );
    }
    
    return Scaffold(
      appBar: AppBar(
        title: Text(_repository!.name),
        actions: [
          IconButton(
            icon: Icon(_isActivityPanelExpanded 
                ? Icons.expand_less 
                : Icons.expand_more),
            tooltip: 'Toggle activity panel',
            onPressed: () {
              setState(() {
                _isActivityPanelExpanded = !_isActivityPanelExpanded;
              });
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Main content
          Expanded(
            child: Row(
              children: [
                // Sidebar
                SizedBox(
                  width: 250,
                  child: RepositorySidebar(
                    repository: _repository!,
                    selectedItemId: selectedSidebarItem,
                    onItemSelected: _handleSidebarItemSelected,
                  ),
                ),
                
                // Divider
                Container(
                  width: 1,
                  color: Theme.of(context).dividerColor,
                ),
                
                // Main content
                Expanded(
                  child: selectedView == 'changes'
                      ? _buildChangesView()
                      : _buildHistoryView(),
                ),
              ],
            ),
          ),
          
          // Activity panel
          if (_isActivityPanelExpanded)
            Column(
              children: [
                Container(
                  height: 1,
                  color: Theme.of(context).dividerColor,
                ),
                ActivityManagerView(
                  repositoryId: widget.repositoryId,
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _CreateBranchDialog extends StatefulWidget {
  final String commitSha;
  
  const _CreateBranchDialog({
    Key? key,
    required this.commitSha,
  }) : super(key: key);
  
  @override
  _CreateBranchDialogState createState() => _CreateBranchDialogState();
}

class _CreateBranchDialogState extends State<_CreateBranchDialog> {
  final TextEditingController _branchNameController = TextEditingController();
  
  @override
  void dispose() {
    _branchNameController.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Create New Branch'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Creating branch from commit ${widget.commitSha}'),
          const SizedBox(height: 16),
          TextField(
            controller: _branchNameController,
            decoration: const InputDecoration(
              labelText: 'Branch Name',
              border: OutlineInputBorder(),
            ),
            autofocus: true,
            onSubmitted: (value) {
              if (value.isNotEmpty) {
                Navigator.of(context).pop(value);
              }
            },
          ),
        ],
      ),
      actions: [
        TextButton(
          child: const Text('Cancel'),
          onPressed: () => Navigator.of(context).pop(),
        ),
        ElevatedButton(
          child: const Text('Create Branch'),
          onPressed: () {
            final name = _branchNameController.text.trim();
            if (name.isNotEmpty) {
              Navigator.of(context).pop(name);
            }
          },
        ),
      ],
    );
  }
}

class _ResetDialog extends StatelessWidget {
  final String commitSha;
  
  const _ResetDialog({
    Key? key,
    required this.commitSha,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Reset to Commit'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Reset current branch to commit $commitSha'),
          const SizedBox(height: 16),
          const Text('Choose reset type:'),
          const SizedBox(height: 8),
          
          // Soft reset
          ListTile(
            title: const Text('Soft Reset'),
            subtitle: const Text('Keep changes in working directory and staging area'),
            onTap: () => Navigator.of(context).pop('soft'),
          ),
          
          // Hard reset
          ListTile(
            title: const Text('Hard Reset'),
            subtitle: const Text('Discard all changes (cannot be undone)'),
            onTap: () => Navigator.of(context).pop('hard'),
          ),
        ],
      ),
      actions: [
        TextButton(
          child: const Text('Cancel'),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ],
    );
  }
}