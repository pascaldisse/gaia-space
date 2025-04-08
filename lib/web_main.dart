import 'dart:html' as html;
import 'dart:js' as js;

/// Setup web debug tools in the browser
void setupWebDebugTools() {
  try {
    // Create a global gaiaSpace object to use in the browser console
    js.context['gaiaSpace'] = js.JsObject.jsify({
      'version': '1.0.0',
      'debugMode': true,
      'log': (String message) {
        print('[Console Debug] $message');
      },
      'testConnection': () {
        print('[Console Debug] Testing connection...');
        return 'Connection test successful!';
      },
      'triggerRender': () {
        print('[Console Debug] Manual render triggered');
        // This is just a placeholder, actual rendering is handled by Flutter
      }
    });
    
    print('Debug tools registered on "gaiaSpace" global object');
    print('You can use gaiaSpace.log("message") in browser console');
  } catch (e) {
    print('Error setting up web debug tools: $e');
  }
}

/// Check if we're running in debug mode
Future<bool> isDebugMode() async {
  try {
    print('[WebMain] Checking debug mode...');
    
    // Check local storage
    bool debugMode = false;
    try {
      final String? debugEnv = html.window.localStorage['GAIA_DEBUG'];
      debugMode = debugEnv == 'true';
      print('[WebMain] Debug from localStorage: $debugMode');
    } catch (e) {
      print('[WebMain] Error accessing localStorage: $e');
      // Continue with checking URL params
    }
    
    // Also check URL parameters
    try {
      final String currentUrl = html.window.location.href;
      print('[WebMain] Current URL: $currentUrl');
      
      if (currentUrl.contains('debug=true')) {
        debugMode = true;
        print('[WebMain] Debug mode enabled via URL parameter');
      }
    } catch (e) {
      print('[WebMain] Error checking URL parameters: $e');
      // Fall through with current debug mode value
    }
    
    print('[WebMain] Final debug mode: $debugMode');
    return debugMode;
  } catch (e) {
    print('[WebMain] Critical error determining debug mode: $e');
    return false;
  }
}

/// Log web-specific platform information
void logWebPlatformInfo() {
  try {
    print('[WebMain] Starting web platform info logging...');
    
    // Log browser information for debugging
    try {
      final String userAgent = html.window.navigator.userAgent;
      print('[WebMain] Browser: $userAgent');
      
      // Check if running in a mobile browser
      final bool isMobileBrowser = userAgent.contains('Mobile') || 
                                  userAgent.contains('Android') || 
                                  userAgent.contains('iPhone');
      print('[WebMain] Mobile browser: $isMobileBrowser');
    } catch (e) {
      print('[WebMain] Error getting browser info: $e');
    }
    
    // Log screen dimensions
    try {
      final int screenWidth = html.window.screen != null ? (html.window.screen!.width ?? 0) : 0;
      final int screenHeight = html.window.screen != null ? (html.window.screen!.height ?? 0) : 0;
      print('[WebMain] Screen dimensions: ${screenWidth}x$screenHeight');
    } catch (e) {
      print('[WebMain] Error getting screen dimensions: $e');
    }
    
    // Check network status
    try {
      final bool isOnline = html.window.navigator.onLine ?? false;
      print('[WebMain] Network status: ${isOnline ? "online" : "offline"}');
      
      // Add event listeners for future network changes
      html.window.addEventListener('online', (event) {
        print('[WebMain] Network connection restored');
      });
      
      html.window.addEventListener('offline', (event) {
        print('[WebMain] Network connection lost');
      });
      
      // Log more detailed connectivity information
      print('[WebMain] Running on: ${html.window.location.hostname}');
      print('[WebMain] Port: ${html.window.location.port}');
      print('[WebMain] Protocol: ${html.window.location.protocol}');
      
      // Always assume connected on localhost
      if (html.window.location.hostname == 'localhost' || 
          html.window.location.hostname == '127.0.0.1' ||
          html.window.location.hostname == '0.0.0.0') {
        print('[WebMain] Running on localhost/development environment - connectivity checks will be relaxed');
      }
    } catch (e) {
      print('[WebMain] Error getting network status: $e');
    }
    
    // Log site URL
    try {
      final String href = html.window.location.href;
      final String hostname = html.window.location.hostname ?? 'unknown';
      final String origin = html.window.location.origin ?? 'unknown';
      final String protocol = html.window.location.protocol ?? 'unknown';
      
      print('[WebMain] Site URL: $href');
      print('[WebMain] Hostname: $hostname');
      print('[WebMain] Origin: $origin');
      print('[WebMain] Protocol: $protocol');
    } catch (e) {
      print('[WebMain] Error getting URL info: $e');
    }
    
    // Log performance metrics
    try {
      print('[WebMain] Getting performance metrics...');
      final dynamic performance = js.context['performance'];
      if (performance != null) {
        final dynamic timing = performance['timing'];
        if (timing != null) {
          final num navigationStart = timing['navigationStart'] ?? 0;
          final num domLoading = timing['domLoading'] ?? 0;
          final num domInteractive = timing['domInteractive'] ?? 0;
          final num domComplete = timing['domComplete'] ?? 0;
          
          print('[WebMain] Performance metrics:');
          print('[WebMain] DOM Loading: ${domLoading - navigationStart}ms');
          print('[WebMain] DOM Interactive: ${domInteractive - navigationStart}ms');
          print('[WebMain] DOM Complete: ${domComplete - navigationStart}ms');
        } else {
          print('[WebMain] Performance timing not available');
        }
      } else {
        print('[WebMain] Performance API not available');
      }
    } catch (e) {
      print('[WebMain] Error getting performance metrics: $e');
    }
    
    // Check browser capabilities
    try {
      print('[WebMain] Checking browser capabilities...');
      
      // Check LocalStorage availability
      bool hasLocalStorage = false;
      try {
        // Actually test localStorage
        html.window.localStorage['test'] = 'test';
        html.window.localStorage.remove('test');
        hasLocalStorage = true;
        print('[WebMain] LocalStorage test succeeded');
      } catch (e) {
        print('[WebMain] LocalStorage test failed: $e');
      }
      print('[WebMain] LocalStorage available: $hasLocalStorage');
      
      // Check WebGL support
      bool hasWebGL = false;
      try {
        final canvas = html.CanvasElement();
        final gl = canvas.getContext3d();
        hasWebGL = gl != null;
        print('[WebMain] WebGL context created successfully');
      } catch (e) {
        print('[WebMain] WebGL test failed: $e');
        // WebGL not supported
      }
      print('[WebMain] WebGL supported: $hasWebGL');
    } catch (e) {
      print('[WebMain] Error checking browser capabilities: $e');
    }
    
    print('[WebMain] Web platform info logging completed');
  } catch (e) {
    print('[WebMain] Error logging web platform info: $e');
  }
}

// Helper function specifically for web debugging
void logWebError(String message, dynamic error) {
  print('[WebErrorLogger] $message');
  print('[WebErrorLogger] Error details: $error');
  
  try {
    // Try to log to console with special formatting
    js.context.callMethod('console.error', ['[GAIA_SPACE]', message, error]);
  } catch (e) {
    // Fallback to regular print
    print('[WebErrorLogger] Failed to use console.error: $e');
  }
}

// Stub for API consistency with native_main
void logNativePlatformInfo() {
  // Not used in web context
}