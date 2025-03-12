import 'package:flutter/material.dart';
import 'package:flutter_slidable/flutter_slidable.dart';
import 'package:gaia_space/core/models/git_file.dart';

class GitFileList extends StatefulWidget {
  final List<GitFile> files;
  final bool showUntracked;
  final String? selectedFilePath;
  final Function(GitFile file) onFileSelected;
  final Function(GitFile file, String action)? onFileAction;

  const GitFileList({
    Key? key,
    required this.files,
    this.showUntracked = true,
    this.selectedFilePath,
    required this.onFileSelected,
    this.onFileAction,
  }) : super(key: key);

  @override
  GitFileListState createState() => GitFileListState();
}

class GitFileListState extends State<GitFileList> {
  // Group files by category
  List<GitFile> _stagedFiles = [];
  List<GitFile> _modifiedFiles = [];
  List<GitFile> _untrackedFiles = [];
  List<GitFile> _conflictedFiles = [];
  
  // Directory navigation
  String _currentDirectory = '';
  bool _showDirectoryView = false;
  
  @override
  void initState() {
    super.initState();
    _categorizeFiles();
  }
  
  @override
  void didUpdateWidget(GitFileList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.files != oldWidget.files || widget.showUntracked != oldWidget.showUntracked) {
      _categorizeFiles();
    }
  }
  
  void _categorizeFiles() {
    _stagedFiles = widget.files.where((file) => file.isStaged).toList();
    _modifiedFiles = widget.files.where((file) => !file.isStaged && !file.isUntracked && !file.isConflicted).toList();
    _untrackedFiles = widget.files.where((file) => file.isUntracked).toList();
    _conflictedFiles = widget.files.where((file) => file.isConflicted).toList();
  }
  
  // Check if there are directories in the current set of files
  bool _hasDirectories() {
    final allFiles = [..._stagedFiles, ..._modifiedFiles, ..._untrackedFiles, ..._conflictedFiles];
    for (final file in allFiles) {
      if (file.path.contains('/')) {
        return true;
      }
    }
    return false;
  }
  
  // Navigate to a directory
  void _navigateToDirectory(String dirPath) {
    setState(() {
      _currentDirectory = dirPath;
      _showDirectoryView = true;
    });
  }
  
  // Navigate up one level
  void _navigateUp() {
    setState(() {
      if (_currentDirectory.isEmpty) {
        _showDirectoryView = false;
      } else {
        final parentDir = _currentDirectory.contains('/')
            ? _currentDirectory.substring(0, _currentDirectory.lastIndexOf('/'))
            : '';
        _currentDirectory = parentDir;
      }
    });
  }
  
  // Get unique directories at the current level
  Set<String> _getDirectoriesAtCurrentLevel(List<GitFile> files) {
    final dirs = <String>{};
    
    for (final file in files) {
      if (_currentDirectory.isEmpty) {
        // At root level, get top-level directories
        if (file.path.contains('/')) {
          final topDir = file.path.substring(0, file.path.indexOf('/'));
          dirs.add(topDir);
        }
      } else {
        // In a subdirectory, get immediate child directories
        if (file.isInDirectory(_currentDirectory)) {
          final childPath = file.getChildPath(_currentDirectory);
          if (childPath.contains('/')) {
            dirs.add('$_currentDirectory/$childPath');
          }
        }
      }
    }
    
    return dirs;
  }
  
  // Filter files for the current view
  List<GitFile> _filterFilesForCurrentView(List<GitFile> files) {
    if (!_showDirectoryView) {
      // Show only root-level files when not in directory view
      return files.where((file) => !file.path.contains('/')).toList();
    } else if (_currentDirectory.isEmpty) {
      // At root level in directory view, show only top-level files
      return files.where((file) => !file.path.contains('/')).toList();
    } else {
      // In a subdirectory, show only immediate children that are files
      return files.where((file) {
        if (!file.path.startsWith('$_currentDirectory/')) return false;
        
        final relativePath = file.path.substring(_currentDirectory.length + 1);
        return !relativePath.contains('/');
      }).toList();
    }
  }
  
  @override
  Widget build(BuildContext context) {
    // Detect if we have directories and should enable directory navigation
    final hasDirectories = _hasDirectories();
    
    return Column(
      children: [
        // Directory navigation bar
        if (hasDirectories)
          _buildDirectoryNavigationBar(),
        
        // File list
        Expanded(
          child: Scrollbar(
            child: ListView(
              children: [
                // Directories at current level (only in directory view)
                if (_showDirectoryView)
                  _buildDirectoriesSection(),
                
                // Conflicted files
                if (_conflictedFiles.isNotEmpty)
                  _buildSection('Conflicts', _filterFilesForCurrentView(_conflictedFiles), Colors.red),
                
                // Staged files
                if (_stagedFiles.isNotEmpty) 
                  _buildSection('Staged Changes', _filterFilesForCurrentView(_stagedFiles), Colors.green),
                
                // Modified files
                if (_modifiedFiles.isNotEmpty)
                  _buildSection('Changes', _filterFilesForCurrentView(_modifiedFiles), Colors.amber),
                
                // Untracked files
                if (_untrackedFiles.isNotEmpty && widget.showUntracked)
                  _buildSection('Untracked Files', _filterFilesForCurrentView(_untrackedFiles), Colors.grey),
                
                // Empty state
                if (widget.files.isEmpty)
                  const Center(
                    child: Padding(
                      padding: EdgeInsets.all(16.0),
                      child: Text(
                        'No changes',
                        style: TextStyle(
                          fontStyle: FontStyle.italic,
                          color: Colors.grey,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
  
  Widget _buildDirectoryNavigationBar() {
    return Container(
      height: 40,
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? Colors.grey.shade800
            : Colors.grey.shade100,
        border: Border(
          bottom: BorderSide(
            color: Theme.of(context).dividerColor,
          ),
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8.0),
      child: Row(
        children: [
          // Toggle directory view
          IconButton(
            icon: Icon(_showDirectoryView ? Icons.folder_open : Icons.folder),
            tooltip: _showDirectoryView ? 'Directory view' : 'File view',
            onPressed: () {
              setState(() {
                _showDirectoryView = !_showDirectoryView;
                if (!_showDirectoryView) {
                  _currentDirectory = '';
                }
              });
            },
            iconSize: 18,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(
              minWidth: 32,
              minHeight: 32,
            ),
          ),
          
          // Up button
          if (_showDirectoryView)
            IconButton(
              icon: const Icon(Icons.arrow_upward),
              tooltip: 'Up one level',
              onPressed: _navigateUp,
              iconSize: 18,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(
                minWidth: 32,
                minHeight: 32,
              ),
            ),
          
          // Current path
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8.0),
              child: SelectableText(
                _currentDirectory.isEmpty ? '/' : _currentDirectory,
                style: TextStyle(
                  fontSize: 14,
                  color: Theme.of(context).textTheme.bodyMedium?.color,
                ),
                maxLines: 1,
              ),
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildDirectoriesSection() {
    // Get all directories at current level
    final allFiles = [..._stagedFiles, ..._modifiedFiles, ..._untrackedFiles, ..._conflictedFiles];
    final dirs = _getDirectoriesAtCurrentLevel(allFiles);
    
    if (dirs.isEmpty) return const SizedBox.shrink();
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              const SelectableText(
                'Directories',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: Colors.blue,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.blue.withAlpha(25),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${dirs.length}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: Colors.blue,
                  ),
                ),
              ),
            ],
          ),
        ),
        ...dirs.map((dir) => _buildDirectoryItem(dir)).toList(),
        const Divider(),
      ],
    );
  }
  
  Widget _buildDirectoryItem(String dirPath) {
    final dirName = dirPath.contains('/')
        ? dirPath.substring(dirPath.lastIndexOf('/') + 1)
        : dirPath;
        
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => _navigateToDirectory(dirPath),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8.0, horizontal: 16.0),
          child: Row(
            children: [
              const Icon(
                Icons.folder,
                color: Colors.blue,
                size: 20,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: SelectableText(
                  dirName,
                  style: const TextStyle(
                    fontWeight: FontWeight.normal,
                  ),
                  maxLines: 1,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
  
  Widget _buildSection(String title, List<GitFile> files, Color color) {
    if (files.isEmpty) return const SizedBox.shrink();
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              SelectableText(
                title,
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: color,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: color.withAlpha(25),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${files.length}',
                  style: TextStyle(
                    fontSize: 12,
                    color: color,
                  ),
                ),
              ),
            ],
          ),
        ),
        ...files.map((file) => _buildFileItem(file, color)).toList(),
        const Divider(),
      ],
    );
  }
  
  Widget _buildFileItem(GitFile file, Color color) {
    final isSelected = widget.selectedFilePath == file.path;
    
    // In directory view, show only filenames
    final displayName = _showDirectoryView
        ? file.fileName
        : (file.directory.isEmpty
            ? file.fileName
            : '${file.fileName} (${file.directory})');
    
    return Slidable(
      endActionPane: ActionPane(
        motion: const DrawerMotion(),
        children: _buildActionsForFile(file),
      ),
      child: Material(
        color: isSelected 
            ? Theme.of(context).colorScheme.primaryContainer.withAlpha(38)
            : Colors.transparent,
        child: InkWell(
          onTap: () => widget.onFileSelected(file),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8.0, horizontal: 16.0),
            child: Row(
              children: [
                // Status icon
                _buildStatusIcon(file, color),
                
                const SizedBox(width: 12),
                
                // File path
                Expanded(
                  child: SelectableText(
                    displayName,
                    style: TextStyle(
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                      color: isSelected 
                          ? Theme.of(context).colorScheme.primary
                          : Theme.of(context).textTheme.bodyMedium?.color,
                    ),
                    maxLines: 1,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
  
  Widget _buildStatusIcon(GitFile file, Color color) {
    IconData iconData;
    
    if (file.isDirectory) {
      iconData = Icons.folder;
    } else if (file.isModified) {
      iconData = Icons.edit;
    } else if (file.isAdded) {
      iconData = Icons.add_circle_outline;
    } else if (file.isDeleted) {
      iconData = Icons.delete_outline;
    } else if (file.isRenamed) {
      iconData = Icons.drive_file_rename_outline;
    } else if (file.isUntracked) {
      iconData = Icons.help_outline;
    } else if (file.isConflicted) {
      iconData = Icons.warning_amber;
    } else {
      iconData = Icons.insert_drive_file_outlined;
    }
    
    return Icon(
      iconData,
      color: color,
      size: 20,
    );
  }
  
  List<SlidableAction> _buildActionsForFile(GitFile file) {
    final actions = <SlidableAction>[];
    
    if (file.isStaged) {
      // For staged files
      actions.add(
        SlidableAction(
          onPressed: (context) {
            if (widget.onFileAction != null) {
              widget.onFileAction!(file, 'unstage');
            }
          },
          backgroundColor: Colors.orange,
          foregroundColor: Colors.white,
          icon: Icons.undo,
          label: 'Unstage',
        ),
      );
    } else if (file.isUntracked) {
      // For untracked files
      actions.add(
        SlidableAction(
          onPressed: (context) {
            if (widget.onFileAction != null) {
              widget.onFileAction!(file, 'stage');
            }
          },
          backgroundColor: Colors.green,
          foregroundColor: Colors.white,
          icon: Icons.add,
          label: 'Stage',
        ),
      );
      
      // Option to ignore
      actions.add(
        SlidableAction(
          onPressed: (context) {
            if (widget.onFileAction != null) {
              widget.onFileAction!(file, 'ignore');
            }
          },
          backgroundColor: Colors.grey,
          foregroundColor: Colors.white,
          icon: Icons.visibility_off,
          label: 'Ignore',
        ),
      );
    } else if (file.isConflicted) {
      // For conflicted files
      actions.add(
        SlidableAction(
          onPressed: (context) {
            if (widget.onFileAction != null) {
              widget.onFileAction!(file, 'resolve');
            }
          },
          backgroundColor: Colors.blue,
          foregroundColor: Colors.white,
          icon: Icons.merge_type,
          label: 'Resolve',
        ),
      );
    } else {
      // For modified files
      actions.add(
        SlidableAction(
          onPressed: (context) {
            if (widget.onFileAction != null) {
              widget.onFileAction!(file, 'stage');
            }
          },
          backgroundColor: Colors.green,
          foregroundColor: Colors.white,
          icon: Icons.add,
          label: 'Stage',
        ),
      );
      
      // Option to discard changes
      actions.add(
        SlidableAction(
          onPressed: (context) {
            if (widget.onFileAction != null) {
              widget.onFileAction!(file, 'discard');
            }
          },
          backgroundColor: Colors.red,
          foregroundColor: Colors.white,
          icon: Icons.delete,
          label: 'Discard',
        ),
      );
    }
    
    return actions;
  }
}