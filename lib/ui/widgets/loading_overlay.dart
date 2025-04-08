import 'package:flutter/material.dart';
import 'dart:async';
import 'package:gaia_space/core/utils/app_logger.dart';

class LoadingOverlay extends StatefulWidget {
  final bool isLoading;
  final Widget child;
  final String? message;
  final Color? color;
  final double opacity;

  const LoadingOverlay({
    super.key,
    required this.isLoading,
    required this.child,
    this.message,
    this.color,
    this.opacity = 0.5,
  });

  @override
  State<LoadingOverlay> createState() => _LoadingOverlayState();
}

class _LoadingOverlayState extends State<LoadingOverlay> {
  late String _statusMessage;
  Timer? _loadingTimer;
  int _loadingDots = 0;
  int _loadingSeconds = 0;
  final AppLogger _logger = AppLogger('LoadingOverlay');

  @override
  void initState() {
    super.initState();
    _statusMessage = widget.message ?? 'Loading';
    
    if (widget.isLoading) {
      _startLoadingTimer();
    }
  }

  @override
  void didUpdateWidget(LoadingOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    
    if (widget.isLoading && !oldWidget.isLoading) {
      _startLoadingTimer();
    } else if (!widget.isLoading && oldWidget.isLoading) {
      _stopLoadingTimer();
    }
    
    if (widget.message != oldWidget.message && widget.message != null) {
      setState(() {
        _statusMessage = widget.message!;
      });
    }
  }

  void _startLoadingTimer() {
    print('Starting loading timer');
    _logger.debug('Starting loading animation timer');
    
    _loadingTimer?.cancel();
    _loadingTimer = Timer.periodic(const Duration(milliseconds: 500), (timer) {
      if (mounted) {
        setState(() {
          _loadingDots = (_loadingDots + 1) % 4;
          
          if (_loadingDots == 0) {
            _loadingSeconds++;
            if (_loadingSeconds > 5) {
              _logger.debug('Loading for ${_loadingSeconds} seconds now');
            }
          }
          
          // Update loading message with dots
          if (widget.message == null) {
            _statusMessage = 'Loading' + '.' * _loadingDots;
            
            // Add additional info if loading takes too long
            if (_loadingSeconds >= 10) {
              _statusMessage += '\nStill working... (${ _loadingSeconds}s)';
            }
          }
        });
      }
    });
  }

  void _stopLoadingTimer() {
    _logger.debug('Stopping loading animation timer');
    _loadingTimer?.cancel();
    _loadingTimer = null;
    _loadingSeconds = 0;
    _loadingDots = 0;
  }

  @override
  void dispose() {
    _stopLoadingTimer();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (widget.isLoading)
          Positioned.fill(
            child: _buildLoadingOverlay(context),
          ),
      ],
    );
  }

  Widget _buildLoadingOverlay(BuildContext context) {
    return Container(
      color: (widget.color ?? Colors.black).withOpacity(widget.opacity),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(
              _statusMessage,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
              ),
              textAlign: TextAlign.center,
            ),
            if (_loadingSeconds >= 20) ...[
              const SizedBox(height: 16),
              Text(
                'This is taking longer than expected.\nPlease check your connection.',
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 14,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      ),
    );
  }
}