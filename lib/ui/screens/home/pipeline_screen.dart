import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/ui/widgets/empty_state.dart';

class PipelineScreen extends ConsumerWidget {
  const PipelineScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // This is a placeholder for the Pipeline screen
    // In a real app, this would fetch and display CI/CD pipelines
    
    return Scaffold(
      body: const EmptyState(
        icon: Icons.account_tree,
        title: 'CI/CD Pipelines',
        message: 'Set up continuous integration and deployment pipelines for your projects.',
        actionText: 'Create Pipeline',
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          // TODO: Implement pipeline creation
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}