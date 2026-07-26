import 'package:flutter/material.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/github.dart';
import 'package:gaia_space/core/models/git_diff.dart';

class GitDiffViewer extends StatefulWidget {
  final GitDiff? diff;
  final bool sideBySide;
  final bool showLineNumbers;
  final bool? isDarkMode;
  final bool showMinimap;
  final Function(String)? onCopyDiffAsPatch;
  
  const GitDiffViewer({
    Key? key,
    required this.diff,
    this.sideBySide = true,
    this.showLineNumbers = true,
    this.isDarkMode,
    this.showMinimap = true,
    this.onCopyDiffAsPatch,
  }) : super(key: key);

  @override
  _GitDiffViewerState createState() => _GitDiffViewerState();
}

class _GitDiffViewerState extends State<GitDiffViewer> {
  final ScrollController _verticalController = ScrollController();
  final ScrollController _horizontalController = ScrollController();
  final ScrollController _leftScrollController = ScrollController();
  final ScrollController _rightScrollController = ScrollController();
  final TextEditingController _searchController = TextEditingController();
  
  bool _showSearch = false;
  String _searchQuery = '';
  List<int> _searchResults = [];
  int _currentSearchIndex = -1;
  bool _showDiffOptions = false;
  
  bool get _isDarkMode => 
      widget.isDarkMode ?? 
      Theme.of(context).brightness == Brightness.dark;
  
  String _getFileExtension() {
    if (widget.diff == null) return 'txt';
    
    final filePath = widget.diff!.newFile;
    final lastDot = filePath.lastIndexOf('.');
    
    if (lastDot != -1 && lastDot < filePath.length - 1) {
      return filePath.substring(lastDot + 1).toLowerCase();
    }
    
    return 'txt';
  }
  
  String _getLanguage() {
    final extension = _getFileExtension();
    
    // Map file extension to highlight.js language
    switch (extension) {
      case 'dart':
        return 'dart';
      case 'js':
        return 'javascript';
      case 'ts':
        return 'typescript';
      case 'jsx':
        return 'javascript';
      case 'tsx':
        return 'typescript';
      case 'html':
      case 'htm':
        return 'xml';
      case 'css':
        return 'css';
      case 'json':
        return 'json';
      case 'md':
        return 'markdown';
      case 'py':
        return 'python';
      case 'java':
        return 'java';
      case 'kt':
        return 'kotlin';
      case 'swift':
        return 'swift';
      case 'c':
      case 'cpp':
      case 'h':
      case 'hpp':
        return 'cpp';
      case 'cs':
        return 'csharp';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'xml':
      case 'svg':
        return 'xml';
      case 'rb':
        return 'ruby';
      case 'go':
        return 'go';
      case 'rs':
        return 'rust';
      case 'sh':
      case 'bash':
        return 'bash';
      default:
        return 'plaintext';
    }
  }
  
  @override
  void initState() {
    super.initState();
    _searchController.addListener(_onSearchChanged);
  }

  void _onSearchChanged() {
    final query = _searchController.text.trim().toLowerCase();
    if (query != _searchQuery) {
      setState(() {
        _searchQuery = query;
        _searchResults = _findSearchResults(query);
        _currentSearchIndex = _searchResults.isNotEmpty ? 0 : -1;
      });
      
      if (_currentSearchIndex >= 0) {
        _scrollToSearchResult(_currentSearchIndex);
      }
    }
  }

  List<int> _findSearchResults(String query) {
    if (query.isEmpty || widget.diff == null) return [];
    
    final List<int> results = [];
    int lineIndex = 0;
    
    for (final hunk in widget.diff!.hunks) {
      // Skip hunk header
      lineIndex++;
      
      for (final line in hunk.lines) {
        if (line.content.toLowerCase().contains(query)) {
          results.add(lineIndex);
        }
        lineIndex++;
      }
    }
    
    return results;
  }

