import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gaia_space/core/models/repository.dart';

/// A command palette widget for quick actions and navigation
class QuickLaunchMenu extends StatefulWidget {
  final List<QuickAction> actions;
  final Function(QuickAction) onActionSelected;
  final List<GitRepository>? repositories;
  final Function(GitRepository)? onRepositorySelected;
  final bool isDarkMode;

  const QuickLaunchMenu({
    Key? key,
    required this.actions,
    required this.onActionSelected,
    this.repositories,
    this.onRepositorySelected,
    this.isDarkMode = false,
  }) : super(key: key);

  @override
  _QuickLaunchMenuState createState() => _QuickLaunchMenuState();
}

class _QuickLaunchMenuState extends State<QuickLaunchMenu> {
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  QuickLaunchMode _mode = QuickLaunchMode.actions;
  
  List<QuickAction> _filteredActions = [];
  List<GitRepository> _filteredRepositories = [];
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    _filteredActions = widget.actions;
    _filteredRepositories = widget.repositories ?? [];
    _searchController.addListener(_onSearchChanged);
    
    // Auto-focus the search field
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _searchFocusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _searchController.removeListener(_onSearchChanged);
    _searchController.dispose();
    _searchFocusNode.dispose();
    super.dispose();
  }

  void _onSearchChanged() {
    final query = _searchController.text.toLowerCase();
    
    setState(() {
      if (_mode == QuickLaunchMode.actions) {
        _filteredActions = widget.actions.where((action) {
          return action.title.toLowerCase().contains(query) ||
              (action.shortcut?.toLowerCase().contains(query) ?? false) ||
              (action.description?.toLowerCase().contains(query) ?? false);
        }).toList();
      } else {
        _filteredRepositories = (widget.repositories ?? []).where((repo) {
          return repo.name.toLowerCase().contains(query) ||
              (repo.description?.toLowerCase().contains(query) ?? false);
        }).toList();
      }
      
      _selectedIndex = 0; // Reset selection on search change
    });
  }

  void _handleKeyEvent(RawKeyEvent event) {
    if (event is RawKeyDownEvent) {
      if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
        setState(() {
          final itemCount = _mode == QuickLaunchMode.actions
              ? _filteredActions.length
              : _filteredRepositories.length;
          
          if (itemCount > 0) {
            _selectedIndex = (_selectedIndex + 1) % itemCount;
          }
        });
      } else if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
        setState(() {
          final itemCount = _mode == QuickLaunchMode.actions
              ? _filteredActions.length
              : _filteredRepositories.length;
          
          if (itemCount > 0) {
            _selectedIndex = (_selectedIndex - 1 + itemCount) % itemCount;
          }
        });
      } else if (event.logicalKey == LogicalKeyboardKey.enter ||
                event.logicalKey == LogicalKeyboardKey.select) {
        _selectCurrentItem();
      } else if (event.logicalKey == LogicalKeyboardKey.tab) {
        // Toggle between actions and repositories
        setState(() {
          _mode = _mode == QuickLaunchMode.actions
              ? QuickLaunchMode.repositories
              : QuickLaunchMode.actions;
          _selectedIndex = 0;
        });
      }
    }
  }

  void _selectCurrentItem() {
    if (_mode == QuickLaunchMode.actions) {
      if (_selectedIndex >= 0 && _selectedIndex < _filteredActions.length) {
        final selectedAction = _filteredActions[_selectedIndex];
        widget.onActionSelected(selectedAction);
      }
    } else {
      if (_selectedIndex >= 0 && _selectedIndex < _filteredRepositories.length && widget.onRepositorySelected != null) {
        final selectedRepo = _filteredRepositories[_selectedIndex];
        widget.onRepositorySelected!(selectedRepo);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final backgroundColor = widget.isDarkMode
        ? Colors.grey.shade900
        : Colors.white;
    
    final textColor = widget.isDarkMode
        ? Colors.white
        : Colors.black;
    
    final highlightColor = widget.isDarkMode
        ? Colors.blue.shade700.withOpacity(0.2)
        : Colors.blue.shade50;
    
    return Material(
      color: Colors.transparent,
      child: Center(
        child: Container(
          width: 600,
          height: 500,
          decoration: BoxDecoration(
            color: backgroundColor,
            borderRadius: BorderRadius.circular(8),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 10,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Column(
            children: [
              // Search bar
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: RawKeyboardListener(
                  focusNode: FocusNode(),
                  onKey: _handleKeyEvent,
                  child: TextField(
                    controller: _searchController,
                    focusNode: _searchFocusNode,
                    decoration: InputDecoration(
                      hintText: 'Search actions or repositories...',
                      prefixIcon: const Icon(Icons.search),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      suffixIcon: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          // Mode toggle
                          TextButton.icon(
                            icon: Icon(
                              _mode == QuickLaunchMode.actions
                                  ? Icons.code
                                  : Icons.folder,
                              size: 16,
                            ),
                            label: Text(
                              _mode == QuickLaunchMode.actions
                                  ? 'Actions'
                                  : 'Repositories',
                              style: const TextStyle(fontSize: 12),
                            ),
                            onPressed: () {
                              setState(() {
                                _mode = _mode == QuickLaunchMode.actions
                                    ? QuickLaunchMode.repositories
                                    : QuickLaunchMode.actions;
                                _selectedIndex = 0;
                              });
                            },
                          ),
                          // Clear button
                          if (_searchController.text.isNotEmpty)
                            IconButton(
                              icon: const Icon(Icons.clear),
                              onPressed: () {
                                _searchController.clear();
                              },
                              iconSize: 16,
                            ),
                        ],
                      ),
                    ),
                    onSubmitted: (_) => _selectCurrentItem(),
                  ),
                ),
              ),
              
              // Tab buttons
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0),
                child: Row(
                  children: [
                    _buildTabButton(
                      title: 'Actions',
                      icon: Icons.code,
                      isSelected: _mode == QuickLaunchMode.actions,
                      onTap: () {
                        setState(() {
                          _mode = QuickLaunchMode.actions;
                          _selectedIndex = 0;
                        });
                      },
                    ),
                    const SizedBox(width: 8),
                    _buildTabButton(
                      title: 'Repositories',
                      icon: Icons.folder,
                      isSelected: _mode == QuickLaunchMode.repositories,
                      onTap: () {
                        setState(() {
                          _mode = QuickLaunchMode.repositories;
                          _selectedIndex = 0;
                        });
                      },
                    ),
                  ],
                ),
              ),
              
              // Results list
              Expanded(
                child: _mode == QuickLaunchMode.actions
                    ? _buildActionsList(highlightColor, textColor)
                    : _buildRepositoriesList(highlightColor, textColor),
              ),
              
              // Keyboard shortcuts help
              Padding(
                padding: const EdgeInsets.all(8.0),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _buildKeyboardShortcutHelp('↑↓', 'Navigate'),
                    const SizedBox(width: 16),
                    _buildKeyboardShortcutHelp('Tab', 'Switch tabs'),
                    const SizedBox(width: 16),
                    _buildKeyboardShortcutHelp('Enter', 'Select'),
                    const SizedBox(width: 16),
                    _buildKeyboardShortcutHelp('Esc', 'Close'),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTabButton({
    required String title,
    required IconData icon,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(4),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected
              ? (widget.isDarkMode ? Colors.blue.shade700 : Colors.blue.shade100)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(4),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              size: 16,
              color: isSelected
                  ? (widget.isDarkMode ? Colors.white : Colors.blue.shade800)
                  : null,
            ),
            const SizedBox(width: 8),
            Text(
              title,
              style: TextStyle(
                color: isSelected
                    ? (widget.isDarkMode ? Colors.white : Colors.blue.shade800)
                    : null,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActionsList(Color highlightColor, Color textColor) {
    if (_filteredActions.isEmpty) {
      return Center(
        child: Text(
          'No actions found',
          style: TextStyle(color: textColor.withOpacity(0.5)),
        ),
      );
    }
    
    return ListView.builder(
      itemCount: _filteredActions.length,
      itemBuilder: (context, index) {
        final action = _filteredActions[index];
        final isSelected = index == _selectedIndex;
        
        return InkWell(
          onTap: () {
            setState(() {
              _selectedIndex = index;
            });
            widget.onActionSelected(action);
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: isSelected ? highlightColor : Colors.transparent,
            child: Row(
              children: [
                Icon(action.icon, color: action.iconColor),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        action.title,
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: textColor,
                        ),
                      ),
                      if (action.description != null)
                        Text(
                          action.description!,
                          style: TextStyle(
                            fontSize: 12,
                            color: textColor.withOpacity(0.7),
                          ),
                        ),
                    ],
                  ),
                ),
                if (action.shortcut != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: widget.isDarkMode
                          ? Colors.grey.shade800
                          : Colors.grey.shade200,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      action.shortcut!,
                      style: TextStyle(
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: textColor.withOpacity(0.7),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildRepositoriesList(Color highlightColor, Color textColor) {
    if (_filteredRepositories.isEmpty) {
      return Center(
        child: Text(
          'No repositories found',
          style: TextStyle(color: textColor.withOpacity(0.5)),
        ),
      );
    }
    
    return ListView.builder(
      itemCount: _filteredRepositories.length,
      itemBuilder: (context, index) {
        final repo = _filteredRepositories[index];
        final isSelected = index == _selectedIndex;
        
        return InkWell(
          onTap: () {
            setState(() {
              _selectedIndex = index;
            });
            if (widget.onRepositorySelected != null) {
              widget.onRepositorySelected!(repo);
            }
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: isSelected ? highlightColor : Colors.transparent,
            child: Row(
              children: [
                Icon(
                  repo.isFork ? Icons.fork_right : Icons.folder,
                  color: widget.isDarkMode ? Colors.white70 : Colors.black87,
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        repo.name,
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: textColor,
                        ),
                      ),
                      if (repo.description != null)
                        Text(
                          repo.description!,
                          style: TextStyle(
                            fontSize: 12,
                            color: textColor.withOpacity(0.7),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      if (repo.path != null)
                        Text(
                          repo.path!,
                          style: TextStyle(
                            fontSize: 10,
                            fontFamily: 'monospace',
                            color: textColor.withOpacity(0.5),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                    ],
                  ),
                ),
                // Repository stats
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.call_split, size: 14),
                        const SizedBox(width: 4),
                        Text(
                          '${repo.branchesCount}',
                          style: TextStyle(
                            fontSize: 12,
                            color: textColor.withOpacity(0.7),
                          ),
                        ),
                      ],
                    ),
                    if (repo.commitsCount != null)
                      Row(
                        children: [
                          const Icon(Icons.commit, size: 14),
                          const SizedBox(width: 4),
                          Text(
                            '${repo.commitsCount}',
                            style: TextStyle(
                              fontSize: 12,
                              color: textColor.withOpacity(0.7),
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildKeyboardShortcutHelp(String key, String description) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: widget.isDarkMode
                ? Colors.grey.shade800
                : Colors.grey.shade200,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(
              color: widget.isDarkMode
                  ? Colors.grey.shade700
                  : Colors.grey.shade300,
            ),
          ),
          child: Text(
            key,
            style: TextStyle(
              fontSize: 12,
              fontFamily: 'monospace',
              color: widget.isDarkMode
                  ? Colors.white
                  : Colors.black,
            ),
          ),
        ),
        const SizedBox(width: 4),
        Text(
          description,
          style: TextStyle(
            fontSize: 12,
            color: widget.isDarkMode
                ? Colors.white70
                : Colors.black54,
          ),
        ),
      ],
    );
  }
}

/// Quick action model for the command palette
class QuickAction {
  final String id;
  final String title;
  final String? description;
  final String? shortcut;
  final IconData icon;
  final Color? iconColor;
  final Function()? action;

  QuickAction({
    required this.id,
    required this.title,
    this.description,
    this.shortcut,
    required this.icon,
    this.iconColor,
    this.action,
  });
}

/// Mode for the quick launch menu
enum QuickLaunchMode {
  actions,
  repositories,
}