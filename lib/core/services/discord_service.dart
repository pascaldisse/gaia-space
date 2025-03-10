import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:gaia_space/core/models/discord_integration.dart';
import 'package:gaia_space/core/utils/app_logger.dart';
import 'package:uuid/uuid.dart';
import 'package:url_launcher/url_launcher.dart';

class DiscordService {
  // Singleton instance
  static final DiscordService _instance = DiscordService._internal();
  factory DiscordService() => _instance;
  
  // Discord API endpoints
  static const String _apiBaseUrl = 'https://discord.com/api/v10';
  static const String _tokenUrl = '$_apiBaseUrl/oauth2/token';
  static const String _userGuildsUrl = '$_apiBaseUrl/users/@me/guilds';
  static const String _guildChannelsUrl = '$_apiBaseUrl/guilds';
  
  // Storage keys
  static const String _accessTokenKey = 'discord_access_token';
  static const String _refreshTokenKey = 'discord_refresh_token';
  static const String _tokenExpiryKey = 'discord_token_expiry';
  
  // App credentials from Discord Developer Portal
  // For development, replace these with your actual credentials
  // For production, use the environment variables
  static const String _clientId = String.fromEnvironment(
    'DISCORD_CLIENT_ID',
    defaultValue: 'YOUR_DISCORD_CLIENT_ID',
  );
  
  static const String _clientSecret = String.fromEnvironment(
    'DISCORD_CLIENT_SECRET',
    defaultValue: 'YOUR_DISCORD_CLIENT_SECRET',
  );
  
  final Dio _dio = Dio();
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();
  AppLogger _logger = AppLogger('DiscordService');
  
  // Local storage for integrations until backend is implemented
  final List<DiscordIntegration> _integrations = [];

  DiscordService._internal() {
    _dio.options.validateStatus = (status) {
      return status != null && status < 500;
    };
  }

  // Get integrations for a workspace
  Future<List<DiscordIntegration>> getIntegrationsForWorkspace(String workspaceId) async {
    try {
      // TODO: In a real app, this would call your backend API
      // For now, we'll use the local storage
      return _integrations.where((integration) => integration.workspaceId == workspaceId).toList();
    } catch (e) {
      _logger.error('Error fetching Discord integrations', error: e);
      rethrow;
    }
  }

  // Add a new integration
  Future<DiscordIntegration> addIntegration({
    required String workspaceId,
    required String guildId,
    required String guildName,
    String? guildIconUrl,
    required List<DiscordChannel> channels,
    required String createdBy,
  }) async {
    try {
      // TODO: In a real app, this would call your backend API
      // For now, we'll use the local storage
      final integration = DiscordIntegration(
        id: const Uuid().v4(),
        workspaceId: workspaceId,
        guildId: guildId,
        guildName: guildName,
        guildIconUrl: guildIconUrl,
        channels: channels,
        createdBy: createdBy,
        createdAt: DateTime.now(),
        lastSyncAt: DateTime.now(),
      );

      _integrations.add(integration);
      return integration;
    } catch (e) {
      _logger.error('Error adding Discord integration', error: e);
      rethrow;
    }
  }

  // Update an integration
  Future<DiscordIntegration> updateIntegration(DiscordIntegration integration) async {
    try {
      // TODO: In a real app, this would call your backend API
      // For now, we'll use the local storage
      final index = _integrations.indexWhere((item) => item.id == integration.id);
      if (index != -1) {
        _integrations[index] = integration.copyWith(lastSyncAt: DateTime.now());
        return _integrations[index];
      }
      throw Exception('Integration not found');
    } catch (e) {
      _logger.error('Error updating Discord integration', error: e);
      rethrow;
    }
  }

  // Delete an integration
  Future<void> deleteIntegration(String integrationId) async {
    try {
      // TODO: In a real app, this would call your backend API
      // For now, we'll use the local storage
      _integrations.removeWhere((integration) => integration.id == integrationId);
    } catch (e) {
      _logger.error('Error deleting Discord integration', error: e);
      rethrow;
    }
  }

