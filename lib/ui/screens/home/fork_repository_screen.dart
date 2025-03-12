import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/repository.dart';
import 'package:gaia_space/core/models/fork_relationship.dart';
import 'package:gaia_space/core/services/fork_service.dart';
import 'package:gaia_space/core/services/git_repository_manager.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:path/path.dart' as path;
import 'package:file_picker/file_picker.dart';
import 'dart:io';

final forkServiceProvider = Provider<ForkService>((ref) => ForkService());

final repositoryManagerProvider = Provider<GitRepositoryManager>((ref) => GitRepositoryManager());

/// Dialog to fork a repository
class ForkRepositoryScreen extends ConsumerStatefulWidget {
  final GitRepository repository;
  
  const ForkRepositoryScreen({
    Key? key,
    required this.repository,
  }) : super(key: key);
  
  @override
  ConsumerState<ForkRepositoryScreen> createState() => _ForkRepositoryScreenState();
}

class _ForkRepositoryScreenState extends ConsumerState<ForkRepositoryScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  
  String? _selectedDirectory;
  bool _isForking = false;
  final _logger = AppLogger('ForkScreen');
  
  @override
  void initState() {
    super.initState();
    _nameController.text = '${widget.repository.name}-fork';
    _descriptionController.text = 'Fork of ${widget.repository.name}';
  }
  
  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }
  
  Future<void> _selectDirectory() async {
    try {
      // Check if running on web
      bool isWeb = identical(0, 0.0);
      
      if (isWeb) {
        // Web platform doesn't have directory picker
        // We'll use a mock path for web
        setState(() {
          _selectedDirectory = '/virtual/repositories';
        });
        return;
      }
      
      final result = await FilePicker.platform.getDirectoryPath();
      if (result != null) {
        setState(() {
          _selectedDirectory = result;
        });
      }
    } catch (e) {
      _logger.error('Error selecting directory', error: e);
      
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Error selecting directory'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }
  
  Future<void> _forkRepository() async {
    if (_formKey.currentState!.validate() && _selectedDirectory != null) {
      setState(() {
        _isForking = true;
      });
      
      try {
        final forkService = ref.read(forkServiceProvider);
        
        final forkedRepo = await forkService.forkRepository(
          sourceRepositoryId: widget.repository.id,
          destinationPath: _selectedDirectory!,
          forkName: _nameController.text,
          description: _descriptionController.text,
          createdBy: 'current_user', // In a real app, this would be the current user's ID
        );
        
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Repository forked successfully: ${forkedRepo.name}'),
              backgroundColor: Colors.green,
            ),
          );
          
          Navigator.of(context).pop(forkedRepo);
        }
      } catch (e) {
        _logger.error('Error forking repository', error: e);
        
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Error forking repository: ${e.toString()}'),
              backgroundColor: Colors.red,
            ),
          );
        }
      } finally {
        if (mounted) {
          setState(() {
            _isForking = false;
          });
        }
      }
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fork Repository'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Source repository info
              Card(
                margin: const EdgeInsets.only(bottom: 24.0),
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Source Repository',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 18.0,
                        ),
                      ),
                      const SizedBox(height: 8.0),
                      Text('Name: ${widget.repository.name}'),
                      if (widget.repository.description != null)
                        Text('Description: ${widget.repository.description}'),
                      Text('Path: ${widget.repository.path ?? "N/A"}'),
                    ],
                  ),
                ),
              ),
              
              // Fork name
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Fork Name',
                  hintText: 'Enter a name for your fork',
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter a name for your fork';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16.0),
              
              // Fork description
              TextFormField(
                controller: _descriptionController,
                decoration: const InputDecoration(
                  labelText: 'Description',
                  hintText: 'Enter a description for your fork',
                  border: OutlineInputBorder(),
                ),
                maxLines: 3,
              ),
              const SizedBox(height: 16.0),
              
              // Directory selection
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      readOnly: true,
                      decoration: InputDecoration(
                        labelText: 'Destination Directory',
                        hintText: 'Select a directory for your fork',
                        border: const OutlineInputBorder(),
                        suffixIcon: IconButton(
                          icon: const Icon(Icons.folder_open),
                          onPressed: _selectDirectory,
                        ),
                      ),
                      controller: TextEditingController(text: _selectedDirectory),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return 'Please select a destination directory';
                        }
                        return null;
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24.0),
              
              // Fork button
              SizedBox(
                width: double.infinity,
                height: 50.0,
                child: ElevatedButton(
                  onPressed: _isForking ? null : _forkRepository,
                  child: _isForking
                      ? const CircularProgressIndicator()
                      : const Text('Fork Repository'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Widget to display fork relationship information
class ForkRelationshipWidget extends ConsumerWidget {
  final String repositoryId;
  
  const ForkRelationshipWidget({
    Key? key,
    required this.repositoryId,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final forkService = ref.read(forkServiceProvider);
    
    return FutureBuilder<List<ForkRelationship>>(
      future: forkService.getForkRelationshipsForRepository(repositoryId),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        
        if (snapshot.hasError) {
          return const Center(child: Text('Error loading fork information'));
        }
        
        final forkRelationships = snapshot.data ?? [];
        if (forkRelationships.isEmpty) {
          return const SizedBox.shrink(); // Not a fork
        }
        
        // This is a fork, show upstream information
        final relationship = forkRelationships.first;
        
        return FutureBuilder<GitRepository?>(
          future: forkService.getUpstreamRepository(repositoryId),
          builder: (context, upstreamSnapshot) {
            final upstreamRepo = upstreamSnapshot.data;
            
            return Card(
              margin: const EdgeInsets.symmetric(vertical: 8.0),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.fork_right, color: Colors.blue),
                        const SizedBox(width: 8.0),
                        const Text(
                          'Fork Information',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16.0,
                          ),
                        ),
                        const Spacer(),
                        _buildSyncButton(context, ref, relationship),
                      ],
                    ),
                    const Divider(),
                    const SizedBox(height: 8.0),
                    Text('Upstream: ${upstreamRepo?.name ?? "Unknown"}'),
                    Text('Last Synced: ${relationship.lastSyncedAt?.toString() ?? "Never"}'),
                    const SizedBox(height: 8.0),
                    Row(
                      children: [
                        Chip(
                          label: Text('${relationship.behindCount} behind'),
                          backgroundColor: relationship.behindCount > 0 
                              ? Colors.amber.shade100 
                              : Colors.green.shade100,
                        ),
                        const SizedBox(width: 8.0),
                        Chip(
                          label: Text('${relationship.aheadCount} ahead'),
                          backgroundColor: relationship.aheadCount > 0 
                              ? Colors.blue.shade100 
                              : Colors.green.shade100,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
  
  Widget _buildSyncButton(BuildContext context, WidgetRef ref, ForkRelationship relationship) {
    final forkService = ref.read(forkServiceProvider);
    
    return ElevatedButton.icon(
      icon: const Icon(Icons.sync),
      label: const Text('Sync'),
      onPressed: relationship.syncing 
          ? null 
          : () async {
              try {
                await forkService.syncForkWithUpstream(relationship.id);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Fork synchronized successfully'),
                      backgroundColor: Colors.green,
                    ),
                  );
                }
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Error synchronizing fork: ${e.toString()}'),
                      backgroundColor: Colors.red,
                    ),
                  );
                }
              }
            },
      style: ElevatedButton.styleFrom(
        backgroundColor: Colors.blue.shade700,
        foregroundColor: Colors.white,
      ),
    );
  }
}