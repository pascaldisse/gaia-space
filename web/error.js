// Custom error handler to prevent _scriptUrls errors
window.addEventListener('error', function(event) {
  if (event.error && event.error.toString().includes('_scriptUrls')) {
    // Prevent the default error handling
    event.preventDefault();
    console.warn('Suppressed _scriptUrls error - continuing app initialization');
    
    // Try to continue app execution
    if (typeof window._flutter_web_main === 'function') {
      try {
        window._flutter_web_main();
      } catch (e) {
        console.error('Error calling _flutter_web_main', e);
      }
    }
    
    return true;
  }
});

// Hide annoying permissions policy warnings
let originalConsoleError = console.error;
console.error = function() {
  if (arguments[0] && typeof arguments[0] === 'string' && 
      arguments[0].includes('Permissions-Policy')) {
    // Suppress Permissions-Policy errors
    return;
  }
  return originalConsoleError.apply(console, arguments);
};