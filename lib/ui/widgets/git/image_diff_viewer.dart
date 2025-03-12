import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:gaia_space/core/models/git_diff.dart';

/// A widget for comparing images in a diff
class ImageDiffViewer extends StatefulWidget {
  final GitDiff diff;
  final String? oldImagePath;
  final String? newImagePath;
  final bool isDarkMode;

  const ImageDiffViewer({
    Key? key,
    required this.diff,
    this.oldImagePath,
    this.newImagePath,
    this.isDarkMode = false,
  }) : super(key: key);

  @override
  _ImageDiffViewerState createState() => _ImageDiffViewerState();
}

class _ImageDiffViewerState extends State<ImageDiffViewer> {
  ui.Image? _oldImage;
  ui.Image? _newImage;
  bool _isLoading = true;
  String _errorMessage = '';
  
  // View mode for image comparison
  DiffViewMode _viewMode = DiffViewMode.sideBySide;
  
  // For swipe mode
  double _swipePosition = 0.5;
  
  // For onion mode
  double _onionOpacity = 0.5;

  @override
  void initState() {
    super.initState();
    _loadImages();
  }

  Future<void> _loadImages() async {
    setState(() {
      _isLoading = true;
      _errorMessage = '';
    });

    try {
      // Load old image if available
      if (widget.oldImagePath != null) {
        try {
          final file = File(widget.oldImagePath!);
          if (await file.exists()) {
            final bytes = await file.readAsBytes();
            _oldImage = await _decodeImage(bytes);
          }
        } catch (e) {
          print('Error loading old image: $e');
        }
      }

      // Load new image if available
      if (widget.newImagePath != null) {
        try {
          final file = File(widget.newImagePath!);
          if (await file.exists()) {
            final bytes = await file.readAsBytes();
            _newImage = await _decodeImage(bytes);
          }
        } catch (e) {
          print('Error loading new image: $e');
        }
      }

      if (_oldImage == null && _newImage == null) {
        setState(() {
          _isLoading = false;
          _errorMessage = 'Unable to load images';
        });
        return;
      }

      setState(() {
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'Error loading images: $e';
      });
    }
  }