  void _scrollToSearchResult(int index) {
    if (index < 0 || index >= _searchResults.length) return;
    
    // Calculate approximate scroll position based on line height
    final double lineHeight = 20.0; // Estimate
    final double targetOffset = _searchResults[index] * lineHeight;
    
    _verticalController.animateTo(
      targetOffset,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
    );
  }
  
  void _nextSearchResult() {
    if (_searchResults.isEmpty) return;
    
    setState(() {
      _currentSearchIndex = (_currentSearchIndex + 1) % _searchResults.length;
    });
    
    _scrollToSearchResult(_currentSearchIndex);
  }
  
  void _previousSearchResult() {
    if (_searchResults.isEmpty) return;
    
    setState(() {
      _currentSearchIndex = (_currentSearchIndex - 1 + _searchResults.length) % _searchResults.length;
    });
    
    _scrollToSearchResult(_currentSearchIndex);
  }
  
  // Generate diff as patch format for copying
  String _generatePatchFormat() {
    if (widget.diff == null) return '';
    
    final buffer = StringBuffer();
    
    // Add file headers
    buffer.writeln('--- a/${widget.diff!.oldFile}');
    buffer.writeln('+++ b/${widget.diff!.newFile}');
    
    // Add hunks
    for (final hunk in widget.diff!.hunks) {
      buffer.writeln(hunk.header);
      
      for (final line in hunk.lines) {
        if (line.isAddition) {
          buffer.writeln('+${line.content}');
        } else if (line.isDeletion) {
          buffer.writeln('-${line.content}');
        } else if (line.isContext) {
          buffer.writeln(' ${line.content}');
        }
      }
    }
    
    return buffer.toString();
  }

  @override
  void dispose() {
    _verticalController.dispose();
    _horizontalController.dispose();
    _leftScrollController.dispose();
    _rightScrollController.dispose();
    _searchController.removeListener(_onSearchChanged);
    _searchController.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    if (widget.diff == null) {
      return const Center(
        child: Text('No diff to display'),
      );
    }
    
    if (widget.diff!.isBinary) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.file_present, size: 48),
            const SizedBox(height: 16),
            Text(
              'Binary file not shown',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(
              widget.diff!.newFile,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      );
    }
    
