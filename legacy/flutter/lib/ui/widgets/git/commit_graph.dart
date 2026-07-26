import 'package:flutter/material.dart';
import 'package:gaia_space/core/models/git_branch.dart';
import 'package:gaia_space/core/models/git_commit.dart';
import 'package:intl/intl.dart';

class CommitGraphNode {
  final GitCommit commit;
  final List<String> branchNames;
  final Map<int, int>? columnMap; // Maps parent index to column
  final int column;
  
  CommitGraphNode({
    required this.commit,
    this.branchNames = const [],
    this.columnMap,
    required this.column,
  });
}

class CommitGraph extends StatefulWidget {
  final List<GitCommit> commits;
  final List<GitBranch> branches;
  final String? selectedCommitSha;
  final Function(GitCommit commit) onCommitSelected;
  final Function(GitCommit commit, String action)? onCommitAction;

  const CommitGraph({
    Key? key,
    required this.commits,
    required this.branches,
    this.selectedCommitSha,
    required this.onCommitSelected,
    this.onCommitAction,
  }) : super(key: key);

  @override
  _CommitGraphState createState() => _CommitGraphState();
}

class _CommitGraphState extends State<CommitGraph> {
  final ScrollController _scrollController = ScrollController();
  List<CommitGraphNode> _graphNodes = [];
  final Map<String, int> _branchColors = {};
  final List<Color> _colorPalette = [
    Colors.blue,
    Colors.green,
    Colors.red,
    Colors.purple,
    Colors.orange,
    Colors.teal,
    Colors.pink,
    Colors.indigo,
    Colors.amber,
    Colors.cyan,
  ];
  
  @override
  void initState() {
    super.initState();
    _computeGraph();
  }
  