  Future<ui.Image> _decodeImage(Uint8List bytes) async {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    return frame.image;
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(),
      );
    }

    if (_errorMessage.isNotEmpty) {
      return Center(
        child: Text(
          _errorMessage,
          style: TextStyle(color: Colors.red),
        ),
      );
    }

    return Column(
      children: [
        // Mode selector
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8.0),
          child: SegmentedButton<DiffViewMode>(
            segments: const [
              ButtonSegment(
                value: DiffViewMode.sideBySide,
                icon: Icon(Icons.grid_view),
                label: Text('Side-by-Side'),
              ),
              ButtonSegment(
                value: DiffViewMode.swipe,
                icon: Icon(Icons.compare_arrows),
                label: Text('Swipe'),
              ),
              ButtonSegment(
                value: DiffViewMode.onion,
                icon: Icon(Icons.layers),
                label: Text('Onion Skin'),
              ),
            ],
            selected: {_viewMode},
            onSelectionChanged: (Set<DiffViewMode> selection) {
              setState(() {
                _viewMode = selection.first;
              });
            },
          ),
        ),
        
        // Controls based on view mode
        if (_viewMode == DiffViewMode.swipe)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Column(
              children: [
                Slider(
                  value: _swipePosition,
                  onChanged: (value) {
                    setState(() {
                      _swipePosition = value;
                    });
                  },
                ),
                const Text('Drag to compare images'),
              ],
            ),
          ),
          
        if (_viewMode == DiffViewMode.onion)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Column(
              children: [
                Slider(
                  value: _onionOpacity,
                  onChanged: (value) {
                    setState(() {
                      _onionOpacity = value;
                    });
                  },
                ),
                Text('Opacity: ${(_onionOpacity * 100).toInt()}%'),
              ],
            ),
          ),
          
        // Image comparison view
        Expanded(
          child: _buildImageView(),
        ),
      ],
    );
  }

  Widget _buildImageView() {
    // Handle missing images
    if (_oldImage == null && _newImage == null) {
      return const Center(
        child: Text('No images to display'),
      );
    }

    switch (_viewMode) {
      case DiffViewMode.sideBySide:
        return _buildSideBySideView();
      case DiffViewMode.swipe:
        return _buildSwipeView();
      case DiffViewMode.onion:
        return _buildOnionView();
    }
  }

  Widget _buildSideBySideView() {
    return Row(
      children: [
        // Old image
        Expanded(
          child: Column(
            children: [
              Text(
                'Old',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: widget.isDarkMode ? Colors.white70 : Colors.black87,
                ),
              ),
              Expanded(
                child: _oldImage != null
                    ? InteractiveImageView(image: _oldImage!)
                    : const Center(child: Text('No previous version')),
              ),
            ],
          ),
        ),
        
        // Divider
        Container(
          width: 1,
          color: widget.isDarkMode ? Colors.white24 : Colors.black12,
        ),
        
        // New image
        Expanded(
          child: Column(
            children: [
              Text(
                'New',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: widget.isDarkMode ? Colors.white70 : Colors.black87,
                ),
              ),
              Expanded(
                child: _newImage != null
                    ? InteractiveImageView(image: _newImage!)
                    : const Center(child: Text('Image deleted')),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSwipeView() {
    if (_oldImage == null || _newImage == null) {
      // If one image is missing, show the available one
      return Center(
        child: _oldImage != null
            ? InteractiveImageView(image: _oldImage!)
            : InteractiveImageView(image: _newImage!),
      );
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final splitPosition = width * _swipePosition;
        
        return Stack(
          children: [
            // Left image (old)
            Positioned.fill(
              child: ClipRect(
                child: Align(
                  alignment: Alignment.centerLeft,
                  widthFactor: _swipePosition,
                  child: SizedBox(
                    width: width,
                    child: InteractiveImageView(image: _oldImage!),
                  ),
                ),
              ),
            ),
            
            // Right image (new)
            Positioned.fill(
              child: ClipRect(
                child: Align(
                  alignment: Alignment.centerRight,
                  widthFactor: 1 - _swipePosition,
                  child: SizedBox(
                    width: width,
                    child: InteractiveImageView(image: _newImage!),
                  ),
                ),
              ),
            ),
            
            // Divider line
            Positioned(
              top: 0,
              bottom: 0,
              left: splitPosition - 1,
              width: 2,
              child: Container(
                color: Colors.blue,
              ),
            ),
            
            // Drag handle
            Positioned(
              top: constraints.maxHeight / 2 - 20,
              left: splitPosition - 15,
              child: GestureDetector(
                onHorizontalDragUpdate: (details) {
                  setState(() {
                    _swipePosition += details.delta.dx / width;
                    _swipePosition = _swipePosition.clamp(0.0, 1.0);
                  });
                },
                child: Container(
                  width: 30,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.blue.withOpacity(0.7),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Icon(
                    Icons.drag_indicator,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildOnionView() {
    if (_oldImage == null || _newImage == null) {
      // If one image is missing, show the available one
      return Center(
        child: _oldImage != null
            ? InteractiveImageView(image: _oldImage!)
            : InteractiveImageView(image: _newImage!),
      );
    }

    return Stack(
      children: [
        // Bottom layer (old image)
        Positioned.fill(
          child: InteractiveImageView(image: _oldImage!),
        ),
        
        // Top layer (new image with opacity)
        Positioned.fill(
          child: Opacity(
            opacity: _onionOpacity,
            child: InteractiveImageView(image: _newImage!),
          ),
        ),
      ],
    );
  }
}

/// View modes for image diff comparison
enum DiffViewMode {
  sideBySide,
  swipe,
  onion,
}

/// A widget that allows panning and zooming of an image
class InteractiveImageView extends StatefulWidget {
  final ui.Image image;

  const InteractiveImageView({
    Key? key,
    required this.image,
  }) : super(key: key);

  @override
  _InteractiveImageViewState createState() => _InteractiveImageViewState();
}

class _InteractiveImageViewState extends State<InteractiveImageView> {
  final TransformationController _transformationController = TransformationController();
  double _scale = 1.0;

  @override
  void dispose() {
    _transformationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return InteractiveViewer(
      transformationController: _transformationController,
      minScale: 0.5,
      maxScale: 4.0,
      onInteractionUpdate: (details) {
        setState(() {
          _scale = _transformationController.value.getMaxScaleOnAxis();
        });
      },
      child: Center(
        child: CustomPaint(
          painter: _ImagePainter(image: widget.image),
          size: Size(widget.image.width.toDouble(), widget.image.height.toDouble()),
        ),
      ),
    );
  }
}

/// Custom painter to draw a ui.Image
class _ImagePainter extends CustomPainter {
  final ui.Image image;

  _ImagePainter({required this.image});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..filterQuality = FilterQuality.high;
    
    // Draw the image centered in the available space
    canvas.drawImage(image, Offset.zero, paint);
  }

  @override
  bool shouldRepaint(covariant _ImagePainter oldDelegate) {
    return image != oldDelegate.image;
  }
}