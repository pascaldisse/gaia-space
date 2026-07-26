import 'package:flutter/material.dart';
import 'package:gaia_space/core/models/virtual_directory.dart';

/// A widget for browsing a virtual directory structure in web mode
class VirtualDirectoryBrowser extends StatefulWidget {
  final VirtualDirectory rootDirectory;
  final Function(VirtualDirectory selectedDir) onDirectorySelected;

  const VirtualDirectoryBrowser({
    Key? key,
    required this.rootDirectory,
    required this.onDirectorySelected,
  }) : super(key: key);

  @override
  State<VirtualDirectoryBrowser> createState() => _VirtualDirectoryBrowserState();
}

class _VirtualDirectoryBrowserState extends State<VirtualDirectoryBrowser> {
  late VirtualDirectory _currentDirectory;
  List<VirtualDirectory> _breadcrumbs = [];
  
  @override
  void initState() {
    super.initState();
    _currentDirectory = widget.rootDirectory;
    _updateBreadcrumbs();
  }
  
  void _updateBreadcrumbs() {
    final breadcrumbs = <VirtualDirectory>[];
    VirtualDirectory? current = _currentDirectory;
    
    // Build breadcrumbs from current directory up to root
    while (current != null) {
      breadcrumbs.add(current);
      current = current.parent;
    }
    
    setState(() {
      _breadcrumbs = breadcrumbs.reversed.toList();
    });
  }
  
  void _navigateToDirectory(VirtualDirectory directory) {
    setState(() {
      _currentDirectory = directory;
      _updateBreadcrumbs();
    });
  }
  
  void _createNewDirectory() async {
    final textController = TextEditingController();
    final newDirName = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Create New Directory'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: textController,
              decoration: const InputDecoration(
                labelText: 'Directory Name',
                hintText: 'my-folder',
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
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              final name = textController.text.trim();
              if (name.isNotEmpty) {
                Navigator.of(context).pop(name);
              }
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
    
    if (newDirName != null && newDirName.isNotEmpty) {
      // Sanitize directory name
      final sanitizedName = newDirName.replaceAll(RegExp(r'[^\w\s\-\.]'), '').trim();
      if (sanitizedName.isEmpty) return;
      
      setState(() {
        _currentDirectory.createChild(sanitizedName);
      });
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Breadcrumb navigation
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (int i = 0; i < _breadcrumbs.length; i++) ...[
                if (i > 0) const Text(' / ', style: TextStyle(color: Colors.grey)),
                InkWell(
                  onTap: () => _navigateToDirectory(_breadcrumbs[i]),
                  child: Text(
                    _breadcrumbs[i].isRoot ? 'Root' : _breadcrumbs[i].name,
                    style: TextStyle(
                      color: Theme.of(context).primaryColor,
                      fontWeight: i == _breadcrumbs.length - 1 
                          ? FontWeight.bold 
                          : FontWeight.normal,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        
        const SizedBox(height: 8),
        
        // Directory listing
        Expanded(
          child: Stack(
            children: [
              ListView(
                children: [
                  // Parent directory (if not at root)
                  if (_currentDirectory.parent != null)
                    ListTile(
                      leading: const Icon(Icons.arrow_upward, color: Colors.blue),
                      title: const Text('..'),
                      onTap: () {
                        _navigateToDirectory(_currentDirectory.parent!);
                      },
                    ),
                  
                  // Current directory's children
                  ..._currentDirectory.children.map((dir) => ListTile(
                    leading: const Icon(Icons.folder, color: Colors.blue),
                    title: Text(dir.name),
                    onTap: () {
                      _navigateToDirectory(dir);
                    },
                    trailing: IconButton(
                      icon: const Icon(Icons.check_circle_outline),
                      tooltip: 'Select this directory',
                      onPressed: () {
                        widget.onDirectorySelected(dir);
                      },
                    ),
                  )),
                ],
              ),
              
              // FAB for creating new directories
              Positioned(
                right: 16,
                bottom: 16,
                child: FloatingActionButton(
                  onPressed: _createNewDirectory,
                  tooltip: 'Create New Directory',
                  mini: true,
                  child: const Icon(Icons.create_new_folder),
                ),
              ),
            ],
          ),
        ),
        
        // Action buttons
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            TextButton(
              onPressed: () {
                widget.onDirectorySelected(_currentDirectory);
              },
              child: const Text('Select Current Directory'),
            ),
          ],
        ),
      ],
    );
  }
}