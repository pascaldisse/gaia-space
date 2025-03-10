import 'package:flutter/material.dart';
import 'package:gaia_space/core/models/discord_integration.dart';
import 'package:uuid/uuid.dart';

class DiscordService {
  // Singleton instance
  static final DiscordService _instance = DiscordService._internal();
  factory DiscordService() => _instance;
  DiscordService._internal();

  // Mock integrations for development
  final List<DiscordIntegration> _integrations = [];

  // Get integrations for a workspace
  Future<List<DiscordIntegration>> getIntegrationsForWorkspace(String workspaceId) async {
    // Simulate API call
    await Future.delayed(const Duration(milliseconds: 800));
    return _integrations.where((integration) => integration.workspaceId == workspaceId).toList();
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
    // Simulate API call
    await Future.delayed(const Duration(milliseconds: 800));

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
  }

  // Update an integration
  Future<DiscordIntegration> updateIntegration(DiscordIntegration integration) async {
    // Simulate API call
    await Future.delayed(const Duration(milliseconds: 800));

    final index = _integrations.indexWhere((item) => item.id == integration.id);
    if (index != -1) {
      _integrations[index] = integration.copyWith(lastSyncAt: DateTime.now());
      return _integrations[index];
    }
    throw Exception('Integration not found');
  }

  // Delete an integration
  Future<void> deleteIntegration(String integrationId) async {
    // Simulate API call
    await Future.delayed(const Duration(milliseconds: 800));

    _integrations.removeWhere((integration) => integration.id == integrationId);
  }

  // Sync channels for an integration
  Future<DiscordIntegration> syncChannels(String integrationId) async {
    // Simulate API call to Discord
    await Future.delayed(const Duration(seconds: 1));

    final index = _integrations.indexWhere((item) => item.id == integrationId);
    if (index != -1) {
      // Here we'd actually call Discord API to get updated channels
      // For mock purposes, we'll just update the lastSyncAt
      final updatedIntegration = _integrations[index].copyWith(
        lastSyncAt: DateTime.now(),
      );
      _integrations[index] = updatedIntegration;
      return updatedIntegration;
    }
    throw Exception('Integration not found');
  }

  // Authenticate with Discord
  Future<Map<String, dynamic>> authenticateWithDiscord() async {
    // This would be handled by OAuth flow in a real implementation
    // For now, we'll return mock data
    await Future.delayed(const Duration(seconds: 1));

    return {
      'accessToken': 'mock_discord_token',
      'refreshToken': 'mock_refresh_token',
      'expiresAt': DateTime.now().add(const Duration(days: 7)).toIso8601String(),
    };
  }

  // Fetch guilds (servers) for the authenticated user
  Future<List<Map<String, dynamic>>> fetchUserGuilds() async {
    // In a real implementation, this would call Discord API
    await Future.delayed(const Duration(milliseconds: 800));

    // Mock data for development
    return [
      {
        'id': 'guild1',
        'name': 'Engineering Team',
        'icon': 'https://via.placeholder.com/150/4a90e2/ffffff?text=ET',
      },
      {
        'id': 'guild2',
        'name': 'Product Development',
        'icon': 'https://via.placeholder.com/150/e24a76/ffffff?text=PD',
      },
      {
        'id': 'guild3',
        'name': 'Community Server',
        'icon': null,
      },
    ];
  }

  // Fetch channels for a guild (server)
  Future<List<Map<String, dynamic>>> fetchGuildChannels(String guildId) async {
    // In a real implementation, this would call Discord API
    await Future.delayed(const Duration(milliseconds: 800));

    // Mock channels based on guild ID
    if (guildId == 'guild1') {
      return [
        {
          'id': 'channel1',
          'name': 'general',
          'type': 'text',
        },
        {
          'id': 'channel2',
          'name': 'backend',
          'type': 'text',
        },
        {
          'id': 'channel3',
          'name': 'frontend',
          'type': 'text',
        },
        {
          'id': 'channel4',
          'name': 'voice-chat',
          'type': 'voice',
        },
      ];
    } else if (guildId == 'guild2') {
      return [
        {
          'id': 'channel5',
          'name': 'general',
          'type': 'text',
        },
        {
          'id': 'channel6',
          'name': 'design',
          'type': 'text',
        },
        {
          'id': 'channel7',
          'name': 'roadmap',
          'type': 'text',
        },
      ];
    } else {
      return [
        {
          'id': 'channel8',
          'name': 'general',
          'type': 'text',
        },
        {
          'id': 'channel9',
          'name': 'help',
          'type': 'text',
        },
      ];
    }
  }

  // Generate a Discord OAuth URL for authorization
  String generateAuthUrl() {
    // In a real implementation, this would create a proper Discord OAuth URL
    // with client_id, redirect_uri, scope, etc.
    return 'https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI&response_type=code&scope=identify%20guilds';
  }
}