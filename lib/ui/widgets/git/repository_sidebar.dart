import 'package:flutter/material.dart';
import 'package:flutter_fancy_tree_view/flutter_fancy_tree_view.dart';
import 'package:gaia_space/core/models/git_branch.dart';
import 'package:gaia_space/core/models/git_remote.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/services/git_repository_manager.dart';
import 'package:gaia_space/core/services/git_service.dart';

class SidebarItem {
  final String id;
  final String title;
  final IconData icon;
  final String? parentId;
  final dynamic data;
  final bool isExpanded;
  final int? count;

  SidebarItem({
    required this.id,
    required this.title,
    required this.icon,
    this.parentId,
    this.data,
    this.isExpanded = false,
    this.count,
  });

  SidebarItem copyWith({
    String? id,
    String? title,
    IconData? icon,
    String? parentId,
    dynamic data,
    bool? isExpanded,
    int? count,
  }) {
    return SidebarItem(
      id: id ?? this.id,
      title: title ?? this.title,
      icon: icon ?? this.icon,
      parentId: parentId ?? this.parentId,
      data: data ?? this.data,
      isExpanded: isExpanded ?? this.isExpanded,
      count: count ?? this.count,
    );
  }
}

class RepositorySidebar extends StatefulWidget {
  final GitRepository repository;
  final String? selectedItemId;
  final Function(SidebarItem item) onItemSelected;
  final Function(SidebarItem item, String action)? onAction;

  const RepositorySidebar({
    Key? key,
    required this.repository,
    this.selectedItemId,
    required this.onItemSelected,
    this.onAction,
  }) : super(key: key);

  @override
  _RepositorySidebarState createState() => _RepositorySidebarState();
}

class _RepositorySidebarState extends State<RepositorySidebar> {
  late TreeController<SidebarItem> _treeController;
  final GitService _gitService = GitService();
  final GitRepositoryManager _repositoryManager = GitRepositoryManager();
  
  List<SidebarItem> _items = [];
  bool _isLoading = true;
  
  @override
  void initState() {
    super.initState();
    _treeController = TreeController<SidebarItem>(
      roots: [],
      childrenProvider: (SidebarItem item) {
        return _items.where((node) => node.parentId == item.id).toList();
      },
    );
    _loadRepositoryData();
  }
  