    if (widget.diff!.hunks.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.done, size: 48),
            const SizedBox(height: 16),
            Text(
              'No differences',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(
              widget.diff!.newFile,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      );
    }
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // File path bar
        Container(
          color: _isDarkMode ? Colors.grey.shade900 : Colors.grey.shade200,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  widget.diff!.newFile,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    fontFamily: 'monospace',
                    color: _isDarkMode ? Colors.white : Colors.black87,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              // Search button
              IconButton(
                icon: const Icon(Icons.search),
                tooltip: 'Search in diff',
                onPressed: () {
                  setState(() {
                    _showSearch = !_showSearch;
                    if (!_showSearch) {
                      _searchController.clear();
                    }
                  });
                },
              ),
              // More options button
              IconButton(
                icon: const Icon(Icons.more_vert),
                tooltip: 'More options',
                onPressed: () {
                  setState(() {
                    _showDiffOptions = !_showDiffOptions;
                  });
                },
              ),
              // View toggle
              TextButton.icon(
                icon: Icon(widget.sideBySide 
                    ? Icons.view_headline
                    : Icons.view_column),
                label: Text(widget.sideBySide 
                    ? 'Unified' 
                    : 'Side-by-side'),
                onPressed: () {
                  // You would implement the toggle in the parent
                },
              ),
            ],
          ),
        ),
        
        // Search bar (if shown)
        if (_showSearch)
          Container(
            color: _isDarkMode ? Colors.grey.shade800 : Colors.grey.shade100,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'Search in diff',
                      isDense: true,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(4),
                      ),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      suffixText: _searchResults.isNotEmpty 
                          ? '${_currentSearchIndex + 1}/${_searchResults.length}'
                          : null,
                    ),
                    onSubmitted: (_) => _nextSearchResult(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.navigate_before),
                  tooltip: 'Previous result',
                  onPressed: _searchResults.isEmpty ? null : _previousSearchResult,
                ),
                IconButton(
                  icon: const Icon(Icons.navigate_next),
                  tooltip: 'Next result',
                  onPressed: _searchResults.isEmpty ? null : _nextSearchResult,
                ),
              ],
            ),
          ),
          
        // Options menu (if shown)
        if (_showDiffOptions)
          Container(
            color: _isDarkMode ? Colors.grey.shade800 : Colors.grey.shade100,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Wrap(
              spacing: 8,
              children: [
                TextButton.icon(
                  icon: const Icon(Icons.content_copy),
                  label: const Text('Copy as Patch'),
                  onPressed: () {
                    final patch = _generatePatchFormat();
                    if (widget.onCopyDiffAsPatch != null) {
                      widget.onCopyDiffAsPatch!(patch);
                    }
                  },
                ),
                TextButton.icon(
                  icon: Icon(widget.showLineNumbers ? Icons.visibility_off : Icons.visibility),
                  label: Text(widget.showLineNumbers ? 'Hide Line Numbers' : 'Show Line Numbers'),
                  onPressed: () {
                    // You would implement the toggle in the parent
                  },
                ),
                TextButton.icon(
                  icon: Icon(widget.showMinimap ? Icons.hide_image : Icons.map),
                  label: Text(widget.showMinimap ? 'Hide Minimap' : 'Show Minimap'),
                  onPressed: () {
                    // You would implement the toggle in the parent
                  },
                ),
              ],
            ),
          ),
        
        // Diff content
        Expanded(
          child: Stack(
            children: [
              widget.sideBySide
                  ? _buildSideBySideDiff()
                  : _buildUnifiedDiff(),
              
              // Minimap if enabled
              if (widget.showMinimap)
                Positioned(
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: 60,
                  child: _buildMinimap(),
                ),
            ],
          ),
        ),
      ],
    );
  }
  
  Widget _buildUnifiedDiff() {
    final language = _getLanguage();
    final highlightTheme = githubTheme;
    final lineNumberColor = _isDarkMode ? Colors.grey.shade600 : Colors.grey.shade400;
    
    return Scrollbar(
      controller: _horizontalController,
      child: SingleChildScrollView(
        controller: _horizontalController,
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          width: 800, // Minimum width to show code nicely
          child: Scrollbar(
            controller: _verticalController,
            child: SingleChildScrollView(
              controller: _verticalController,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: widget.diff!.hunks.map((hunk) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Hunk header
                      Container(
                        width: double.infinity,
                        color: _isDarkMode 
                            ? Colors.blueGrey.shade900.withOpacity(0.5) 
                            : Colors.blueGrey.shade50,
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        child: Text(
                          hunk.header,
                          style: TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 12,
                            color: _isDarkMode ? Colors.grey : Colors.grey.shade700,
                          ),
                        ),
                      ),
                      
                      // Hunk content
                      ...hunk.lines.map((line) {
                        Color? bgColor;
                        
                        if (line.isAddition) {
                          bgColor = _isDarkMode 
                              ? Colors.green.shade900.withOpacity(0.4) 
                              : Colors.green.shade50;
                        } else if (line.isDeletion) {
                          bgColor = _isDarkMode 
                              ? Colors.red.shade900.withOpacity(0.4) 
                              : Colors.red.shade50;
                        }
                        
                        return Container(
                          color: bgColor,
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Line numbers
                              if (widget.showLineNumbers)
                                SizedBox(
                                  width: 80,
                                  child: Row(
                                    children: [
                                      SizedBox(
                                        width: 40,
                                        child: Text(
                                          line.oldLineNum > 0 ? line.oldLineNum.toString() : '',
                                          textAlign: TextAlign.right,
                                          style: TextStyle(
                                            fontFamily: 'monospace',
                                            fontSize: 12,
                                            color: lineNumberColor,
                                          ),
                                        ),
                                      ),
                                      SizedBox(
                                        width: 40,
                                        child: Text(
                                          line.newLineNum > 0 ? line.newLineNum.toString() : '',
                                          textAlign: TextAlign.right,
                                          style: TextStyle(
                                            fontFamily: 'monospace',
                                            fontSize: 12,
                                            color: lineNumberColor,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                
                              // Line marker
                              SizedBox(
                                width: 16,
                                child: Text(
                                  line.isAddition 
                                      ? '+' 
                                      : (line.isDeletion ? '-' : ' '),
                                  style: TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 14,
                                    color: line.isAddition 
                                        ? Colors.green 
                                        : (line.isDeletion ? Colors.red : null),
                                  ),
                                ),
                              ),
                              
                              // Line content
                              Expanded(
                                child: HighlightView(
                                  line.content,
                                  language: language,
                                  theme: highlightTheme,
                                  textStyle: const TextStyle(
                                    fontFamily: 'monospace',
                                    fontSize: 14,
                                  ),
                                  padding: EdgeInsets.zero,
                                ),
                              ),
                            ],
                          ),
                        );
                      }).toList(),
                    ],
                  );
                }).toList(),
              ),
            ),
          ),
        ),
      ),
    );
  }
  
  // Build the minimap for quick navigation
  Widget _buildMinimap() {
    if (widget.diff == null) return const SizedBox.shrink();
    
    // Calculate ratio of visible area to entire document
    final totalLines = _getTotalLines();
    final visibleRatio = _verticalController.hasClients && totalLines > 0
        ? _verticalController.position.viewportDimension / (_verticalController.position.maxScrollExtent + _verticalController.position.viewportDimension)
        : 1.0;
    
    // Calculate position of viewport in minimap
    final scrollRatio = _verticalController.hasClients && _verticalController.position.maxScrollExtent > 0
        ? _verticalController.offset / _verticalController.position.maxScrollExtent
        : 0.0;
    
    return GestureDetector(
      onVerticalDragStart: (details) => _handleMinimapDrag(details.localPosition.dy),
      onVerticalDragUpdate: (details) => _handleMinimapDrag(details.localPosition.dy),
      child: Container(
        color: _isDarkMode ? Colors.grey.shade900.withOpacity(0.5) : Colors.grey.shade200.withOpacity(0.5),
        child: Stack(
          fit: StackFit.expand,
          children: [
            // Draw the minimap content
            CustomPaint(
              painter: _MinimapPainter(
                diff: widget.diff!,
                isDarkMode: _isDarkMode,
              ),
            ),
            // Draw the viewport indicator
            Positioned(
              top: scrollRatio * (1.0 - visibleRatio) * MediaQuery.of(context).size.height,
              left: 0,
              right: 0,
              height: visibleRatio * MediaQuery.of(context).size.height,
              child: Container(
                decoration: BoxDecoration(
                  border: Border.all(
                    color: Theme.of(context).colorScheme.primary.withOpacity(0.5),
                    width: 2,
                  ),
                  color: Theme.of(context).colorScheme.primary.withOpacity(0.1),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  void _handleMinimapDrag(double dragPositionY) {
    if (!_verticalController.hasClients) return;
    
    // Calculate ratio based on drag position
    final heightRatio = dragPositionY / MediaQuery.of(context).size.height;
    
    // Limit to valid range
    final clampedRatio = heightRatio.clamp(0.0, 1.0);
    
    // Scroll to the position
    _verticalController.jumpTo(
      _verticalController.position.maxScrollExtent * clampedRatio
    );
  }
  
  int _getTotalLines() {
    if (widget.diff == null) return 0;
    
    int total = 0;
    for (final hunk in widget.diff!.hunks) {
      // Count hunk header
      total++;
      
      // Count all lines in the hunk
      total += hunk.lines.length;
    }
    
    return total;
  }

  Widget _buildSideBySideDiff() {
    final language = _getLanguage();
    final highlightTheme = githubTheme;
    final lineNumberColor = _isDarkMode ? Colors.grey.shade600 : Colors.grey.shade400;
    
    // Prepare data for side-by-side view
    final leftLines = <({int lineNum, String content, bool isDeleted})>[];
    final rightLines = <({int lineNum, String content, bool isAdded})>[];
    
    for (final hunk in widget.diff!.hunks) {
      // Add hunk header
      leftLines.add((
        lineNum: -1, 
        content: hunk.header, 
        isDeleted: false
      ));
      rightLines.add((
        lineNum: -1, 
        content: hunk.header, 
        isAdded: false
      ));
      
      // Process hunk lines
      for (final line in hunk.lines) {
        if (line.isAddition) {
          // Only right side
          leftLines.add((
            lineNum: -1, 
            content: '', 
            isDeleted: false
          ));
          rightLines.add((
            lineNum: line.newLineNum, 
            content: line.content, 
            isAdded: true
          ));
        } else if (line.isDeletion) {
          // Only left side
          leftLines.add((
            lineNum: line.oldLineNum, 
            content: line.content, 
            isDeleted: true
          ));
          rightLines.add((
            lineNum: -1, 
            content: '', 
            isAdded: false
          ));
        } else if (line.isContext) {
          // Both sides
          leftLines.add((
            lineNum: line.oldLineNum, 
            content: line.content, 
            isDeleted: false
          ));
          rightLines.add((
            lineNum: line.newLineNum, 
            content: line.content, 
            isAdded: false
          ));
        }
      }
    }
    
    return Scrollbar(
      controller: _horizontalController,
      child: SingleChildScrollView(
        controller: _horizontalController,
        scrollDirection: Axis.horizontal,
        child: SizedBox(
          width: 1200, // Minimum width to show side-by-side code
          child: Scrollbar(
            controller: _verticalController,
            child: SingleChildScrollView(
              controller: _verticalController,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Left side (old)
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: List.generate(leftLines.length, (index) {
                        final line = leftLines[index];
                        Color? bgColor;
                        
                        if (line.isDeleted) {
                          bgColor = _isDarkMode 
                              ? Colors.red.shade900.withOpacity(0.4) 
                              : Colors.red.shade50;
                        } else if (line.lineNum < 0) {
                          // Hunk header
                          bgColor = _isDarkMode 
                              ? Colors.blueGrey.shade900.withOpacity(0.5) 
                              : Colors.blueGrey.shade50;
                        }
                        
                        return Container(
                          color: bgColor,
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Line number
                              if (widget.showLineNumbers)
                                SizedBox(
                                  width: 40,
                                  child: Text(
                                    line.lineNum > 0 ? line.lineNum.toString() : '',
                                    textAlign: TextAlign.right,
                                    style: TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 12,
                                      color: lineNumberColor,
                                    ),
                                  ),
                                ),
                              
                              // Content
                              Expanded(
                                child: line.lineNum < 0 && line.content.isNotEmpty
                                    ? Text(
                                        line.content,
                                        style: TextStyle(
                                          fontFamily: 'monospace',
                                          fontSize: 12,
                                          color: _isDarkMode ? Colors.grey : Colors.grey.shade700,
                                        ),
                                      )
                                    : HighlightView(
                                        line.content,
                                        language: language,
                                        theme: highlightTheme,
                                        textStyle: const TextStyle(
                                          fontFamily: 'monospace',
                                          fontSize: 14,
                                        ),
                                        padding: EdgeInsets.zero,
                                      ),
                              ),
                            ],
                          ),
                        );
                      }),
                    ),
                  ),
                  
                  // Divider
                  Container(
                    width: 1,
                    height: 20.0 * leftLines.length, // Approximate height
                    color: _isDarkMode ? Colors.grey.shade800 : Colors.grey.shade300,
                  ),
                  
                  // Right side (new)
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: List.generate(rightLines.length, (index) {
                        final line = rightLines[index];
                        Color? bgColor;
                        
                        if (line.isAdded) {
                          bgColor = _isDarkMode 
                              ? Colors.green.shade900.withOpacity(0.4) 
                              : Colors.green.shade50;
                        } else if (line.lineNum < 0) {
                          // Hunk header
                          bgColor = _isDarkMode 
                              ? Colors.blueGrey.shade900.withOpacity(0.5) 
                              : Colors.blueGrey.shade50;
                        }
                        
                        return Container(
                          color: bgColor,
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Line number
                              if (widget.showLineNumbers)
                                SizedBox(
                                  width: 40,
                                  child: Text(
                                    line.lineNum > 0 ? line.lineNum.toString() : '',
                                    textAlign: TextAlign.right,
                                    style: TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 12,
                                      color: lineNumberColor,
                                    ),
                                  ),
                                ),
                              
                              // Content
                              Expanded(
                                child: line.lineNum < 0 && line.content.isNotEmpty
                                    ? Text(
                                        line.content,
                                        style: TextStyle(
                                          fontFamily: 'monospace',
                                          fontSize: 12,
                                          color: _isDarkMode ? Colors.grey : Colors.grey.shade700,
                                        ),
                                      )
                                    : HighlightView(
                                        line.content,
                                        language: language,
                                        theme: highlightTheme,
                                        textStyle: const TextStyle(
                                          fontFamily: 'monospace',
                                          fontSize: 14,
                                        ),
                                        padding: EdgeInsets.zero,
                                      ),
                              ),
                            ],
                          ),
                        );
                      }),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Custom painter for the minimap view of the diff
class _MinimapPainter extends CustomPainter {
  final GitDiff diff;
  final bool isDarkMode;
  
  _MinimapPainter({
    required this.diff,
    required this.isDarkMode,
  });
  
  @override
  void paint(Canvas canvas, Size size) {
    if (diff.hunks.isEmpty) return;
    
    // Calculate total number of lines
    int totalLines = 0;
    for (final hunk in diff.hunks) {
      totalLines += 1 + hunk.lines.length; // 1 for header
    }
    
    // Calculate line height
    final lineHeight = size.height / totalLines;
    
    // Prepare paints
    final addPaint = Paint()
      ..color = isDarkMode ? Colors.green.shade800 : Colors.green.shade200
      ..style = PaintingStyle.fill;
      
    final deletePaint = Paint()
      ..color = isDarkMode ? Colors.red.shade800 : Colors.red.shade200
      ..style = PaintingStyle.fill;
      
    final contextPaint = Paint()
      ..color = isDarkMode ? Colors.grey.shade800 : Colors.grey.shade300
      ..style = PaintingStyle.fill;
      
    final headerPaint = Paint()
      ..color = isDarkMode ? Colors.blueGrey.shade800 : Colors.blueGrey.shade200
      ..style = PaintingStyle.fill;
    
    // Current y position
    double y = 0;
    
    // Draw lines
    for (final hunk in diff.hunks) {
      // Draw hunk header
      canvas.drawRect(
        Rect.fromLTWH(0, y, size.width, lineHeight),
        headerPaint,
      );
      y += lineHeight;
      
      // Draw hunk lines
      for (final line in hunk.lines) {
        if (line.isAddition) {
          canvas.drawRect(
            Rect.fromLTWH(0, y, size.width, lineHeight),
            addPaint,
          );
        } else if (line.isDeletion) {
          canvas.drawRect(
            Rect.fromLTWH(0, y, size.width, lineHeight),
            deletePaint,
          );
        } else {
          // Context line
          canvas.drawRect(
            Rect.fromLTWH(0, y, size.width, lineHeight),
            contextPaint,
          );
        }
        y += lineHeight;
      }
    }
  }
  
  @override
  bool shouldRepaint(covariant _MinimapPainter oldDelegate) {
    return diff != oldDelegate.diff || isDarkMode != oldDelegate.isDarkMode;
  }
}