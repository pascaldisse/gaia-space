import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/virtual_directory.dart';
import 'package:gaia_space/core/services/git_repository_manager.dart';
import 'package:gaia_space/core/services/git_service.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:gaia_space/ui/widgets/virtual_directory_browser.dart';
import 'package:path/path.dart' as path;

enum RepositoryCreationType { existing, clone, create }

class CreateRepositoryScreen extends ConsumerStatefulWidget {
  const CreateRepositoryScreen({super.key});

  @override
  ConsumerState<CreateRepositoryScreen> createState() => _CreateRepositoryScreenState();
}

class _CreateRepositoryScreenState extends ConsumerState<CreateRepositoryScreen> {
  final _formKey = GlobalKey<FormState>();
  final _logger = AppLogger();
  final GitRepositoryManager _repositoryManager = GitRepositoryManager();
  final GitService _gitService = GitService();

  RepositoryCreationType _creationType = RepositoryCreationType.existing;
  bool _isLoading = false;
  String? _error;

  // Form fields
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _pathController = TextEditingController();
  final _urlController = TextEditingController();
  
  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _pathController.dispose();
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _pickDirectory() async {
    try {
      // Check if running on web
      bool isWeb = identical(0, 0.0);
      _logger.info('Picking directory. isWeb: $isWeb');
      
      if (isWeb) {
        // Web mode with virtual file system
        _logger.info('Using web virtual directory browser');
        
        // Create virtual directory root if needed
        final rootDirectory = VirtualDirectory.createRoot();
        final nameController = TextEditingController();
        
        // Show virtual directory browser dialog
        final result = await showDialog<Map<String, dynamic>?>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Select Virtual Directory'),
            content: SizedBox(
              width: double.maxFinite,
              height: 400,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'In web mode, you cannot access your actual filesystem. '
                    'Please select or create a virtual directory for your repository.',
                    style: TextStyle(fontSize: 14),
                  ),
                  const SizedBox(height: 8),
                  const Divider(),
                  Expanded(
                    child: VirtualDirectoryBrowser(
                      rootDirectory: rootDirectory,
                      onDirectorySelected: (selectedDir) {
                        // Pass selected directory back along with repository name
                        Navigator.of(context).pop({
                          'directory': selectedDir,
                          'name': nameController.text.trim(),
                        });
                      },
                    ),
                  ),
                  const Divider(),
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8.0),
                    child: TextField(
                      controller: nameController,
                      decoration: const InputDecoration(
                        labelText: 'Repository Name',
                        border: OutlineInputBorder(),
                        hintText: 'MyRepository',
                        isDense: true,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Cancel'),
              ),
            ],
          ),
        );
        
