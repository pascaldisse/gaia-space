import 'package:flutter_test/flutter_test.dart';
import 'package:gaia_space/core/models/discord_integration.dart';
import 'package:gaia_space/core/services/discord_service.dart';
import 'package:mockito/mockito.dart';

// Create a mock Discord service
class MockDiscordService extends Mock implements DiscordService {
  bool _isAuthenticated = false;

  @override
  Future<bool> isAuthenticated() async {
    return _isAuthenticated;
  }

  @override
  Future<List<Map<String, dynamic>>> fetchUserGuilds() async {
    if (!_isAuthenticated) {
      throw Exception('Not authenticated with Discord');
    }
    
    return [
      {
        'id': 'mock_guild_1',
        'name': 'Mock Server 1',
        'icon': 'https://example.com/icon1.png',
        'permissions': '2147483647',
        'owner': false,
      },
      {
        'id': 'mock_guild_2',
        'name': 'Mock Server 2',
        'icon': null,
        'permissions': '2147483647',
        'owner': true,
      },
    ];
  }

  @override
  Future<List<Map<String, dynamic>>> fetchGuildChannels(String guildId) async {
    if (!_isAuthenticated) {
      throw Exception('Not authenticated with Discord');
    }
    
    if (guildId == 'mock_guild_1') {
      return [
        {
          'id': 'channel1',
          'name': 'general',
          'type': 'text',
          'parent_id': 'category1',
          'position': 0
        },
        {
          'id': 'channel2',
          'name': 'announcements',
          'type': 'text',
          'parent_id': 'category1',
          'position': 1
        },
        {
          'id': 'channel3',
          'name': 'voice-chat',
          'type': 'voice',
          'parent_id': 'category2',
          'position': 0
        },
        {
          'id': 'category1',
          'name': 'Text Channels',
          'type': 'category',
          'parent_id': null,
          'position': 0
        },
        {
          'id': 'category2',
          'name': 'Voice Channels',
          'type': 'category',
          'parent_id': null,
          'position': 1
        },
      ];
    } else {
      return [
        {
          'id': 'channel4',
          'name': 'general',
          'type': 'text',
          'parent_id': null,
          'position': 0
        },
      ];
    }
  }

  @override
  Future<DiscordIntegration> addIntegration({
    required String workspaceId,
    required String guildId,
    required String guildName,
    String? guildIconUrl,
    required List<DiscordChannel> channels,
    required String createdBy,
  }) async {
    if (!_isAuthenticated) {
      throw Exception('Not authenticated with Discord');
    }
    
    return DiscordIntegration(
      id: 'mock_integration_id',
      workspaceId: workspaceId,
      guildId: guildId,
      guildName: guildName,
      guildIconUrl: guildIconUrl,
      channels: channels,
      createdBy: createdBy,
      createdAt: DateTime.now(),
      lastSyncAt: DateTime.now(),
    );
  }
  
  @override
  Future<DiscordIntegration> syncChannels(String integrationId) async {
    if (!_isAuthenticated) {
      throw Exception('Not authenticated with Discord');
    }
    
    return DiscordIntegration(
      id: integrationId,
      workspaceId: 'test_workspace',
      guildId: 'test_guild',
      guildName: 'Test Guild',
      guildIconUrl: null,
      channels: [
        DiscordChannel(id: 'ch1', name: 'general', type: 'text'),
        DiscordChannel(id: 'ch2', name: 'updates', type: 'text', isSelected: true),
      ],
      createdBy: 'test_user',
      createdAt: DateTime(2023, 1, 1),
      lastSyncAt: DateTime.now(),
    );
  }
  
  @override
  Future<void> deleteIntegration(String integrationId) async {
    // Simulate successful deletion
    return;
  }
  
  @override
  String generateAuthUrl({
    String? redirectUri,
    List<String> scopes = const ['identify', 'guilds', 'bot'],
  }) {
    final redirect = redirectUri ?? 'https://gaia-space.app/auth/discord/callback';
    final scopeString = scopes.join('%20');
    
    return 'https://discord.com/api/oauth2/authorize?client_id=123456789012345678&redirect_uri=$redirect&response_type=code&scope=$scopeString';
  }
  
  @override
  Future<bool> launchOAuthFlow({
    String? redirectUri,
    List<String> scopes = const ['identify', 'guilds', 'bot'],
  }) async {
    // Simulate successful launch
    return true;
  }
  
  @override
  Future<Map<String, dynamic>> exchangeCodeForToken(String code, String redirectUri) async {
    if (code.isEmpty) {
      throw Exception('Invalid authorization code');
    }
    
    // Simulate successful authentication
    _isAuthenticated = true;
    
    return {
      'access_token': 'mock_access_token_${DateTime.now().millisecondsSinceEpoch}',
      'refresh_token': 'mock_refresh_token',
      'expires_in': 604800, // 7 days
      'token_type': 'Bearer',
    };
  }
  