  // Sync channels for an integration
  Future<DiscordIntegration> syncChannels(String integrationId) async {
    try {
      final index = _integrations.indexWhere((item) => item.id == integrationId);
      if (index != -1) {
        final integration = _integrations[index];
        
        // Fetch fresh channels from Discord API
        final channels = await fetchGuildChannels(integration.guildId);
        
        // Map to our channel model, preserving selected state from existing channels
        final existingChannelMap = {for (var c in integration.channels) c.id: c};
        
        final updatedChannels = channels.map((channelData) {
          final existing = existingChannelMap[channelData['id']];
          return DiscordChannel(
            id: channelData['id'],
            name: channelData['name'],
            type: _mapChannelType(channelData['type']),
            isSelected: existing?.isSelected ?? false,
            messageCount: existing?.messageCount ?? 0,
            lastMessageAt: existing?.lastMessageAt,
          );
        }).toList();
        
        final updatedIntegration = integration.copyWith(
          channels: updatedChannels,
          lastSyncAt: DateTime.now(),
        );
        
        _integrations[index] = updatedIntegration;
        return updatedIntegration;
      }
      throw Exception('Integration not found');
    } catch (e) {
      _logger.error('Error syncing Discord channels', error: e);
      rethrow;
    }
  }

  // Map Discord API channel type to our simplified type
  String _mapChannelType(int typeId) {
    switch (typeId) {
      case 0: return 'text';
      case 2: return 'voice';
      case 4: return 'category';
      case 5: return 'announcement';
      case 13: return 'stage';
      case 15: return 'forum';
      default: return 'text';
    }
  }

  // Generate a Discord OAuth URL for authorization
  String generateAuthUrl({
    String? redirectUri,
    List<String> scopes = const ['identify', 'guilds', 'bot'],
  }) {
    final scopeString = scopes.join('%20');
    final redirect = redirectUri ?? 'https://gaia-space.app/auth/discord/callback';
    final encodedRedirect = Uri.encodeComponent(redirect);
    
    return 'https://discord.com/api/oauth2/authorize'
      '?client_id=$_clientId'
      '&redirect_uri=$encodedRedirect'
      '&response_type=code'
      '&scope=$scopeString';
  }
  
  // Launch the OAuth flow
  Future<bool> launchOAuthFlow({
    String? redirectUri,
    List<String> scopes = const ['identify', 'guilds', 'bot'],
  }) async {
    final authUrl = generateAuthUrl(redirectUri: redirectUri, scopes: scopes);
    
    try {
      final uri = Uri.parse(authUrl);
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      _logger.error('Error launching Discord OAuth URL', error: e);
      return false;
    }
  }
  