        if (result != null && result['directory'] != null) {
          final selectedDir = result['directory'] as VirtualDirectory;
          String repoName = result['name'] as String? ?? '';
          
          // If no repo name provided, use directory name
          if (repoName.isEmpty) {
            repoName = selectedDir.name;
          }
          
          _logger.info('User selected virtual directory: ${selectedDir.path}');
          
          // Create a unique virtual path
          final timestamp = DateTime.now().millisecondsSinceEpoch;
          final webPath = '/virtual/$timestamp${selectedDir.path}';
          
          _logger.info('Using virtual path: $webPath');
          
          setState(() {
            _pathController.text = webPath;
            
            // Update name based on the entered name
            if (_nameController.text.isEmpty) {
              _nameController.text = repoName;
            }
          });
        } else {
          _logger.info('User canceled virtual directory selection');
        }
      } else {
        // Native platforms - use directory picker
        _logger.info('Using native directory picker');
        String? selectedDirectory = await FilePicker.platform.getDirectoryPath();
        
        if (selectedDirectory != null) {
          _logger.info('Selected directory: $selectedDirectory');
          setState(() {
            _pathController.text = selectedDirectory;
            
            // Update name based on the selected directory
            if (_nameController.text.isEmpty) {
              _nameController.text = path.basename(selectedDirectory);
            }
          });
        } else {
          _logger.info('No directory selected');
        }
      }
    } catch (e) {
      _logger.error('Error picking directory', error: e);
      
      // Show a user-friendly message when on web
      if (identical(0, 0.0)) {
        setState(() {
          _error = 'An error occurred while selecting the directory. Please try again.';
        });
      }
    }
  }

  Future<void> _createRepository() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    
    setState(() {
      _isLoading = true;
      _error = null;
    });
    
    try {
      switch (_creationType) {
        case RepositoryCreationType.existing:
          await _addExistingRepository();
          break;
        case RepositoryCreationType.clone:
          await _cloneRepository();
          break;
        case RepositoryCreationType.create:
          await _initNewRepository();
          break;
      }
      
      if (mounted) {
        Navigator.of(context).pop(true); // Return success
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }
  
  Future<void> _addExistingRepository() async {
    final name = _nameController.text.trim();
    final description = _descriptionController.text.trim();
    final path = _pathController.text.trim();
    
    // Check if running on web
    bool isWeb = identical(0, 0.0);
    _logger.info('Adding existing repository. Name: $name, Path: $path, isWeb: $isWeb');
    
    if (isWeb && path.startsWith('/virtual/')) {
      _logger.info('Using web mock repository');
      // Web mode with simulated repository
      await _repositoryManager.addRepository(
        name: name,
        path: path,
        description: description.isNotEmpty ? description : null,
        isWebMock: true,
      );
      _logger.info('Successfully added web mock repository');
    } else {
      _logger.info('Using native file system repository');
      // Native platform with real file system access
      try {
        // Validate it's a git repository
        final gitDir = Directory(path);
        final gitConfigDir = Directory('${gitDir.path}/.git');
        
        _logger.info('Checking if directory is a git repository: ${gitConfigDir.path}');
        if (!await gitConfigDir.exists()) {
          _logger.error('Not a git repository: .git directory does not exist');
          throw Exception('The selected directory is not a git repository');
        }
        
        _logger.info('Valid git repository found');
        await _repositoryManager.addRepository(
          name: name,
          path: path,
          description: description.isNotEmpty ? description : null,
        );
        _logger.info('Successfully added repository');
      } catch (e) {
        _logger.error('Error validating git repository', error: e);
        throw Exception('Error accessing the directory: $e');
      }
    }
  }
  
  Future<void> _cloneRepository() async {
    final name = _nameController.text.trim();
    final description = _descriptionController.text.trim();
    final path = _pathController.text.trim();
    final url = _urlController.text.trim();
    
    // Check if running on web
    bool isWeb = identical(0, 0.0);
    _logger.info('Cloning repository. Name: $name, Path: $path, URL: $url, isWeb: $isWeb');
    
    if (isWeb && path.startsWith('/virtual/')) {
      _logger.info('Using web mock repository for cloning');
      // Web mode with simulated repository
      await _repositoryManager.addRepository(
        name: name,
        path: path,
        description: description.isNotEmpty ? description : null,
        isWebMock: true,
        remoteUrl: url,
      );
      _logger.info('Successfully added web mock repository (cloned)');
    } else {
      _logger.info('Using native git clone');
      // Native platform with real file system access
      try {
        await _repositoryManager.cloneRepository(
          url: url,
          destinationPath: path,
          name: name,
          description: description.isNotEmpty ? description : null,
        );
        _logger.info('Successfully cloned repository');
      } catch (e) {
        _logger.error('Error cloning repository', error: e);
        throw Exception('Error cloning the repository: $e');
      }
    }
  }
  
  Future<void> _initNewRepository() async {
    final name = _nameController.text.trim();
    final description = _descriptionController.text.trim();
    final path = _pathController.text.trim();
    
    // Check if running on web
    bool isWeb = identical(0, 0.0);
    _logger.info('Initializing new repository. Name: $name, Path: $path, isWeb: $isWeb');
    
    if (isWeb && path.startsWith('/virtual/')) {
      _logger.info('Using web mock repository for new repo');
      // Web mode with simulated repository
      await _repositoryManager.addRepository(
        name: name,
        path: path,
        description: description.isNotEmpty ? description : null,
        isWebMock: true,
        isNewRepo: true,
      );
      _logger.info('Successfully added web mock repository (new)');
    } else {
      _logger.info('Using native git init');
      // Native platform with real file system access
      try {
        // Create the directory if it doesn't exist
        final directory = Directory(path);
        _logger.info('Checking if directory exists: ${directory.path}');
        if (!await directory.exists()) {
          _logger.info('Creating directory: ${directory.path}');
          await directory.create(recursive: true);
        }
        
        // Initialize git repository
        _logger.info('Initializing git repository');
        await _gitService.initRepository(path);
        
        // Add to manager
        _logger.info('Adding repository to manager');
        await _repositoryManager.addRepository(
          name: name,
          path: path,
          description: description.isNotEmpty ? description : null,
        );
        _logger.info('Successfully initialized repository');
      } catch (e) {
        _logger.error('Error initializing repository', error: e);
        throw Exception('Error initializing the repository: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Add Repository'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Repository type selection
                      _buildTypeSelector(),
                      const SizedBox(height: 24),
                      
                      // Name field
                      TextFormField(
                        controller: _nameController,
                        decoration: const InputDecoration(
                          labelText: 'Repository Name',
                          border: OutlineInputBorder(),
                          prefixIcon: Icon(Icons.folder),
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Repository name is required';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),
                      
                      // Description field
                      TextFormField(
                        controller: _descriptionController,
                        decoration: const InputDecoration(
                          labelText: 'Description (Optional)',
                          border: OutlineInputBorder(),
                          prefixIcon: Icon(Icons.description),
                        ),
                        maxLines: 2,
                      ),
                      const SizedBox(height: 16),
                      
                      // Path field with picker
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: _pathController,
                              decoration: const InputDecoration(
                                labelText: 'Repository Path',
                                border: OutlineInputBorder(),
                                prefixIcon: Icon(Icons.folder_open),
                              ),
                              validator: (value) {
                                if (value == null || value.trim().isEmpty) {
                                  return 'Repository path is required';
                                }
                                return null;
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          ElevatedButton(
                            onPressed: _pickDirectory,
                            style: ElevatedButton.styleFrom(
                              padding: const EdgeInsets.all(16),
                            ),
                            child: const Icon(Icons.folder_open),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      
                      // URL field for cloning
                      if (_creationType == RepositoryCreationType.clone)
                        TextFormField(
                          controller: _urlController,
                          decoration: const InputDecoration(
                            labelText: 'Git Repository URL',
                            border: OutlineInputBorder(),
                            prefixIcon: Icon(Icons.link),
                            hintText: 'https://github.com/username/repository.git',
                          ),
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return 'Repository URL is required';
                            }
                            
                            if (!value.contains('://') && !value.contains('@')) {
                              return 'Please enter a valid repository URL';
                            }
                            
                            return null;
                          },
                        ),
                      
                      if (_error != null) ...[
                        const SizedBox(height: 16),
                        Container(
                          padding: const EdgeInsets.all(8),
                          color: Colors.red.withAlpha(25),
                          child: Row(
                            children: [
                              const Icon(Icons.error_outline, color: Colors.red),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  _error!,
                                  style: const TextStyle(color: Colors.red),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                      
                      const SizedBox(height: 24),
                      
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: _createRepository,
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                          ),
                          child: Text(_getButtonText()),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
    );
  }
  
  Widget _buildTypeSelector() {
    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Repository Type',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 8),
            
            // Existing repository
            RadioListTile<RepositoryCreationType>(
              title: const Text('Add Existing Repository'),
              subtitle: const Text('Add an existing Git repository from your computer'),
              value: RepositoryCreationType.existing,
              groupValue: _creationType,
              onChanged: (value) {
                setState(() {
                  _creationType = value!;
                });
              },
            ),
            
            // Clone repository
            RadioListTile<RepositoryCreationType>(
              title: const Text('Clone Repository'),
              subtitle: const Text('Clone a Git repository from a remote URL'),
              value: RepositoryCreationType.clone,
              groupValue: _creationType,
              onChanged: (value) {
                setState(() {
                  _creationType = value!;
                });
              },
            ),
            
            // Create new repository
            RadioListTile<RepositoryCreationType>(
              title: const Text('Create New Repository'),
              subtitle: const Text('Initialize a new Git repository'),
              value: RepositoryCreationType.create,
              groupValue: _creationType,
              onChanged: (value) {
                setState(() {
                  _creationType = value!;
                });
              },
            ),
          ],
        ),
      ),
    );
  }
  
  String _getButtonText() {
    switch (_creationType) {
      case RepositoryCreationType.existing:
        return 'Add Repository';
      case RepositoryCreationType.clone:
        return 'Clone Repository';
      case RepositoryCreationType.create:
        return 'Create Repository';
    }
  }
}