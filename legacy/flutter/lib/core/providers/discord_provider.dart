import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/discord_integration.dart';
import 'package:gaia_space/core/services/discord_service.dart';

// Discord integration notifier
class DiscordIntegrationsNotifier extends StateNotifier<AsyncValue<List<DiscordIntegration>>> {
  final DiscordService _discordService = DiscordService();
  final String workspaceId;

  DiscordIntegrationsNotifier(this.workspaceId) : super(const AsyncValue.loading()) {
    loadIntegrations();
  }

  Future<void> loadIntegrations() async {
    state = const AsyncValue.loading();
    try {
      final integrations = await _discordService.getIntegrationsForWorkspace(workspaceId);
      state = AsyncValue.data(integrations);
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }

  Future<DiscordIntegration> addIntegration({
    required String guildId,
    required String guildName,
    String? guildIconUrl,
    required List<DiscordChannel> channels,
    required String createdBy,
  }) async {
    try {
      // Check if an integration for this guild already exists
      if (state.hasValue) {
        final existingIntegration = state.value!.where((i) => i.guildId == guildId).firstOrNull;
        if (existingIntegration != null) {
          throw Exception('An integration for this Discord server already exists');
        }
      }
      
      final integration = await _discordService.addIntegration(
        workspaceId: workspaceId,
        guildId: guildId,
        guildName: guildName,
        guildIconUrl: guildIconUrl,
        channels: channels,
        createdBy: createdBy,
      );
      
      if (state.hasValue) {
        state = AsyncValue.data([...state.value!, integration]);
      } else {
        await loadIntegrations();
      }
      return integration;
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
      throw e;
    }
  }

  Future<void> updateIntegration(DiscordIntegration integration) async {
    try {
      final updatedIntegration = await _discordService.updateIntegration(integration);
      
      if (state.hasValue) {
        state = AsyncValue.data(
          state.value!.map((item) => item.id == updatedIntegration.id ? updatedIntegration : item).toList(),
        );
      }
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }

  Future<void> deleteIntegration(String integrationId) async {
    try {
      await _discordService.deleteIntegration(integrationId);
      
      if (state.hasValue) {
        state = AsyncValue.data(
          state.value!.where((integration) => integration.id != integrationId).toList(),
        );
      }
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }

  Future<void> syncChannels(String integrationId) async {
    try {
      final updatedIntegration = await _discordService.syncChannels(integrationId);
      
      if (state.hasValue) {
        state = AsyncValue.data(
          state.value!.map((item) => item.id == updatedIntegration.id ? updatedIntegration : item).toList(),
        );
      }
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }
}

// Discord integrations provider
final discordIntegrationsProvider = StateNotifierProvider.family<DiscordIntegrationsNotifier, AsyncValue<List<DiscordIntegration>>, String>(
  (ref, workspaceId) => DiscordIntegrationsNotifier(workspaceId),
);

// Discord guilds provider
final discordGuildsProvider = FutureProvider((ref) {
  final discordService = DiscordService();
  return discordService.fetchUserGuilds();
});

// Discord channels provider
final discordChannelsProvider = FutureProvider.family<List<Map<String, dynamic>>, String>((ref, guildId) {
  final discordService = DiscordService();
  return discordService.fetchGuildChannels(guildId);
});

// Selected guild provider
final selectedGuildProvider = StateProvider<Map<String, dynamic>?>((ref) => null);

// Selected channels provider
final selectedChannelsProvider = StateProvider<List<String>>((ref) => []);