  @override
  Future<Map<String, dynamic>> refreshToken(String refreshToken) async {
    if (refreshToken.isEmpty) {
      throw Exception('Invalid refresh token');
    }
    
    // Simulate successful token refresh
    _isAuthenticated = true;
    
    return {
      'access_token': 'mock_refreshed_token_${DateTime.now().millisecondsSinceEpoch}',
      'refresh_token': refreshToken,
      'expires_in': 604800, // 7 days
      'token_type': 'Bearer',
    };
  }
  
  @override
  Future<void> logout() async {
    _isAuthenticated = false;
  }
}

void main() {
  group('Discord Models', () {
    test('DiscordChannel should convert to and from JSON correctly', () {
      // Create a test channel
      final channel = DiscordChannel(
        id: 'test_id',
        name: 'test_channel',
        type: 'text',
        isSelected: true,
        messageCount: 42,
        lastMessageAt: DateTime(2023, 1, 15, 10, 30),
      );

      // Convert to JSON
      final json = channel.toJson();
      
      // Verify JSON structure
      expect(json['id'], equals('test_id'));
      expect(json['name'], equals('test_channel'));
      expect(json['type'], equals('text'));
      expect(json['isSelected'], equals(true));
      expect(json['messageCount'], equals(42));
      expect(json['lastMessageAt'], equals('2023-01-15T10:30:00.000'));

      // Convert back from JSON
      final channelFromJson = DiscordChannel.fromJson(json);

      // Verify equality
      expect(channelFromJson.id, equals(channel.id));
      expect(channelFromJson.name, equals(channel.name));
      expect(channelFromJson.type, equals(channel.type));
      expect(channelFromJson.isSelected, equals(channel.isSelected));
      expect(channelFromJson.messageCount, equals(channel.messageCount));
      expect(channelFromJson.lastMessageAt, equals(channel.lastMessageAt));
    });

    test('DiscordChannel copyWith method should work correctly', () {
      final channel = DiscordChannel(
        id: 'test_id',
        name: 'test_channel',
        type: 'text',
      );
      
      final updatedChannel = channel.copyWith(
        name: 'updated_name',
        messageCount: 10,
        isSelected: true,
      );
      
      expect(updatedChannel.id, equals('test_id')); // Unchanged
      expect(updatedChannel.name, equals('updated_name')); // Changed
      expect(updatedChannel.type, equals('text')); // Unchanged
      expect(updatedChannel.messageCount, equals(10)); // Changed
      expect(updatedChannel.isSelected, equals(true)); // Changed
    });

    test('DiscordIntegration should convert to and from JSON correctly', () {
      // Create test channels
      final channels = [
        DiscordChannel(id: 'ch1', name: 'general', type: 'text'),
        DiscordChannel(id: 'ch2', name: 'voice', type: 'voice'),
      ];

      // Create test integration
      final integration = DiscordIntegration(
        id: 'integration1',
        workspaceId: 'workspace1',
        guildId: 'guild1',
        guildName: 'Test Server',
        guildIconUrl: 'https://example.com/icon.png',
        channels: channels,
        createdBy: 'test_user',
        createdAt: DateTime(2023, 1, 1),
        lastSyncAt: DateTime(2023, 1, 2),
      );

      // Convert to JSON
      final json = integration.toJson();
      
      // Verify JSON structure
      expect(json['id'], equals('integration1'));
      expect(json['workspaceId'], equals('workspace1'));
      expect(json['guildId'], equals('guild1'));
      expect(json['guildName'], equals('Test Server'));
      expect(json['guildIconUrl'], equals('https://example.com/icon.png'));
      expect(json['channels'], isA<List>());
      expect(json['channels'].length, equals(2));
      expect(json['createdBy'], equals('test_user'));
      expect(json['createdAt'], equals('2023-01-01T00:00:00.000'));
      expect(json['lastSyncAt'], equals('2023-01-02T00:00:00.000'));

      // Convert back from JSON
      final integrationFromJson = DiscordIntegration.fromJson(json);

      // Verify equality
      expect(integrationFromJson.id, equals(integration.id));
      expect(integrationFromJson.workspaceId, equals(integration.workspaceId));
      expect(integrationFromJson.guildId, equals(integration.guildId));
      expect(integrationFromJson.guildName, equals(integration.guildName));
      expect(integrationFromJson.guildIconUrl, equals(integration.guildIconUrl));
      expect(integrationFromJson.channels.length, equals(integration.channels.length));
      expect(integrationFromJson.createdBy, equals(integration.createdBy));
      expect(integrationFromJson.createdAt, equals(integration.createdAt));
      expect(integrationFromJson.lastSyncAt, equals(integration.lastSyncAt));
    });
    
    test('DiscordIntegration copyWith method should work correctly', () {
      final channels = [
        DiscordChannel(id: 'ch1', name: 'general', type: 'text'),
      ];
      
      final integration = DiscordIntegration(
        id: 'integration1',
        workspaceId: 'workspace1',
        guildId: 'guild1',
        guildName: 'Test Server',
        channels: channels,
        createdBy: 'test_user',
        createdAt: DateTime(2023, 1, 1),
        lastSyncAt: DateTime(2023, 1, 2),
      );
      
      final updatedChannels = [
        ...channels,
        DiscordChannel(id: 'ch2', name: 'announcements', type: 'text'),
      ];
      
      final updatedIntegration = integration.copyWith(
        guildName: 'Updated Server Name',
        guildIconUrl: 'https://example.com/new_icon.png',
        channels: updatedChannels,
        lastSyncAt: DateTime(2023, 2, 1),
      );
      
      expect(updatedIntegration.id, equals('integration1')); // Unchanged
      expect(updatedIntegration.workspaceId, equals('workspace1')); // Unchanged
      expect(updatedIntegration.guildName, equals('Updated Server Name')); // Changed
      expect(updatedIntegration.guildIconUrl, equals('https://example.com/new_icon.png')); // Changed
      expect(updatedIntegration.channels, equals(updatedChannels)); // Changed
      expect(updatedIntegration.channels.length, equals(2)); // Changed
      expect(updatedIntegration.lastSyncAt, equals(DateTime(2023, 2, 1))); // Changed
    });
  });

  group('Discord Service', () {
    late MockDiscordService mockService;

    setUp(() {
      mockService = MockDiscordService();
    });

    test('Should fetch user guilds', () async {
      final guilds = await mockService.fetchUserGuilds();
      
      expect(guilds, isA<List<Map<String, dynamic>>>());
      expect(guilds.length, equals(2));
      expect(guilds[0]['id'], equals('mock_guild_1'));
      expect(guilds[0]['name'], equals('Mock Server 1'));
      expect(guilds[1]['id'], equals('mock_guild_2'));
    });

    test('Should fetch guild channels', () async {
      final channels = await mockService.fetchGuildChannels('mock_guild_1');
      
      expect(channels, isA<List<Map<String, dynamic>>>());
      expect(channels.length, equals(2));
      expect(channels[0]['id'], equals('channel1'));
      expect(channels[0]['name'], equals('general'));
      expect(channels[0]['type'], equals('text'));
    });

    test('Should add new integration', () async {
      final testChannels = [
        DiscordChannel(id: 'ch1', name: 'general', type: 'text'),
      ];
      
      final integration = await mockService.addIntegration(
        workspaceId: 'test_workspace',
        guildId: 'test_guild',
        guildName: 'Test Guild',
        channels: testChannels,
        createdBy: 'test_user',
      );
      
      expect(integration, isA<DiscordIntegration>());
      expect(integration.id, equals('mock_integration_id'));
      expect(integration.workspaceId, equals('test_workspace'));
      expect(integration.guildId, equals('test_guild'));
      expect(integration.guildName, equals('Test Guild'));
      expect(integration.channels, equals(testChannels));
      expect(integration.createdBy, equals('test_user'));
    });
    
    test('Should sync channels for an integration', () async {
      final syncedIntegration = await mockService.syncChannels('test_integration_id');
      
      expect(syncedIntegration, isA<DiscordIntegration>());
      expect(syncedIntegration.id, equals('test_integration_id'));
      expect(syncedIntegration.lastSyncAt.isAfter(DateTime(2023, 1, 2)), isTrue);
      expect(syncedIntegration.channels.length, equals(2));
    });
    
    test('Should delete an integration', () async {
      // Should not throw an exception
      await mockService.deleteIntegration('test_integration_id');
    });
    
    test('Should generate OAuth URL', () {
      final url = mockService.generateAuthUrl();
      
      expect(url, contains('https://discord.com/api/oauth2/authorize'));
      expect(url, contains('client_id='));
      expect(url, contains('response_type=code'));
      expect(url, contains('scope='));
    });
    
    test('Should exchange code for token', () async {
      final tokenData = await mockService.exchangeCodeForToken('test_code', 'test_redirect');
      
      expect(tokenData, isA<Map<String, dynamic>>());
      expect(tokenData['access_token'], isNotNull);
      expect(tokenData['refresh_token'], isNotNull);
      expect(tokenData['expires_in'], isA<int>());
      expect(tokenData['token_type'], equals('Bearer'));
    });
  });
  
  group('Discord Integration Workflow', () {
    late MockDiscordService mockService;
    
    setUp(() {
      mockService = MockDiscordService();
    });
    
    test('Should handle authentication errors correctly', () async {
      // Before authentication
      expect(await mockService.isAuthenticated(), isFalse);
      
      // Attempting to fetch guilds before authentication should fail
      expect(() => mockService.fetchUserGuilds(), throwsException);
      
      // Invalid auth code should fail
      expect(() => mockService.exchangeCodeForToken('', 'test_redirect'), throwsException);
      
      // Successful authentication
      final tokenData = await mockService.exchangeCodeForToken('valid_code', 'test_redirect');
      expect(tokenData['access_token'], isNotNull);
      expect(await mockService.isAuthenticated(), isTrue);
      
      // Logout
      await mockService.logout();
      expect(await mockService.isAuthenticated(), isFalse);
    });
    
    test('Complete integration workflow with real API simulation', () async {
      // Step 1: Check if already authenticated
      final isAuthenticated = await mockService.isAuthenticated();
      expect(isAuthenticated, isFalse);
      
      // Step 2: Generate auth URL and launch browser
      final authUrl = mockService.generateAuthUrl(
        redirectUri: 'https://gaia-space.app/auth/discord/callback'
      );
      expect(authUrl, isNotEmpty);
      expect(authUrl, contains('redirect_uri='));
      
      final launchSuccess = await mockService.launchOAuthFlow(
        redirectUri: 'https://gaia-space.app/auth/discord/callback'
      );
      expect(launchSuccess, isTrue);
      
      // Step 3: Exchange code for token
      final tokenData = await mockService.exchangeCodeForToken('valid_code', 'https://gaia-space.app/auth/discord/callback');
      expect(tokenData['access_token'], isNotNull);
      expect(tokenData['refresh_token'], isNotNull);
      expect(tokenData['expires_in'], isA<int>());
      
      // Verify authentication state
      expect(await mockService.isAuthenticated(), isTrue);
      
      // Step 4: Fetch available guilds
      final guilds = await mockService.fetchUserGuilds();
      expect(guilds.isNotEmpty, isTrue);
      expect(guilds.length, equals(2));
      final selectedGuild = guilds.first;
      
      // Check guild properties
      expect(selectedGuild['id'], isNotEmpty);
      expect(selectedGuild['name'], isNotEmpty);
      expect(selectedGuild['permissions'], isNotEmpty);
      
      // Step 5: Fetch channels for selected guild
      final channels = await mockService.fetchGuildChannels(selectedGuild['id']);
      expect(channels.isNotEmpty, isTrue);
      
      // Check for categorized channels
      final textChannels = channels.where((ch) => ch['type'] == 'text').toList();
      final voiceChannels = channels.where((ch) => ch['type'] == 'voice').toList();
      final categories = channels.where((ch) => ch['type'] == 'category').toList();
      
      expect(textChannels.isNotEmpty, isTrue);
      expect(categories.isNotEmpty, isTrue);
      expect(textChannels.first['parent_id'], isNotNull);
      
      // Step 6: Select channels to integrate
      final discordChannels = textChannels.map((ch) => 
        DiscordChannel(
          id: ch['id'],
          name: ch['name'],
          type: ch['type'],
          isSelected: true,
        )
      ).toList();
      
      expect(discordChannels.length, equals(textChannels.length));
      
      // Step 7: Create integration
      final integration = await mockService.addIntegration(
        workspaceId: 'workspace_123',
        guildId: selectedGuild['id'],
        guildName: selectedGuild['name'],
        guildIconUrl: selectedGuild['icon'],
        channels: discordChannels,
        createdBy: 'test_user',
      );
      
      expect(integration.workspaceId, equals('workspace_123'));
      expect(integration.guildId, equals(selectedGuild['id']));
      expect(integration.channels.length, equals(discordChannels.length));
      final initialSyncTime = integration.lastSyncAt;
      
      // Step 8: Sync channels later
      final syncedIntegration = await mockService.syncChannels(integration.id);
      expect(syncedIntegration.lastSyncAt.isAfter(initialSyncTime), isTrue);
      
      // Step 9: Logout
      await mockService.logout();
      expect(await mockService.isAuthenticated(), isFalse);
      // After logout, API requests should fail
      expect(() => mockService.fetchUserGuilds(), throwsException);
    });
    
    test('Token refresh flow', () async {
      // Initial authentication
      await mockService.exchangeCodeForToken('valid_code', 'test_redirect');
      expect(await mockService.isAuthenticated(), isTrue);
      
      // Refresh token
      final refreshData = await mockService.refreshToken('mock_refresh_token');
      expect(refreshData['access_token'], isNotNull);
      expect(refreshData['access_token'], contains('mock_refreshed_token_'));
      expect(await mockService.isAuthenticated(), isTrue);
      
      // Invalid refresh token should fail
      expect(() => mockService.refreshToken(''), throwsException);
    });
  });
}