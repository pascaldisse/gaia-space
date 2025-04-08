import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/services/auth_service.dart';
import 'package:gaia_space/ui/screens/auth/login_screen.dart';
import 'package:gaia_space/ui/screens/home/home_screen.dart';
import 'package:gaia_space/ui/themes/app_theme.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:gaia_space/core/utils/connectivity_checker.dart';

class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _opacityAnimation;
  late Animation<double> _scaleAnimation;
  final AppLogger _logger = AppLogger('SplashScreen');
  
  String _statusText = 'Initializing...';
  bool _showDebugInfo = true;
  int _secondsElapsed = 0;
  List<String> _loadingSteps = [];

  @override
  void initState() {
    super.initState();
    print('SplashScreen initState called');
    _logger.info('SplashScreen initialization started');
    _addLoadingStep('Splash screen initialization started');
    
    // Set a hard timeout to ensure we always navigate
    _setupFailsafeTimer();
    
    try {
      // Initialize animations
      print('Initializing animations...');
      _addLoadingStep('Initializing animations');
      _animationController = AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 1500),
      );
      
      _opacityAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
        CurvedAnimation(
          parent: _animationController,
          curve: const Interval(0.0, 0.5, curve: Curves.easeIn),
        ),
      );
      
      _scaleAnimation = Tween<double>(begin: 0.8, end: 1.0).animate(
        CurvedAnimation(
          parent: _animationController,
          curve: const Interval(0.0, 0.5, curve: Curves.easeOutCubic),
        ),
      );
      print('Animations initialized successfully');
      _addLoadingStep('Animations initialized successfully');
      
      // Start tracking elapsed time
      _startTimeTracking();
      
      // Start animation
      print('Starting animation...');
      _animationController.forward();
      _logger.info('Animation started');
      _addLoadingStep('Animation started');
      
      // Check connectivity early
      _checkConnectivity();
      
      // Navigate after animation completes
      _animationController.addStatusListener((status) {
        print('Animation status changed: $status');
        if (status == AnimationStatus.completed) {
          _addLoadingStep('Animation completed, preparing navigation');
          print('Animation completed, preparing navigation...');
          _logger.info('Animation completed, navigating to next screen');
          
          // Check if we've waited at least 2 seconds before navigating
          if (_secondsElapsed >= 2) {
            _navigateToNextScreen();
          } else {
            // Wait a bit more to show the splash screen
            Future.delayed(const Duration(seconds: 2), () {
              if (mounted) {
                _addLoadingStep('Minimum display time reached, navigating');
                _navigateToNextScreen();
              }
            });
          }
        }
      });
    } catch (e, stack) {
      print('ERROR in SplashScreen initialization: $e');
      print('Stack trace: $stack');
      _logger.error('Error in splash screen initialization', error: e, stackTrace: stack);
      _addLoadingStep('ERROR: $e');
      
      // Try to navigate anyway after a delay
      Future.delayed(const Duration(seconds: 3), () {
        if (mounted) {
          _addLoadingStep('Recovery after error, attempting navigation');
          print('Attempting navigation after error recovery delay...');
          _navigateToNextScreen();
        }
      });
    }
  }
  
  // Set up a failsafe timer to ensure we eventually navigate
  void _setupFailsafeTimer() {
    // Hard timeout of 15 seconds to ensure we eventually navigate
    Future.delayed(const Duration(seconds: 15), () {
      if (mounted) {
        _addLoadingStep('FAILSAFE: 15-second timeout reached, forcing navigation');
        print('SplashScreen: FAILSAFE - 15-second timeout reached, bypassing normal flow');
        _logger.warning('Failsafe timer triggered after 15 seconds, forcing navigation to login');
        
        // Force navigate to login screen
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (context) => const LoginScreen()),
        );
      }
    });
  }
  
  void _startTimeTracking() {
    Future.delayed(const Duration(seconds: 1), () {
      if (mounted) {
        setState(() {
          _secondsElapsed++;
          _addLoadingStep('Loading time: $_secondsElapsed seconds');
        });
        
        // Continue tracking if still mounted
        if (_secondsElapsed < 60) {
          _startTimeTracking();
        }
      }
    });
  }
  
  void _addLoadingStep(String step) {
    if (mounted) {
      setState(() {
        _loadingSteps.add('${_loadingSteps.length + 1}. $step');
        
        // Update status text
        if (_loadingSteps.length <= 2) {
          _statusText = step;
        } else if (_secondsElapsed > 10) {
          _statusText = 'Still loading... ($_secondsElapsed seconds)';
        }
      });
    } else {
      print('SplashScreen: Cannot add step "$step" - widget not mounted');
    }
  }
  
  Future<void> _checkConnectivity() async {
    try {
      _addLoadingStep('Checking network connectivity');
      final isConnected = await ConnectivityChecker.checkConnectivity();
      _addLoadingStep('Network check result: ${isConnected ? 'CONNECTED' : 'NO CONNECTION'}');
    } catch (e) {
      _addLoadingStep('Network check error: $e');
    }
  }

  // Check auth status and navigate accordingly
  Future<void> _navigateToNextScreen() async {
    if (!mounted) {
      print('Widget is no longer mounted before starting navigation');
      return;
    }
    
    print('Starting navigation logic...');
    _addLoadingStep('Starting navigation');
    _logger.info('Navigating to next screen');

    try {
      // Small delay to ensure animation is complete
      await Future.delayed(const Duration(milliseconds: 300));
      _addLoadingStep('Checking if widget is still mounted');
      
      if (!mounted) {
        print('Widget is no longer mounted, abandoning navigation');
        _logger.warning('Navigation abandoned - widget not mounted');
        return;
      }
      
      _addLoadingStep('Checking authentication status');
      print('Checking authentication status...');
      final isAuthenticated = AuthService.isAuthenticated;
      _logger.info('Authentication status: ${isAuthenticated ? 'Authenticated' : 'Not authenticated'}');
      _addLoadingStep('Auth status: ${isAuthenticated ? 'Authenticated' : 'Not authenticated'}');
      
      if (isAuthenticated) {
        _addLoadingStep('User authenticated, navigating to HomeScreen');
        print('User is authenticated, navigating to HomeScreen');
        _logger.info('Navigating to HomeScreen (already authenticated)');
        
        if (mounted) {
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(builder: (context) => const HomeScreen()),
          );
          _logger.info('HomeScreen navigation completed');
        }
      } else {
        print('User is not authenticated, checking for stored credentials');
        _addLoadingStep('Checking for stored credentials');
        _logger.info('Checking for stored user credentials');
        
        // Skip autologin for web platform to avoid issues
        if (kIsWeb) {
          _addLoadingStep('Web platform detected, skipping auto-login');
          print('Web platform detected, skipping auto-login for stability');
          _logger.info('Web platform detected, skipping auto-login attempt');
        } else {
          // Only try auto-login on native platforms
          // Check if we have stored credentials and try to auto-login
          final storedUsername = await _getLastLoggedInUser();
          if (storedUsername != null) {
            _addLoadingStep('Found stored username: $storedUsername');
            print('Found stored username: $storedUsername, attempting auto-login');
            _logger.info('Attempting auto-login with stored credentials');
            
            try {
              // Auto-login with stored username (mock password in this case)
              _addLoadingStep('Calling AuthService.login()');
              print('Calling AuthService.login()...');
              await AuthService.login(storedUsername, 'password123');
              _logger.info('Auto-login successful');
              _addLoadingStep('Auto-login successful');
              
              if (!mounted) {
                print('Widget is no longer mounted after login, abandoning navigation');
                _logger.warning('Navigation abandoned after login - widget not mounted');
                return;
              }
              
              _addLoadingStep('Navigating to HomeScreen after auto-login');
              print('Auto-login successful, navigating to HomeScreen');
              _logger.info('Navigating to HomeScreen after auto-login');
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (context) => const HomeScreen()),
              );
              _logger.info('HomeScreen navigation completed');
              return;
            } catch (e, stack) {
              _addLoadingStep('Auto-login failed: $e');
              print('Auto-login failed: $e');
              print('Stack trace: $stack');
              _logger.error('Auto-login failed', error: e, stackTrace: stack);
              // Continue to login screen
            }
          } else {
            _addLoadingStep('No stored credentials found');
            print('No stored credentials found');
            _logger.info('No stored credentials found');
          }
        }
        
        // If no auto-login, go to login screen
        if (!mounted) {
          print('Widget is no longer mounted before navigation to login, abandoning navigation');
          _logger.warning('Navigation abandoned before login screen - widget not mounted');
          return;
        }
        
        _addLoadingStep('Navigating to LoginScreen');
        print('Navigating to LoginScreen');
        _logger.info('Navigating to LoginScreen');
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (context) => const LoginScreen()),
        );
        _logger.info('LoginScreen navigation completed');
      }
    } catch (e, stack) {
      _addLoadingStep('ERROR during navigation: $e');
      print('ERROR during navigation: $e');
      print('Stack trace: $stack');
      _logger.error('Navigation error', error: e, stackTrace: stack);
      
      // Attempt to navigate to login screen as fallback
      if (mounted) {
        _addLoadingStep('Attempting fallback navigation after error');
        print('Attempting fallback navigation to LoginScreen after error');
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (context) => const LoginScreen()),
        );
      }
    }
  }
  
  // Helper method to get the last logged in username
  Future<String?> _getLastLoggedInUser() async {
    try {
      // In a real app, you would use secure storage to retrieve this
      // For this demo, we'll just return a hardcoded value
      return 'codejunky';
    } catch (e) {
      _addLoadingStep('Error getting last user: $e');
      return null;
    }
  }

  @override
  void dispose() {
    _animationController.dispose();
    _logger.info('SplashScreen disposed');
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.primaryColor,
      body: Center(
        child: AnimatedBuilder(
          animation: _animationController,
          builder: (context, child) {
            return Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Opacity(
                  opacity: _opacityAnimation.value,
                  child: Transform.scale(
                    scale: _scaleAnimation.value,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        // Logo placeholder (replace with actual logo)
                        Container(
                          width: 120,
                          height: 120,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Center(
                            child: Text(
                              'G',
                              style: TextStyle(
                                fontSize: 80,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.primaryColor,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),
                        const Text(
                          'Gaia Space',
                          style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'DevOps Collaboration Platform',
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.white70,
                          ),
                        ),
                        const SizedBox(height: 24),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 40),
                          child: Text(
                            _statusText,
                            style: const TextStyle(
                              fontSize: 14,
                              color: Colors.white70,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ),
                        const SizedBox(height: 16),
                        const CircularProgressIndicator(
                          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                          strokeWidth: 3,
                        ),
                        
                        // Emergency skip button - shows after 8 seconds if still loading
                        if (_secondsElapsed > 8) ...[
                          const SizedBox(height: 24),
                          ElevatedButton(
                            onPressed: () {
                              if (mounted) {
                                _addLoadingStep('Emergency skip button pressed');
                                print('SplashScreen: Emergency skip button pressed, bypassing auto-login');
                                Navigator.of(context).pushReplacement(
                                  MaterialPageRoute(builder: (context) => const LoginScreen()),
                                );
                              }
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.orange,
                              foregroundColor: Colors.white,
                            ),
                            child: const Text('Skip to Login'),
                          ),
                        ],
                        
                        // Debug info visible after a few seconds
                        if (_secondsElapsed > 3) ...[
                          const SizedBox(height: 40),
                          Container(
                            constraints: const BoxConstraints(maxWidth: 500, maxHeight: 200),
                            decoration: BoxDecoration(
                              color: Colors.black54,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            margin: const EdgeInsets.symmetric(horizontal: 20),
                            padding: const EdgeInsets.all(10),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    const Text(
                                      'Loading Status:',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    Text(
                                      'Time: ${_secondsElapsed}s',
                                      style: const TextStyle(
                                        color: Colors.white70,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 5),
                                Expanded(
                                  child: SingleChildScrollView(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: _loadingSteps.map((step) => 
                                        Padding(
                                          padding: const EdgeInsets.only(bottom: 4),
                                          child: Text(
                                            step,
                                            style: const TextStyle(
                                              color: Colors.white70,
                                              fontSize: 12,
                                            ),
                                          ),
                                        )
                                      ).toList(),
                                    ),
                                  ),
                                ),
                                if (_secondsElapsed > 15) ...[
                                  const Divider(color: Colors.white30),
                                  const Text(
                                    'Note: Still loading after 15s. If this persists, try restarting the app.',
                                    style: TextStyle(
                                      color: Colors.orange,
                                      fontSize: 11,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}