  // Exchange authorization code for access token
  Future<Map<String, dynamic>> exchangeCodeForToken(String code, String redirectUri) async {
    try {
      final response = await _dio.post(
        _tokenUrl,
        data: FormData.fromMap({
          'client_id': _clientId,
          'client_secret': _clientSecret,
          'grant_type': 'authorization_code',
          'code': code,
          'redirect_uri': redirectUri,
        }),
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
          validateStatus: (status) => status != null && status < 500,
        ),
      );
      
      if (response.statusCode == 200) {
        final data = response.data;
        
        // Store tokens securely
        await _secureStorage.write(key: _accessTokenKey, value: data['access_token']);
        await _secureStorage.write(key: _refreshTokenKey, value: data['refresh_token']);
        
        // Calculate expiry time
        final expiresIn = data['expires_in'] as int;
        final expiryTime = DateTime.now().add(Duration(seconds: expiresIn));
        await _secureStorage.write(key: _tokenExpiryKey, value: expiryTime.toIso8601String());
        
        return data;
      } else {
        throw Exception('Failed to exchange code: ${response.statusCode} ${response.data}');
      }
    } catch (e) {
      _logger.error('Error exchanging Discord auth code', error: e);
      rethrow;
    }
  }
  
  // Refresh an expired token
  Future<Map<String, dynamic>> refreshToken(String refreshToken) async {
    try {
      final response = await _dio.post(
        _tokenUrl,
        data: FormData.fromMap({
          'client_id': _clientId,
          'client_secret': _clientSecret,
          'grant_type': 'refresh_token',
          'refresh_token': refreshToken,
        }),
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
        ),
      );
      
      if (response.statusCode == 200) {
        final data = response.data;
        
        // Store new tokens securely
        await _secureStorage.write(key: _accessTokenKey, value: data['access_token']);
        if (data['refresh_token'] != null) {
          await _secureStorage.write(key: _refreshTokenKey, value: data['refresh_token']);
        }
        
        // Calculate expiry time
        final expiresIn = data['expires_in'] as int;
        final expiryTime = DateTime.now().add(Duration(seconds: expiresIn));
        await _secureStorage.write(key: _tokenExpiryKey, value: expiryTime.toIso8601String());
        
        return data;
      } else {
        throw Exception('Failed to refresh token: ${response.statusCode} ${response.data}');
      }
    } catch (e) {
      _logger.error('Error refreshing Discord token', error: e);
      rethrow;
    }
  }
  
  // Get the current access token, refreshing if needed
  Future<String> _getAccessToken() async {
    final accessToken = await _secureStorage.read(key: _accessTokenKey);
    final expiryTimeStr = await _secureStorage.read(key: _tokenExpiryKey);
    final refreshToken = await _secureStorage.read(key: _refreshTokenKey);
    
    if (accessToken == null || refreshToken == null) {
      throw Exception('Not authenticated with Discord');
    }
    
    // Check if token is expired
    if (expiryTimeStr != null) {
      final expiryTime = DateTime.parse(expiryTimeStr);
      final now = DateTime.now();
      
      // Refresh if token expires in less than 5 minutes
      if (expiryTime.difference(now).inMinutes < 5) {
        final refreshResult = await refreshToken(refreshToken);
        return refreshResult['access_token'];
      }
    }
    
    return accessToken;
  }
  
  // Fetch guilds (servers) for the authenticated user
  Future<List<Map<String, dynamic>>> fetchUserGuilds() async {
    try {
      final accessToken = await _getAccessToken();
      
      final response = await _dio.get(
        _userGuildsUrl,
        options: Options(
          headers: {
            'Authorization': 'Bearer $accessToken',
          },
        ),
      );
      
      if (response.statusCode == 200) {
        final guilds = response.data as List;
        
        // Transform the response to match our expected format
        return guilds.map((guild) {
          String? iconUrl;
          if (guild['icon'] != null) {
            final format = guild['icon'].startsWith('a_') ? 'gif' : 'png';
            iconUrl = 'https://cdn.discordapp.com/icons/${guild['id']}/${guild['icon']}.$format';
          }
          
          return {
            'id': guild['id'],
            'name': guild['name'],
            'icon': iconUrl,
            'permissions': guild['permissions'],
            'owner': guild['owner'] ?? false,
          };
        }).toList();
      } else {
        throw Exception('Failed to fetch guilds: ${response.statusCode} ${response.data}');
      }
    } catch (e) {
      _logger.error('Error fetching Discord guilds', error: e);
      
      // If this is an authentication error, try to clear tokens
      if (e.toString().contains('401')) {
        await _clearTokens();
      }
      
      rethrow;
    }
  }

  // Fetch channels for a guild (server)
  Future<List<Map<String, dynamic>>> fetchGuildChannels(String guildId) async {
    try {
      final accessToken = await _getAccessToken();
      
      final response = await _dio.get(
        '$_guildChannelsUrl/$guildId/channels',
        options: Options(
          headers: {
            'Authorization': 'Bearer $accessToken',
          },
        ),
      );
      
      if (response.statusCode == 200) {
        final channels = response.data as List;
        
        // Transform the response to match our expected format
        // Only include text and voice channels (not categories)
        return channels
            .where((channel) => 
                channel['type'] == 0 || // text
                channel['type'] == 2 || // voice
                channel['type'] == 5 || // announcement
                channel['type'] == 13)  // stage
            .map((channel) {
          return {
            'id': channel['id'],
            'name': channel['name'],
            'type': _mapChannelType(channel['type']),
            'parent_id': channel['parent_id'],
            'position': channel['position'],
          };
        }).toList();
      } else {
        throw Exception('Failed to fetch channels: ${response.statusCode} ${response.data}');
      }
    } catch (e) {
      _logger.error('Error fetching Discord channels', error: e);
      
      // If this is an authentication error, try to clear tokens
      if (e.toString().contains('401')) {
        await _clearTokens();
      }
      
      rethrow;
    }
  }
  
  // Clear stored tokens
  Future<void> _clearTokens() async {
    try {
      await _secureStorage.delete(key: _accessTokenKey);
      await _secureStorage.delete(key: _refreshTokenKey);
      await _secureStorage.delete(key: _tokenExpiryKey);
    } catch (e) {
      _logger.error('Error clearing Discord tokens', error: e);
    }
  }
  
  // Check if user is authenticated with Discord
  Future<bool> isAuthenticated() async {
    try {
      final accessToken = await _secureStorage.read(key: _accessTokenKey);
      final refreshToken = await _secureStorage.read(key: _refreshTokenKey);
      
      return accessToken != null && refreshToken != null;
    } catch (e) {
      return false;
    }
  }
  
  // Logout from Discord
  Future<void> logout() async {
    await _clearTokens();
  }
}