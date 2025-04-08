// Minimal flutter.js implementation
if (!window._flutter) {
  window._flutter = {};
}
window._flutter.loader = {
  loadEntrypoint: function(options) {
    console.log("Flutter loader loadEntrypoint called");
    const scriptTag = document.createElement('script');
    scriptTag.src = 'main.dart.js';
    scriptTag.type = 'application/javascript';
    document.body.appendChild(scriptTag);
    
    scriptTag.addEventListener('load', function() {
      console.log("main.dart.js loaded");
      if (typeof window.initializeApp === 'function') {
        window.initializeApp();
      }
      if (options && options.onEntrypointLoaded) {
        options.onEntrypointLoaded({
          initializeEngine: function() {
            console.log("Flutter engine initialization stub called");
            return Promise.resolve({
              runApp: function() {
                console.log("Flutter runApp stub called");
                // This is a stub - the real functionality will be in main.dart.js
                if (typeof window._flutter_web_main === 'function') {
                  window._flutter_web_main();
                }
              }
            });
          }
        });
      }
    });
    
    // Handle script loading error
    scriptTag.addEventListener('error', function(error) {
      console.error("Error loading main.dart.js:", error);
      if (options && options.onEntrypointLoaded) {
        options.onEntrypointLoaded({
          initializeEngine: function() {
            return Promise.reject(new Error("Failed to load Flutter application"));
          }
        });
      }
    });
  }
};

// For convenience - provide error logs
console.log("flutter.js loaded - simple implementation");