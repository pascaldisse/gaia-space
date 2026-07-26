import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/document.dart';
import 'package:gaia_space/core/services/auth_service.dart';
import 'package:gaia_space/ui/widgets/empty_state.dart';
import 'package:uuid/uuid.dart';

// Document state notifier
class DocumentNotifier extends StateNotifier<List<Document>> {
  DocumentNotifier() : super([]) {
    _loadDocuments();
  }

  Future<void> _loadDocuments() async {
    // Simulate API call
    await Future.delayed(const Duration(seconds: 1));
    
    state = _mockDocuments;
  }

  void addDocument(Document document) {
    state = [...state, document];
  }

  void updateDocument(Document updatedDocument) {
    state = state.map((document) => 
      document.id == updatedDocument.id ? updatedDocument : document
    ).toList();
  }

  void deleteDocument(String documentId) {
    state = state.where((document) => document.id != documentId).toList();
  }
}

// Documents provider
final documentsProvider = StateNotifierProvider<DocumentNotifier, List<Document>>((ref) {
  return DocumentNotifier();
});

// Mock data
final _mockDocuments = [
  Document(
    id: '1',
    title: 'Getting Started with Gaia Space',
    content: '''
# Getting Started with Gaia Space

Welcome to Gaia Space! This guide will help you get started with our DevOps collaboration platform.

## Key Features

- **Workspaces**: Organize your work and collaborate with your team
- **Projects**: Manage your development projects in an efficient way
- **Git Integration**: Connect your repositories and streamline your workflow
- **Pipelines**: Automate your CI/CD processes
- **Documentation**: Create and share knowledge with your team

## Next Steps

1. Create your first workspace
2. Add team members to collaborate
3. Connect your Git repositories
4. Set up your CI/CD pipelines

Need help? Contact our support team at support@gaiaspace.com
''',
    description: 'A guide to help new users get started with Gaia Space',
    authorId: 'user1',
    authorName: 'System Admin',
    createdAt: DateTime.now().subtract(const Duration(days: 30)),
    updatedAt: DateTime.now().subtract(const Duration(days: 15)),
    type: DocumentType.markdown,
    tags: ['getting-started', 'documentation', 'guide'],
  ),
  Document(
    id: '2',
    title: 'API Documentation',
    content: '''
# Gaia Space API Documentation

This document provides information about the Gaia Space API endpoints and how to use them.

## Authentication

All API requests require authentication using JWT tokens. To get a token, make a POST request to:

```
POST /api/auth/login
```

With the following payload:

```json
{
  "username": "your-username",
  "password": "your-password"
}
```

## Endpoints

### Workspaces

- `GET /api/workspaces` - List all workspaces
- `GET /api/workspaces/{id}` - Get workspace details
- `POST /api/workspaces` - Create a new workspace
- `PUT /api/workspaces/{id}` - Update a workspace
- `DELETE /api/workspaces/{id}` - Delete a workspace

### Projects

- `GET /api/projects` - List all projects
- `GET /api/projects/{id}` - Get project details
- `POST /api/projects` - Create a new project
- `PUT /api/projects/{id}` - Update a project
- `DELETE /api/projects/{id}` - Delete a project

## Rate Limiting

API requests are limited to 100 requests per minute per user.
''',
    description: 'Technical documentation for the Gaia Space API',
    authorId: 'user2',
    authorName: 'API Team',
    createdAt: DateTime.now().subtract(const Duration(days: 45)),
    updatedAt: DateTime.now().subtract(const Duration(days: 5)),
    type: DocumentType.markdown,
    tags: ['api', 'technical', 'development'],
  ),
];

class DocumentScreen extends ConsumerStatefulWidget {
  const DocumentScreen({super.key});

  @override
  ConsumerState<DocumentScreen> createState() => _DocumentScreenState();
}

class _DocumentScreenState extends ConsumerState<DocumentScreen> {
  Document? _selectedDocument;
  
