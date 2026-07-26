import 'package:uuid/uuid.dart';

/// A model representing a virtual directory for web mode
class VirtualDirectory {
  final String id;
  final String name;
  final String path;
  final bool isRoot;
  final List<VirtualDirectory> children;
  final VirtualDirectory? parent;

  VirtualDirectory({
    String? id,
    required this.name,
    required this.path,
    this.isRoot = false,
    List<VirtualDirectory>? children,
    this.parent,
  }) : 
    id = id ?? const Uuid().v4(),
    children = children ?? [];

  /// Creates a child directory under this directory
  VirtualDirectory createChild(String name) {
    final childPath = isRoot ? '/$name' : '$path/$name';
    final child = VirtualDirectory(
      name: name,
      path: childPath,
      parent: this,
    );
    children.add(child);
    return child;
  }

  /// Finds a directory by path
  VirtualDirectory? findByPath(String targetPath) {
    if (path == targetPath) return this;
    
    for (final child in children) {
      final result = child.findByPath(targetPath);
      if (result != null) return result;
    }
    
    return null;
  }

  /// Creates a deep copy of this directory
  VirtualDirectory copy({VirtualDirectory? newParent}) {
    final copiedDir = VirtualDirectory(
      id: id,
      name: name,
      path: path,
      isRoot: isRoot,
      parent: newParent ?? parent,
    );
    
    copiedDir.children.addAll(
      children.map((child) => child.copy(newParent: copiedDir))
    );
    
    return copiedDir;
  }

  /// Factory method to create a root directory with some predefined folders
  factory VirtualDirectory.createRoot() {
    final root = VirtualDirectory(
      name: 'root',
      path: '/',
      isRoot: true,
    );
    
    // Add some common directories
    final projects = root.createChild('projects');
    projects.createChild('frontend');
    projects.createChild('backend');
    
    final documents = root.createChild('documents');
    documents.createChild('personal');
    documents.createChild('work');
    
    root.createChild('downloads');
    root.createChild('desktop');
    
    return root;
  }
}