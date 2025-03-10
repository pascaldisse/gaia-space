import 'package:flutter/material.dart';
import 'package:gaia_space/core/models/git_file.dart';

class CommitDialog extends StatefulWidget {
  final List<GitFile> stagedFiles;
  final String? commitMessageTemplate;
  final bool showAmendOption;
  final Function(String message, bool amend) onCommit;

  const CommitDialog({
    Key? key,
    required this.stagedFiles,
    this.commitMessageTemplate,
    this.showAmendOption = true,
    required this.onCommit,
  }) : super(key: key);

  static Future<void> show({
    required BuildContext context,
    required List<GitFile> stagedFiles,
    String? commitMessageTemplate,
    bool showAmendOption = true,
    required Function(String message, bool amend) onCommit,
  }) async {
    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext context) {
        return CommitDialog(
          stagedFiles: stagedFiles,
          commitMessageTemplate: commitMessageTemplate,
          showAmendOption: showAmendOption,
          onCommit: onCommit,
        );
      },
    );
  }

  @override
  _CommitDialogState createState() => _CommitDialogState();
}

class _CommitDialogState extends State<CommitDialog> {
  late TextEditingController _messageController;
  bool _isAmendChecked = false;
  
  @override
  void initState() {
    super.initState();
    _messageController = TextEditingController(text: widget.commitMessageTemplate ?? '');
  }
  
  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Commit Changes'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Staged files summary
            Text(
              'Staged Files (${widget.stagedFiles.length})',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            
            // List of staged files
            Container(
              constraints: const BoxConstraints(
                maxHeight: 100,
              ),
              decoration: BoxDecoration(
                border: Border.all(
                  color: Theme.of(context).dividerColor,
                ),
                borderRadius: BorderRadius.circular(4),
              ),
              child: ListView.builder(
                itemCount: widget.stagedFiles.length,
                itemBuilder: (context, index) {
                  final file = widget.stagedFiles[index];
                  return ListTile(
                    dense: true,
                    visualDensity: VisualDensity.compact,
                    title: Text(
                      file.path,
                      style: Theme.of(context).textTheme.bodySmall,
                      overflow: TextOverflow.ellipsis,
                    ),
                    leading: Icon(
                      _getFileStatusIcon(file),
                      size: 16,
                      color: _getFileStatusColor(file),
                    ),
                  );
                },
              ),
            ),
            
            const SizedBox(height: 16),
            
            // Commit message
            Text(
              'Commit Message',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _messageController,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                hintText: 'Enter commit message',
              ),
              minLines: 5,
              maxLines: 10,
              autofocus: true,
            ),
            
            if (widget.showAmendOption) ...[
              const SizedBox(height: 16),
              
              // Amend option
              CheckboxListTile(
                title: const Text('Amend previous commit'),
                subtitle: const Text(
                  'Add staged changes to the previous commit and edit its message',
                  style: TextStyle(fontSize: 12),
                ),
                value: _isAmendChecked,
                controlAffinity: ListTileControlAffinity.leading,
                onChanged: (bool? value) {
                  setState(() {
                    _isAmendChecked = value ?? false;
                  });
                },
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          child: const Text('Cancel'),
          onPressed: () {
            Navigator.of(context).pop();
          },
        ),
        ElevatedButton(
          child: const Text('Commit'),
          onPressed: () {
            final message = _messageController.text.trim();
            if (message.isEmpty) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Please enter a commit message'),
                ),
              );
              return;
            }
            
            widget.onCommit(message, _isAmendChecked);
            Navigator.of(context).pop();
          },
        ),
      ],
    );
  }
  
  IconData _getFileStatusIcon(GitFile file) {
    if (file.isModified) {
      return Icons.edit;
    } else if (file.isAdded) {
      return Icons.add_circle_outline;
    } else if (file.isDeleted) {
      return Icons.delete_outline;
    } else if (file.isRenamed) {
      return Icons.drive_file_rename_outline;
    }
    return Icons.insert_drive_file_outlined;
  }
  
  Color _getFileStatusColor(GitFile file) {
    if (file.isModified) {
      return Colors.amber;
    } else if (file.isAdded) {
      return Colors.green;
    } else if (file.isDeleted) {
      return Colors.red;
    } else if (file.isRenamed) {
      return Colors.blue;
    }
    return Colors.grey;
  }
}