  @override
  Widget build(BuildContext context) {
    final documents = ref.watch(documentsProvider);
    
    if (documents.isEmpty) {
      return Scaffold(
        body: EmptyState(
          icon: Icons.article,
          title: 'Documentation',
          message: 'Create and manage documentation for your projects and team.',
          actionText: 'Create Document',
          onActionPressed: _showCreateDocumentDialog,
        ),
        floatingActionButton: FloatingActionButton(
          onPressed: _showCreateDocumentDialog,
          child: const Icon(Icons.add),
        ),
      );
    }
    
    return Scaffold(
      body: Row(
        children: [
          // Document list sidebar
          Container(
            width: 300,
            decoration: BoxDecoration(
              border: Border(
                right: BorderSide(
                  color: Theme.of(context).dividerColor,
                  width: 1,
                ),
              ),
            ),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: TextField(
                    decoration: const InputDecoration(
                      hintText: 'Search documents...',
                      prefixIcon: Icon(Icons.search),
                      border: OutlineInputBorder(),
                      contentPadding: EdgeInsets.symmetric(vertical: 8, horizontal: 16),
                    ),
                    onChanged: (value) {
                      // TODO: Implement search functionality
                    },
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: documents.length,
                    itemBuilder: (context, index) {
                      final document = documents[index];
                      final isSelected = _selectedDocument?.id == document.id;
                      
                      return ListTile(
                        title: Text(
                          document.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(
                          'Updated ${_formatDate(document.updatedAt)}',
                          style: TextStyle(
                            fontSize: 12,
                            color: Theme.of(context).textTheme.bodySmall?.color,
                          ),
                        ),
                        leading: Icon(
                          _getIconForDocumentType(document.type),
                          color: isSelected ? Theme.of(context).primaryColor : null,
                        ),
                        selected: isSelected,
                        selectedTileColor: Theme.of(context).primaryColor.withOpacity(0.1),
                        onTap: () {
                          setState(() {
                            _selectedDocument = document;
                          });
                        },
                        trailing: PopupMenuButton(
                          itemBuilder: (context) => [
                            const PopupMenuItem(
                              value: 'edit',
                              child: Row(
                                children: [
                                  Icon(Icons.edit, size: 18),
                                  SizedBox(width: 8),
                                  Text('Edit'),
                                ],
                              ),
                            ),
                            const PopupMenuItem(
                              value: 'delete',
                              child: Row(
                                children: [
                                  Icon(Icons.delete, size: 18),
                                  SizedBox(width: 8),
                                  Text('Delete'),
                                ],
                              ),
                            ),
                          ],
                          onSelected: (value) {
                            if (value == 'edit') {
                              _showEditDocumentDialog(document);
                            } else if (value == 'delete') {
                              _showDeleteConfirmationDialog(document.id);
                            }
                          },
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
          
          // Document content area
          Expanded(
            child: _selectedDocument == null
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.article_outlined,
                          size: 64,
                          color: Colors.grey.withOpacity(0.5),
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          'Select a document to view',
                          style: TextStyle(
                            fontSize: 18,
                            color: Colors.grey,
                          ),
                        ),
                      ],
                    ),
                  )
                : _buildDocumentView(_selectedDocument!),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _showCreateDocumentDialog,
        child: const Icon(Icons.add),
      ),
    );
  }
  
  Widget _buildDocumentView(Document document) {
    switch (document.type) {
      case DocumentType.markdown:
        return Markdown(
          data: document.content,
          selectable: true,
          padding: const EdgeInsets.all(24),
        );
      case DocumentType.text:
      case DocumentType.code:
        return SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Text(document.content),
        );
    }
  }
  
  IconData _getIconForDocumentType(DocumentType type) {
    switch (type) {
      case DocumentType.markdown:
        return Icons.description;
      case DocumentType.text:
        return Icons.article;
      case DocumentType.code:
        return Icons.code;
    }
  }
  
  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);
    
    if (difference.inDays < 1) {
      if (difference.inHours < 1) {
        return '${difference.inMinutes} mins ago';
      }
      return '${difference.inHours} hours ago';
    } else if (difference.inDays < 7) {
      return '${difference.inDays} days ago';
    } else {
      return '${date.day}/${date.month}/${date.year}';
    }
  }
  
  void _showCreateDocumentDialog() {
    final titleController = TextEditingController();
    final descriptionController = TextEditingController();
    final contentController = TextEditingController();
    DocumentType selectedType = DocumentType.markdown;
    
    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setState) {
            return AlertDialog(
              title: const Text('Create New Document'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: titleController,
                      decoration: const InputDecoration(
                        labelText: 'Title',
                        hintText: 'Enter document title',
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: descriptionController,
                      decoration: const InputDecoration(
                        labelText: 'Description (optional)',
                        hintText: 'Enter a short description',
                      ),
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<DocumentType>(
                      value: selectedType,
                      decoration: const InputDecoration(
                        labelText: 'Document Type',
                      ),
                      items: DocumentType.values.map((type) {
                        return DropdownMenuItem(
                          value: type,
                          child: Text(type.name.toUpperCase()),
                        );
                      }).toList(),
                      onChanged: (value) {
                        if (value != null) {
                          setState(() {
                            selectedType = value;
                          });
                        }
                      },
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: contentController,
                      decoration: const InputDecoration(
                        labelText: 'Content',
                        hintText: 'Enter document content',
                        alignLabelWithHint: true,
                      ),
                      maxLines: 8,
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Cancel'),
                ),
                ElevatedButton(
                  onPressed: () {
                    if (titleController.text.isNotEmpty && contentController.text.isNotEmpty) {
                      final newDocument = Document(
                        id: const Uuid().v4(),
                        title: titleController.text,
                        content: contentController.text,
                        description: descriptionController.text.isNotEmpty ? descriptionController.text : null,
                        authorId: AuthService.currentUser?.id ?? 'unknown',
                        authorName: AuthService.currentUser?.displayName ?? 'Unknown User',
                        createdAt: DateTime.now(),
                        updatedAt: DateTime.now(),
                        type: selectedType,
                      );
                      
                      ref.read(documentsProvider.notifier).addDocument(newDocument);
                      Navigator.of(context).pop();
                      
                      setState(() {
                        _selectedDocument = newDocument;
                      });
                    }
                  },
                  child: const Text('Create'),
                ),
              ],
            );
          },
        );
      },
    );
  }
  
  void _showEditDocumentDialog(Document document) {
    final titleController = TextEditingController(text: document.title);
    final descriptionController = TextEditingController(text: document.description ?? '');
    final contentController = TextEditingController(text: document.content);
    DocumentType selectedType = document.type;
    
    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setState) {
            return AlertDialog(
              title: const Text('Edit Document'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: titleController,
                      decoration: const InputDecoration(
                        labelText: 'Title',
                        hintText: 'Enter document title',
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: descriptionController,
                      decoration: const InputDecoration(
                        labelText: 'Description (optional)',
                        hintText: 'Enter a short description',
                      ),
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<DocumentType>(
                      value: selectedType,
                      decoration: const InputDecoration(
                        labelText: 'Document Type',
                      ),
                      items: DocumentType.values.map((type) {
                        return DropdownMenuItem(
                          value: type,
                          child: Text(type.name.toUpperCase()),
                        );
                      }).toList(),
                      onChanged: (value) {
                        if (value != null) {
                          setState(() {
                            selectedType = value;
                          });
                        }
                      },
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: contentController,
                      decoration: const InputDecoration(
                        labelText: 'Content',
                        hintText: 'Enter document content',
                        alignLabelWithHint: true,
                      ),
                      maxLines: 8,
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Cancel'),
                ),
                ElevatedButton(
                  onPressed: () {
                    if (titleController.text.isNotEmpty && contentController.text.isNotEmpty) {
                      final updatedDocument = document.copyWith(
                        title: titleController.text,
                        content: contentController.text,
                        description: descriptionController.text.isNotEmpty ? descriptionController.text : null,
                        type: selectedType,
                        updatedAt: DateTime.now(),
                      );
                      
                      ref.read(documentsProvider.notifier).updateDocument(updatedDocument);
                      Navigator.of(context).pop();
                      
                      if (_selectedDocument?.id == document.id) {
                        setState(() {
                          _selectedDocument = updatedDocument;
                        });
                      }
                    }
                  },
                  child: const Text('Save'),
                ),
              ],
            );
          },
        );
      },
    );
  }
  
  void _showDeleteConfirmationDialog(String documentId) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('Delete Document'),
          content: const Text('Are you sure you want to delete this document? This action cannot be undone.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            TextButton(
              style: TextButton.styleFrom(foregroundColor: Colors.red),
              onPressed: () {
                ref.read(documentsProvider.notifier).deleteDocument(documentId);
                Navigator.of(context).pop();
                
                if (_selectedDocument?.id == documentId) {
                  setState(() {
                    _selectedDocument = null;
                  });
                }
              },
              child: const Text('Delete'),
            ),
          ],
        );
      },
    );
  }
}