  @override
  void didUpdateWidget(RepositorySidebar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repository.id != widget.repository.id) {
      _loadRepositoryData();
    }
  }
  
  @override
  void dispose() {
    _treeController.dispose();
    super.dispose();
  }
  
  Future<void> _loadRepositoryData() async {
    if (widget.repository.path == null) {
      setState(() {
        _isLoading = false;
        _items = [];
      });
      return;
    }
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      // Create base tree structure
      final items = <SidebarItem>[];
      
      // Add root items
      items.add(SidebarItem(
        id: 'workspace',
        title: 'Workspace',
        icon: Icons.work_outline,
        isExpanded: true,
      ));
      
      items.add(SidebarItem(
        id: 'branches',
        title: 'Branches',
        icon: Icons.call_split,
        isExpanded: true,
      ));
      
      items.add(SidebarItem(
        id: 'remotes',
        title: 'Remotes',
        icon: Icons.cloud,
        isExpanded: true,
      ));
      
      items.add(SidebarItem(
        id: 'tags',
        title: 'Tags',
        icon: Icons.bookmark_border,
      ));
      
      items.add(SidebarItem(
        id: 'stashes',
        title: 'Stashes',
        icon: Icons.save_outlined,
      ));
      
      // Load branches
      final branches = await _repositoryManager.getBranches(widget.repository.id);
      
      // Group branches by local/remote
      final localBranches = branches.where((b) => b.isLocal).toList();
      final remoteBranches = branches.where((b) => b.isRemote).toList();
      
      // Add local branches
      for (final branch in localBranches) {
        items.add(SidebarItem(
          id: 'branch-${branch.name}',
          title: branch.shortName,
          icon: branch.isHead ? Icons.check_circle : Icons.circle_outlined,
          parentId: 'branches',
          data: branch,
        ));
      }
      
      // Load remotes
      final remotes = await _gitService.getRemotes(widget.repository.path!);
      
      // Add remotes and their branches
      for (final remote in remotes) {
        items.add(SidebarItem(
          id: 'remote-${remote.name}',
          title: remote.name,
          icon: Icons.cloud,
          parentId: 'remotes',
          data: remote,
        ));
        
        // Add remote branches
        for (final branch in remoteBranches) {
          if (branch.name.startsWith('${remote.name}/')) {
            items.add(SidebarItem(
              id: 'branch-${branch.name}',
              title: branch.name.replaceFirst('${remote.name}/', ''),
              icon: Icons.circle_outlined,
              parentId: 'remote-${remote.name}',
              data: branch,
            ));
          }
        }
      }
      
      // Load stashes
      final stashes = await _gitService.getStashes(widget.repository.path!);
      
      // Add stashes
      for (int i = 0; i < stashes.length; i++) {
        final stash = stashes[i];
        items.add(SidebarItem(
          id: 'stash-$i',
          title: stash.message,
          icon: Icons.save,
          parentId: 'stashes',
          data: stash,
        ));
      }
      
      // Add workspace items
      items.add(SidebarItem(
        id: 'workspace-changes',
        title: 'Changes',
        icon: Icons.edit_note,
        parentId: 'workspace',
      ));
      
      items.add(SidebarItem(
        id: 'workspace-history',
        title: 'History',
        icon: Icons.history,
        parentId: 'workspace',
      ));
      
      setState(() {
        _items = items;
        _isLoading = false;
      });
      
      // Expand default nodes
      _treeController.roots = items.where((node) => node.parentId == null).toList();
      
      // Auto-expand some sections
      final toExpand = ['workspace', 'branches', 'remotes'];
      for (final id in toExpand) {
        final node = items.firstWhere((item) => item.id == id);
        _treeController.expand(node);
      }
    } catch (e) {
      setState(() {
        _isLoading = false;
      });
    }
  }
  
  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(),
      );
    }
    
    if (_items.isEmpty) {
      return const Center(
        child: Text('Repository not found or empty'),
      );
    }
    
    return TreeView(
      shrinkWrap: true,
      treeController: _treeController,
      nodeBuilder: (BuildContext context, TreeEntry<SidebarItem> entry) {
        final node = entry.node;
        final isSelected = widget.selectedItemId == node.id;
        
        return TreeIndentation(
          entry: entry,
          child: ListTile(
            dense: true,
            selected: isSelected,
            selectedTileColor: Theme.of(context).colorScheme.primaryContainer.withOpacity(0.15),
            leading: Icon(
              node.icon,
              size: 20,
              color: isSelected 
                  ? Theme.of(context).colorScheme.primary
                  : Theme.of(context).iconTheme.color,
            ),
            title: Row(
              children: [
                Expanded(
                  child: Text(
                    node.title,
                    style: TextStyle(
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                      color: isSelected 
                          ? Theme.of(context).colorScheme.primary
                          : Theme.of(context).textTheme.bodyMedium?.color,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (node.count != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: Theme.of(context).chipTheme.backgroundColor,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '${node.count}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
              ],
            ),
            trailing: _buildTrailingWidget(node),
            onTap: () {
              widget.onItemSelected(node);
            },
            onLongPress: () {
              _showContextMenu(context, node);
            },
          ),
        );
      },
    );
  }
  
  Widget? _buildTrailingWidget(SidebarItem node) {
    // Build custom indicators for specific item types
    if (node.data is GitBranch) {
      final branch = node.data as GitBranch;
      
      if (branch.isTrackingUpstream && branch.hasChanges) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (branch.ahead != null && branch.ahead! > 0)
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Tooltip(
                  message: '${branch.ahead} commit(s) ahead',
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.arrow_upward, size: 14),
                      Text('${branch.ahead}', style: const TextStyle(fontSize: 12)),
                    ],
                  ),
                ),
              ),
            if (branch.behind != null && branch.behind! > 0)
              Tooltip(
                message: '${branch.behind} commit(s) behind',
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.arrow_downward, size: 14),
                    Text('${branch.behind}', style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
          ],
        );
      }
    }
    
    // For parent items, show expand/collapse button
    if (_treeController.getChildren(node).isNotEmpty) {
      return ExpanderButton(
        padding: EdgeInsets.zero,
        treeController: _treeController,
        entry: TreeEntry<SidebarItem>(node),
        icon: const Icon(Icons.chevron_right, size: 18),
        expandedIcon: const Icon(Icons.expand_more, size: 18),
      );
    }
    
    return null;
  }
  
  void _showContextMenu(BuildContext context, SidebarItem node) {
    final RenderBox renderBox = context.findRenderObject() as RenderBox;
    final position = renderBox.localToGlobal(Offset.zero);
    
    final List<PopupMenuItem<String>> menuItems = [];
    
    // Build different menu items based on node type
    if (node.data is GitBranch) {
      final branch = node.data as GitBranch;
      
      if (branch.isLocal && !branch.isHead) {
        menuItems.add(
          const PopupMenuItem<String>(
            value: 'checkout',
            child: Text('Checkout'),
          ),
        );
        
        menuItems.add(
          const PopupMenuItem<String>(
            value: 'merge',
            child: Text('Merge into current branch'),
          ),
        );
        
        menuItems.add(
          const PopupMenuItem<String>(
            value: 'rebase',
            child: Text('Rebase current branch onto this'),
          ),
        );
        
        menuItems.add(
          const PopupMenuItem<String>(
            value: 'delete',
            child: Text('Delete'),
          ),
        );
      } else if (branch.isRemote) {
        menuItems.add(
          const PopupMenuItem<String>(
            value: 'checkout',
            child: Text('Checkout as local branch'),
          ),
        );
        
        menuItems.add(
          const PopupMenuItem<String>(
            value: 'fetch',
            child: Text('Fetch from remote'),
          ),
        );
      }
    } else if (node.data is GitRemote) {
      menuItems.add(
        const PopupMenuItem<String>(
          value: 'fetch',
          child: Text('Fetch'),
        ),
      );
      
      menuItems.add(
        const PopupMenuItem<String>(
          value: 'pull',
          child: Text('Pull'),
        ),
      );
      
      menuItems.add(
        const PopupMenuItem<String>(
          value: 'push',
          child: Text('Push'),
        ),
      );
    }
    
    if (menuItems.isNotEmpty) {
      showMenu(
        context: context,
        position: RelativeRect.fromLTRB(
          position.dx + 300, // Adjust this value based on your UI
          position.dy,
          position.dx,
          position.dy + 50,
        ),
        items: menuItems,
      ).then((String? action) {
        if (action != null && widget.onAction != null) {
          widget.onAction!(node, action);
        }
      });
    }
  }
}