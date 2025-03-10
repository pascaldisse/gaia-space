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
  _GitFileListState createState() => _GitFileListState();
}

class _GitFileListState extends State<GitFileList> {
  // Group files by category
  List<GitFile> _stagedFiles = [];
  List<GitFile> _modifiedFiles = [];
  List<GitFile> _untrackedFiles = [];
  List<GitFile> _conflictedFiles = [];
  
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
  
  @override
  Widget build(BuildContext context) {
    return Scrollbar(
      child: ListView(
        children: [
          // Conflicted files
          if (_conflictedFiles.isNotEmpty)
            _buildSection('Conflicts', _conflictedFiles, Colors.red),
          
          // Staged files
          if (_stagedFiles.isNotEmpty) 
            _buildSection('Staged Changes', _stagedFiles, Colors.green),
          
          // Modified files
          if (_modifiedFiles.isNotEmpty)
            _buildSection('Changes', _modifiedFiles, Colors.amber),
          
          // Untracked files
          if (_untrackedFiles.isNotEmpty && widget.showUntracked)
            _buildSection('Untracked Files', _untrackedFiles, Colors.grey),
          
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
    );
  }
  
  Widget _buildSection(String title, List<GitFile> files, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              Text(
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
                  color: color.withOpacity(0.1),
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
    
    return Slidable(
      endActionPane: ActionPane(
        motion: const DrawerMotion(),
        children: _buildActionsForFile(file),
      ),
      child: Material(
        color: isSelected 
            ? Theme.of(context).colorScheme.primaryContainer.withOpacity(0.15)
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
                  child: Text(
                    file.fileName,
                    style: TextStyle(
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                      color: isSelected 
                          ? Theme.of(context).colorScheme.primary
                          : Theme.of(context).textTheme.bodyMedium?.color,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                
                // Optional folder indicator for better organization
                if (file.directory.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(left: 8.0),
                    child: Text(
                      file.directory,
                      style: TextStyle(
                        fontSize: 12,
                        color: Theme.of(context).textTheme.bodySmall?.color,
                      ),
                      overflow: TextOverflow.ellipsis,
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
    
    if (file.isModified) {
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