  @override
  void didUpdateWidget(CommitGraph oldWidget) {
    super.didUpdateWidget(oldWidget);
    
    // Recompute graph if commits or branches change
    if (widget.commits != oldWidget.commits || widget.branches != oldWidget.branches) {
      _computeGraph();
    }
  }
  
  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }
  
  // Compute the graph layout (columns for branches)
  void _computeGraph() {
    if (widget.commits.isEmpty) {
      setState(() {
        _graphNodes = [];
      });
      return;
    }
    
    // Initialize branch colors
    _assignBranchColors();
    
    // Map of commit SHA to branches that point to it
    final commitBranches = <String, List<String>>{};
    for (final branch in widget.branches) {
      if (!commitBranches.containsKey(branch.targetCommitSha)) {
        commitBranches[branch.targetCommitSha] = [];
      }
      commitBranches[branch.targetCommitSha]!.add(branch.name);
    }
    
    // Build graph data
    final nodes = <CommitGraphNode>[];
    final activeBranches = <String, int>{}; // SHA -> column map for active branches
    int maxColumn = 0;
    
    for (int i = 0; i < widget.commits.length; i++) {
      final commit = widget.commits[i];
      
      // Handle column assignment
      int column;
      
      // Try to place commit in same column as one of its children
      bool foundInActive = false;
      if (activeBranches.containsKey(commit.sha)) {
        column = activeBranches[commit.sha]!;
        activeBranches.remove(commit.sha);
        foundInActive = true;
      } else {
        // Assign a new column
        column = 0;
        while (activeBranches.values.contains(column)) {
          column++;
        }
        
        maxColumn = maxColumn > column ? maxColumn : column;
      }
      
      // Track parents for later commits
      final parentColumns = <int, int>{};
      for (int j = 0; j < commit.parentShas.length; j++) {
        final parentSha = commit.parentShas[j];
        if (j == 0) {
          // First parent continues in same column
          activeBranches[parentSha] = column;
          parentColumns[j] = column;
        } else {
          // Merge branch gets its own column
          int mergeColumn = 0;
          while (activeBranches.values.contains(mergeColumn) || mergeColumn == column) {
            mergeColumn++;
          }
          activeBranches[parentSha] = mergeColumn;
          parentColumns[j] = mergeColumn;
          
          maxColumn = maxColumn > mergeColumn ? maxColumn : mergeColumn;
        }
      }
      
      // Add node to graph
      nodes.add(CommitGraphNode(
        commit: commit,
        branchNames: commitBranches[commit.sha] ?? [],
        columnMap: parentColumns,
        column: column,
      ));
    }
    
    setState(() {
      _graphNodes = nodes;
    });
  }
  
  void _assignBranchColors() {
    int colorIndex = 0;
    
    // First, assign colors to local branches
    for (final branch in widget.branches.where((b) => b.isLocal)) {
      if (!_branchColors.containsKey(branch.name)) {
        _branchColors[branch.name] = colorIndex % _colorPalette.length;
        colorIndex++;
      }
    }
    
    // Then, match remote branches with their local counterparts or assign new colors
    for (final branch in widget.branches.where((b) => b.isRemote)) {
      // Extract the branch name without remote prefix
      final parts = branch.name.split('/');
      if (parts.length > 1) {
        final localName = parts.sublist(1).join('/');
        
        // See if we have a local branch with matching name
        final localBranch = widget.branches.firstWhere(
          (b) => b.isLocal && b.name == localName,
          orElse: () => GitBranch(
            name: '', 
            shortName: '', 
            targetCommitSha: '', 
            isLocal: false,
          ),
        );
        
        if (localBranch.name.isNotEmpty && _branchColors.containsKey(localBranch.name)) {
          // Use same color as local branch
          _branchColors[branch.name] = _branchColors[localBranch.name]!;
        } else {
          // Assign new color
          _branchColors[branch.name] = colorIndex % _colorPalette.length;
          colorIndex++;
        }
      } else {
        // Just assign a color if we can't match it
        _branchColors[branch.name] = colorIndex % _colorPalette.length;
        colorIndex++;
      }
    }
  }
  
  Color _getBranchColor(String branchName) {
    if (_branchColors.containsKey(branchName)) {
      return _colorPalette[_branchColors[branchName]!];
    }
    
    // Default color if not found
    return Colors.grey;
  }
  
  @override
  Widget build(BuildContext context) {
    if (_graphNodes.isEmpty) {
      return const Center(
        child: Text('No commits found'),
      );
    }
    
    return Scrollbar(
      controller: _scrollController,
      child: ListView.builder(
        controller: _scrollController,
        itemCount: _graphNodes.length,
        itemBuilder: (context, index) {
          return _buildCommitRow(_graphNodes[index], index);
        },
      ),
    );
  }
  
  Widget _buildCommitRow(CommitGraphNode node, int index) {
    final isSelected = widget.selectedCommitSha == node.commit.sha;
    
    return Material(
      color: isSelected 
          ? Theme.of(context).colorScheme.primaryContainer.withOpacity(0.15)
          : Colors.transparent,
      child: InkWell(
        onTap: () => widget.onCommitSelected(node.commit),
        onLongPress: () => _showCommitMenu(context, node),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8.0),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Graph visualization
              SizedBox(
                width: 100,
                height: 30,
                child: CustomPaint(
                  painter: _CommitGraphPainter(
                    node: node,
                    previousNode: index > 0 ? _graphNodes[index - 1] : null,
                    nextNode: index < _graphNodes.length - 1 ? _graphNodes[index + 1] : null,
                    branchColors: _branchColors,
                    colorPalette: _colorPalette,
                  ),
                ),
              ),
              
              // Commit info
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Commit message
                    Text(
                      node.commit.message,
                      style: TextStyle(
                        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                        color: isSelected 
                            ? Theme.of(context).colorScheme.primary
                            : Theme.of(context).textTheme.bodyLarge?.color,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    
                    const SizedBox(height: 4),
                    
                    // Commit details
                    Row(
                      children: [
                        // Author
                        Text(
                          node.commit.author,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        
                        const SizedBox(width: 8),
                        
                        // Date
                        Text(
                          _formatDate(node.commit.date),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        
                        const SizedBox(width: 8),
                        
                        // SHA short
                        Text(
                          node.commit.sha.substring(0, 7),
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            fontFamily: 'monospace',
                          ),
                        ),
                      ],
                    ),
                    
                    // Branch labels, if any
                    if (node.branchNames.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4.0),
                        child: Wrap(
                          spacing: 4,
                          runSpacing: 4,
                          children: node.branchNames.map((branchName) {
                            return Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: _getBranchColor(branchName).withOpacity(0.2),
                                border: Border.all(
                                  color: _getBranchColor(branchName).withOpacity(0.8),
                                  width: 1,
                                ),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                branchName.contains('/') 
                                    ? branchName.split('/').last 
                                    : branchName,
                                style: TextStyle(
                                  fontSize: 10,
                                  color: _getBranchColor(branchName).withOpacity(0.8),
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
  
  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);
    
    if (difference.inDays < 1) {
      if (difference.inHours < 1) {
        return '${difference.inMinutes} min ago';
      }
      return '${difference.inHours} hours ago';
    } else if (difference.inDays < 7) {
      return '${difference.inDays} days ago';
    } else if (difference.inDays < 365) {
      return DateFormat.MMMd().format(date);
    } else {
      return DateFormat.yMMMd().format(date);
    }
  }
  
  void _showCommitMenu(BuildContext context, CommitGraphNode node) {
    final RenderBox renderBox = context.findRenderObject() as RenderBox;
    final position = renderBox.localToGlobal(Offset.zero);
    
    showMenu(
      context: context,
      position: RelativeRect.fromLTRB(
        position.dx + 100,
        position.dy,
        position.dx,
        position.dy + 50,
      ),
      items: [
        const PopupMenuItem<String>(
          value: 'checkout',
          child: Text('Checkout this commit'),
        ),
        const PopupMenuItem<String>(
          value: 'create_branch',
          child: Text('Create branch here'),
        ),
        const PopupMenuItem<String>(
          value: 'cherry_pick',
          child: Text('Cherry-pick to current branch'),
        ),
        const PopupMenuItem<String>(
          value: 'reset',
          child: Text('Reset current branch to here'),
        ),
        const PopupMenuItem<String>(
          value: 'copy_sha',
          child: Text('Copy commit SHA'),
        ),
      ],
    ).then((String? action) {
      if (action != null && widget.onCommitAction != null) {
        widget.onCommitAction!(node.commit, action);
      }
    });
  }
}

// Custom painter for drawing the commit graph
class _CommitGraphPainter extends CustomPainter {
  final CommitGraphNode node;
  final CommitGraphNode? previousNode;
  final CommitGraphNode? nextNode;
  final Map<String, int> branchColors;
  final List<Color> colorPalette;
  
  _CommitGraphPainter({
    required this.node,
    this.previousNode,
    this.nextNode,
    required this.branchColors,
    required this.colorPalette,
  });
  
  @override
  void paint(Canvas canvas, Size size) {
    final paintCircle = Paint()
      ..color = _getBranchColor(node.column)
      ..style = PaintingStyle.fill;
    
    final paintLine = Paint()
      ..color = _getBranchColor(node.column)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    
    // Calculate spacing
    final double colWidth = size.width / 8;  // Allow 8 columns max
    final double rowHeight = size.height;
    final double circleRadius = 4;
    final double circleX = node.column * colWidth + colWidth / 2;
    final double circleY = rowHeight / 2;
    
    // Draw lines coming from previous commit
    if (previousNode != null) {
      // Direct line from previous commit in same column
      if (previousNode!.column == node.column) {
        canvas.drawLine(
          Offset(circleX, 0),
          Offset(circleX, circleY - circleRadius),
          paintLine,
        );
      }
      
      // Draw incoming branch lines
      if (previousNode!.commit.parentShas.contains(node.commit.sha)) {
        // Find which parent we are
        int parentIndex = previousNode!.commit.parentShas.indexOf(node.commit.sha);
        if (previousNode!.columnMap != null && previousNode!.columnMap!.containsKey(parentIndex)) {
          int sourceColumn = previousNode!.columnMap![parentIndex]!;
          
          if (sourceColumn != node.column) {
            final sourceX = sourceColumn * colWidth + colWidth / 2;
            final targetX = circleX;
            
            final curve = Path()
              ..moveTo(sourceX, 0)
              ..quadraticBezierTo(
                sourceX, rowHeight / 3,
                (sourceX + targetX) / 2, rowHeight / 3,
              )
              ..quadraticBezierTo(
                targetX, rowHeight / 3,
                targetX, circleY - circleRadius,
              );
            
            canvas.drawPath(
              curve, 
              Paint()
                ..color = _getBranchColor(sourceColumn)
                ..style = PaintingStyle.stroke
                ..strokeWidth = 2,
            );
          }
        }
      }
    }
    
    // Draw outgoing lines to parents
    for (int i = 0; i < node.commit.parentShas.length; i++) {
      int targetColumn;
      
      if (node.columnMap != null && node.columnMap!.containsKey(i)) {
        targetColumn = node.columnMap![i]!;
      } else {
        // Default to current column for first parent
        targetColumn = i == 0 ? node.column : 0;
      }
      
      // Draw lines to next commits
      if (nextNode != null && nextNode!.commit.sha == node.commit.parentShas[i]) {
        final targetX = targetColumn * colWidth + colWidth / 2;
        
        if (targetColumn == node.column) {
          // Straight line
          canvas.drawLine(
            Offset(circleX, circleY + circleRadius),
            Offset(circleX, size.height),
            paintLine,
          );
        } else {
          // Curved line
          final curve = Path()
            ..moveTo(circleX, circleY + circleRadius)
            ..quadraticBezierTo(
              circleX, rowHeight * 2/3,
              (circleX + targetX) / 2, rowHeight * 2/3,
            )
            ..quadraticBezierTo(
              targetX, rowHeight * 2/3,
              targetX, size.height,
            );
          
          canvas.drawPath(
            curve, 
            Paint()
              ..color = _getBranchColor(targetColumn)
              ..style = PaintingStyle.stroke
              ..strokeWidth = 2,
          );
        }
      } else {
        // Parent not in next visible commit, just draw a straight line
        if (targetColumn == node.column) {
          canvas.drawLine(
            Offset(circleX, circleY + circleRadius),
            Offset(circleX, size.height),
            paintLine,
          );
        }
      }
    }
    
    // Handle pass-through lines (lines that go through this row but don't connect to this commit)
    if (previousNode != null && nextNode != null) {
      final activeColumns = <int>{};
      
      // Add columns from previous node
      for (int i = 0; i < previousNode!.commit.parentShas.length; i++) {
        if (previousNode!.columnMap != null && previousNode!.columnMap!.containsKey(i)) {
          activeColumns.add(previousNode!.columnMap![i]!);
        }
      }
      
      // Add columns from this node's parents
      for (int i = 0; i < node.commit.parentShas.length; i++) {
        if (node.columnMap != null && node.columnMap!.containsKey(i)) {
          activeColumns.add(node.columnMap![i]!);
        }
      }
      
      // Draw pass-through lines for all active columns except this node's column
      for (final col in activeColumns) {
        if (col != node.column) {
          final passX = col * colWidth + colWidth / 2;
          
          canvas.drawLine(
            Offset(passX, 0),
            Offset(passX, size.height),
            Paint()
              ..color = _getBranchColor(col)
              ..style = PaintingStyle.stroke
              ..strokeWidth = 2,
          );
        }
      }
    }
    
    // Draw commit circle
    canvas.drawCircle(
      Offset(circleX, circleY),
      circleRadius,
      paintCircle,
    );
    
    // If it's a merge commit, highlight it
    if (node.commit.parentShas.length > 1) {
      canvas.drawCircle(
        Offset(circleX, circleY),
        circleRadius + 2,
        Paint()
          ..color = paintCircle.color
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1,
      );
    }
  }
  
  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return true;
  }
  
  Color _getBranchColor(int column) {
    return colorPalette[column % colorPalette.length];
  }
}