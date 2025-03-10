import 'package:flutter/material.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/github.dart';
import 'package:flutter_highlight/themes/github-dark.dart';
import 'package:gaia_space/core/models/git_diff.dart';

class GitDiffViewer extends StatefulWidget {
  final GitDiff? diff;
  final bool sideBySide;
  final bool showLineNumbers;
  final bool? isDarkMode;
  
  const GitDiffViewer({
    Key? key,
    required this.diff,
    this.sideBySide = true,
    this.showLineNumbers = true,
    this.isDarkMode,
  }) : super(key: key);

  @override
  _GitDiffViewerState createState() => _GitDiffViewerState();
}

class _GitDiffViewerState extends State<GitDiffViewer> {
  final ScrollController _verticalController = ScrollController();
  final ScrollController _horizontalController = ScrollController();
  final ScrollController _leftScrollController = ScrollController();
  final ScrollController _rightScrollController = ScrollController();
  
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
  void dispose() {
    _verticalController.dispose();
    _horizontalController.dispose();
    _leftScrollController.dispose();
    _rightScrollController.dispose();
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
        
        // Diff content
        Expanded(
          child: widget.sideBySide
              ? _buildSideBySideDiff()
              : _buildUnifiedDiff(),
        ),
      ],
    );
  }
  
  Widget _buildUnifiedDiff() {
    final language = _getLanguage();
    final highlightTheme = _isDarkMode ? githubDarkTheme : githubTheme;
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
  
  Widget _buildSideBySideDiff() {
    final language = _getLanguage();
    final highlightTheme = _isDarkMode ? githubDarkTheme : githubTheme;
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