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
  
  // For demo/development
  static final Uuid _uuid = const Uuid();
  static const bool _useMockAuth = true;
  
  // Getters
  static User? get currentUser => _currentUser;
  static String? get token => _token;
  static bool get isAuthenticated => _currentUser != null && _token != null;
  
  // Initialize auth state from storage
  static Future<void> init() async {
    try {
      // Try to get token from secure storage
      final storedToken = await _secureStorage.read(key: _storageTokenKey);
      
      if (storedToken != null) {
        // Check if token is valid and not expired
        if (_validateToken(storedToken)) {
          _token = storedToken;
          
          // Get stored user data
          final storedUserJson = await _secureStorage.read(key: _storageUserKey);
          if (storedUserJson != null) {
            final userData = jsonDecode(storedUserJson);
            _currentUser = User.fromJson(userData);
            
            AppLogger.i('User authenticated from stored credentials: ${_currentUser!.username}');
          }
        } else {
          // Token is invalid or expired, clear storage
          await _clearAuthData();
          AppLogger.i('Stored token expired or invalid, cleared auth data');
        }
      }
    } catch (e, stackTrace) {
      AppLogger.e('Error initializing auth service', e, stackTrace);
      await _clearAuthData();
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
      AppLogger.e('Login failed', e, stackTrace);
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
      AppLogger.e('Registration failed', e, stackTrace);
      rethrow;
    }
  }
  
  // Logout user
  static Future<void> logout() async {
    try {
      // Clear auth data from storage
      await _clearAuthData();
      AppLogger.i('User logged out');
    } catch (e, stackTrace) {
      AppLogger.e('Error during logout', e, stackTrace);
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
  
  // Store auth data in secure storage
  static Future<void> _storeAuthData(String token, User user) async {
    try {
      await _secureStorage.write(key: _storageTokenKey, value: token);
      await _secureStorage.write(key: _storageUserKey, value: jsonEncode(user.toJson()));
      
      _token = token;
      _currentUser = user;
    } catch (e, stackTrace) {
      AppLogger.e('Error storing auth data', e, stackTrace);
      rethrow;
    }
  }
  
  // Clear auth data from storage
  static Future<void> _clearAuthData() async {
    try {
      await _secureStorage.delete(key: _storageTokenKey);
      await _secureStorage.delete(key: _storageUserKey);
      
      _token = null;
      _currentUser = null;
    } catch (e, stackTrace) {
      AppLogger.e('Error clearing auth data', e, stackTrace);
      rethrow;
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
    
    AppLogger.i('Mock login successful: ${user.username}');
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
    
    AppLogger.i('Mock registration successful: ${user.username}');
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