import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:jwt_decoder/jwt_decoder.dart';
import 'package:uuid/uuid.dart';
import 'package:gaia_space/core/models/user.dart';
import 'package:gaia_space/core/utils/app_logger.dart';

class AuthService {
  static const String _storageTokenKey = 'auth_token';
  static const String _storageUserKey = 'auth_user';
  
  static final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();
  static User? _currentUser;
  static String? _token;
  static final AppLogger _logger = AppLogger('AuthService');
  
  // For demo/development
  static final Uuid _uuid = const Uuid();
  static const bool _useMockAuth = true;
  
  // Getters
  static User? get currentUser => _currentUser;
  static String? get token => _token;
  static bool get isAuthenticated => _currentUser != null && _token != null;
  
  // Initialize auth state from storage
  static Future<void> init() async {
    _logger.info('Initializing AuthService');
    print('AuthService: Initializing...');
    
    try {
      // Try to get token from secure storage with a timeout
      print('AuthService: Checking for stored token...');
      
      // Use a timeout to prevent hanging if the storage API is slow
      final storedToken = await _getStorageValueWithTimeout(
        key: _storageTokenKey, 
        timeoutDuration: const Duration(seconds: 3),
      );
      
      if (storedToken != null) {
        print('AuthService: Found stored token, validating...');
        _logger.debug('Found stored authentication token, validating');
        
        // Check if token is valid and not expired
        if (_validateToken(storedToken)) {
          print('AuthService: Token is valid');
          _logger.info('Stored token is valid');
          _token = storedToken;
          
          // Get stored user data with a timeout
          print('AuthService: Retrieving user data...');
          final storedUserJson = await _getStorageValueWithTimeout(
            key: _storageUserKey,
            timeoutDuration: const Duration(seconds: 2),
          );
          
          if (storedUserJson != null) {
            print('AuthService: Found user data, parsing...');
            try {
              final userData = jsonDecode(storedUserJson);
              _currentUser = User.fromJson(userData);
              
              print('AuthService: User authenticated: ${_currentUser!.username}');
              _logger.info('User authenticated from stored credentials: ${_currentUser!.username}');
            } catch (parseError) {
              print('AuthService: Error parsing user data: $parseError');
              _logger.error('Error parsing stored user data', error: parseError);
              await _safelyClearAuthData();
            }
          } else {
            print('AuthService: No user data found with valid token');
            _logger.warning('Found valid token but no matching user data');
            await _safelyClearAuthData();
          }
        } else {
          // Token is invalid or expired, clear storage
          print('AuthService: Token is invalid or expired, clearing data');
          await _safelyClearAuthData();
          _logger.info('Stored token expired or invalid, cleared auth data');
        }
      } else {
        print('AuthService: No stored token found');
        _logger.info('No stored authentication data found');
      }
      
      print('AuthService: Initialization complete');
      _logger.info('AuthService initialization complete, authentication status: ${isAuthenticated ? 'Authenticated' : 'Not authenticated'}');
    } catch (e, stackTrace) {
      print('AuthService ERROR: $e');
      _logger.error('Error initializing auth service', error: e, stackTrace: stackTrace);
      
      // Clear auth data as safety measure
      _safelyClearAuthData();
    }
  }
  
  // Get a value from secure storage with a timeout to avoid hanging
  static Future<String?> _getStorageValueWithTimeout({
    required String key, 
    Duration timeoutDuration = const Duration(seconds: 5),
  }) async {
    try {
      // Return null immediately in web platform to avoid potential hangs
      if (kIsWeb) {
        print('AuthService: Web platform detected, using mock storage');
        // Return mock data for development to avoid issues
        if (key == _storageTokenKey) {
          return null; // Return null to force a login
        }
        return null;
      }
      
      // Use a timeout to prevent hanging
      return await _secureStorage.read(key: key)
        .timeout(timeoutDuration, onTimeout: () {
          print('AuthService: Timeout reading from secure storage: $key');
          _logger.warning('Timeout reading from secure storage: $key');
          return null;
        });
    } catch (e) {
      print('AuthService: Error reading from secure storage: $e');
      _logger.error('Error reading from secure storage', error: e);
      return null;
    }
  }
  
  // Login with username and password
  static Future<User?> login(String username, String password) async {
    try {
      if (_useMockAuth) {
        // For demo purposes, mock authentication
        return _mockLogin(username, password);
      }
      
      // TODO: Implement real API authentication
      // final response = await _apiClient.login(username, password);
      // final token = response.token;
      // final user = User.fromJson(response.user);
      
      // Placeholder for real implementation
      throw UnimplementedError('Real API authentication not implemented yet');
    } catch (e, stackTrace) {
      _logger.error('Login failed', error: e);
      rethrow;
    }
  }
  
  // Register new user
  static Future<User?> register(String username, String email, String password) async {
    try {
      if (_useMockAuth) {
        // For demo purposes, mock registration
        return _mockRegister(username, email, password);
      }
      
      // TODO: Implement real API registration
      throw UnimplementedError('Real API registration not implemented yet');
    } catch (e, stackTrace) {
      _logger.error('Registration failed', error: e);
      rethrow;
    }
  }
  
  // Logout user
  static Future<void> logout() async {
    try {
      // Clear auth data from storage
      await _safelyClearAuthData();
      _logger.info('User logged out');
    } catch (e, stackTrace) {
      _logger.error('Error during logout', error: e);
      rethrow;
    }
  }
  
  // Check if token is valid
  static bool _validateToken(String token) {
    try {
      // Check if token is expired
      final isExpired = JwtDecoder.isExpired(token);
      if (isExpired) {
        return false;
      }
      
      // Additional validation can be added here
      return true;
    } catch (e) {
      // Token format is invalid
      return false;
    }
  }
  
  // Safely store auth data with web platform check
  static Future<void> _storeAuthData(String token, User user) async {
    try {
      // Skip storage in web platform
      if (kIsWeb) {
        print('AuthService: Web platform detected, skipping secure storage');
        _logger.info('Web platform detected, using in-memory storage only');
        // Just set in-memory values
        _token = token;
        _currentUser = user;
        return;
      }
      
      await _secureStorage.write(key: _storageTokenKey, value: token);
      await _secureStorage.write(key: _storageUserKey, value: jsonEncode(user.toJson()));
      
      _token = token;
      _currentUser = user;
    } catch (e, stackTrace) {
      print('AuthService: Error storing auth data: $e');
      _logger.error('Error storing auth data', error: e, stackTrace: stackTrace);
      
      // Set in-memory values anyway
      _token = token;
      _currentUser = user;
    }
  }
  
  // Clear auth data from storage
  static Future<void> _clearAuthData() async {
    try {
      // Skip secure storage operations in web platform
      if (!kIsWeb) {
        await _secureStorage.delete(key: _storageTokenKey);
        await _secureStorage.delete(key: _storageUserKey);
      } else {
        print('AuthService: Web platform detected, skipping secure storage deletion');
      }
      
      // Always clear memory values
      _token = null;
      _currentUser = null;
    } catch (e, stackTrace) {
      _logger.error('Error clearing auth data', error: e, stackTrace: stackTrace);
      
      // Make sure in-memory values are cleared even if storage operations fail
      _token = null;
      _currentUser = null;
      
      // Don't rethrow - we want to continue the app flow
      print('AuthService: Cleared in-memory auth data despite storage error');
    }
  }
  
  // Safely clear auth data with error handling
  static Future<void> _safelyClearAuthData() async {
    try {
      await _clearAuthData();
      print('AuthService: Cleared auth data');
    } catch (clearError) {
      print('AuthService: Error clearing auth data: $clearError');
      _logger.error('Error clearing auth data', error: clearError);
      
      // Set local variables to null even if storage clear fails
      _token = null;
      _currentUser = null;
    }
  }
  
  // Mock login for demo/development
  static Future<User?> _mockLogin(String username, String password) async {
    // Simple validation
    if (username.isEmpty || password.isEmpty) {
      throw Exception('Username and password cannot be empty');
    }
    
    // Create mock user and token
    final user = User(
      id: _uuid.v4(),
      username: username,
      email: '$username@example.com',
      displayName: username.capitalizeFirst(),
      createdAt: DateTime.now(),
    );
    
    // Create mock JWT token
    final payload = {
      'sub': user.id,
      'username': user.username,
      'email': user.email,
      'iat': DateTime.now().millisecondsSinceEpoch ~/ 1000,
      'exp': DateTime.now().add(const Duration(days: 7)).millisecondsSinceEpoch ~/ 1000,
    };
    
    final header = {
      'alg': 'HS256',
      'typ': 'JWT',
    };
    
    final encodedHeader = base64Url.encode(utf8.encode(jsonEncode(header)));
    final encodedPayload = base64Url.encode(utf8.encode(jsonEncode(payload)));
    final mockToken = '$encodedHeader.$encodedPayload.mock_signature';
    
    // Store auth data
    await _storeAuthData(mockToken, user);
    
    _logger.info('Mock login successful: ${user.username}');
    return user;
  }
  
  // Mock register for demo/development
  static Future<User?> _mockRegister(String username, String email, String password) async {
    // Simple validation
    if (username.isEmpty || email.isEmpty || password.isEmpty) {
      throw Exception('Username, email, and password are required');
    }
    
    if (!email.contains('@')) {
      throw Exception('Invalid email format');
    }
    
    // Create mock user and token (similar to login)
    final user = User(
      id: _uuid.v4(),
      username: username,
      email: email,
      displayName: username.capitalizeFirst(),
      createdAt: DateTime.now(),
    );
    
    // Create mock JWT token (similar to login)
    final payload = {
      'sub': user.id,
      'username': user.username,
      'email': user.email,
      'iat': DateTime.now().millisecondsSinceEpoch ~/ 1000,
      'exp': DateTime.now().add(const Duration(days: 7)).millisecondsSinceEpoch ~/ 1000,
    };
    
    final header = {
      'alg': 'HS256',
      'typ': 'JWT',
    };
    
    final encodedHeader = base64Url.encode(utf8.encode(jsonEncode(header)));
    final encodedPayload = base64Url.encode(utf8.encode(jsonEncode(payload)));
    final mockToken = '$encodedHeader.$encodedPayload.mock_signature';
    
    // Store auth data
    await _storeAuthData(mockToken, user);
    
    _logger.info('Mock registration successful: ${user.username}');
    return user;
  }
}

// Extension to capitalize first letter of a string
extension StringExtension on String {
  String capitalizeFirst() {
    if (isEmpty) return this;
    return this[0].toUpperCase() + substring(1);
  }
}