import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/models/discord_integration.dart';
import 'package:gaia_space/core/providers/discord_provider.dart';
import 'package:gaia_space/core/services/auth_service.dart';
import 'package:gaia_space/core/services/discord_service.dart';
import 'package:gaia_space/ui/widgets/empty_state.dart';
import 'package:gaia_space/ui/widgets/loading_overlay.dart';

class DiscordIntegrationScreen extends ConsumerStatefulWidget {
  final String workspaceId;
  final String workspaceName;
  final VoidCallback onBack;

  const DiscordIntegrationScreen({
    super.key,
    required this.workspaceId,
    required this.workspaceName,
    required this.onBack,
  });

  @override
  ConsumerState<DiscordIntegrationScreen> createState() => _DiscordIntegrationScreenState();
}

class _DiscordIntegrationScreenState extends ConsumerState<DiscordIntegrationScreen> {
  final DiscordService _discordService = DiscordService();
  bool _isAddingIntegration = false;

  @override
  Widget build(BuildContext context) {
    final integrationsAsync = ref.watch(discordIntegrationsProvider(widget.workspaceId));

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: widget.onBack,
        ),
        title: const Text('Discord Integration'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.read(discordIntegrationsProvider(widget.workspaceId).notifier).loadIntegrations();
            },
            tooltip: 'Refresh Integrations',
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildHeader(context),
          Expanded(
            child: integrationsAsync.when(
              data: (integrations) {
                if (integrations.isEmpty) {
                  return EmptyState(
                    icon: Icons.discord,
                    title: 'No Discord Integrations',
                    message: 'Connect your workspace to Discord servers to sync channels and messages.',
                    actionText: 'Connect Discord Server',
                    onActionPressed: _startAddIntegration,
                  );
                }
                return _buildIntegrationsList(context, integrations);
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, stack) => Center(
                child: Text('Error loading integrations: $error'),
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: integrationsAsync.maybeWhen(
        data: (integrations) => integrations.isNotEmpty
            ? FloatingActionButton(
                onPressed: _startAddIntegration,
                tooltip: 'Add Discord Integration',
                child: const Icon(Icons.add),
              )
            : null,
        orElse: () => null,
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      width: double.infinity,
      color: Theme.of(context).cardColor,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Connect "${widget.workspaceName}" to Discord',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            'Integrate Discord servers with your workspace to sync channels, messages, and member activity.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }

  Widget _buildIntegrationsList(BuildContext context, List<DiscordIntegration> integrations) {
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: integrations.length,
      separatorBuilder: (_, __) => const SizedBox(height: 16),
      itemBuilder: (context, index) {
        final integration = integrations[index];
        return DiscordIntegrationCard(
          integration: integration,
          onSync: () {
            ref.read(discordIntegrationsProvider(widget.workspaceId).notifier)
                .syncChannels(integration.id);
          },
          onEdit: () => _showEditIntegrationDialog(integration),
          onDelete: () => _showDeleteIntegrationDialog(integration),
        );
      },
    );
  }

  void _startAddIntegration() async {
    setState(() {
      _isAddingIntegration = true;
    });

    try {
      // In a real app, this would redirect to Discord OAuth flow
      // For demo purposes, we'll just show a dialog to select a server
      await _showAddIntegrationDialog();
    } finally {
      setState(() {
        _isAddingIntegration = false;
      });
    }
  }

  Future<void> _showAddIntegrationDialog() async {
    await showDialog<void>(
      context: context,
      builder: (context) => AddDiscordIntegrationDialog(
        workspaceId: widget.workspaceId,
      ),
    );
  }

  Future<void> _showEditIntegrationDialog(DiscordIntegration integration) async {
    // Not implemented for this example
    // Would allow editing which channels to sync
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Editing integration is not implemented in this demo'),
      ),
    );
  }

  Future<void> _showDeleteIntegrationDialog(DiscordIntegration integration) async {
    return showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Integration'),
        content: Text(
          'Are you sure you want to delete the Discord integration with "${integration.guildName}"? '
          'This will remove any synced channels from your workspace.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            onPressed: () {
              ref.read(discordIntegrationsProvider(widget.workspaceId).notifier)
                  .deleteIntegration(integration.id);
              Navigator.of(context).pop();
            },
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}

class DiscordIntegrationCard extends StatelessWidget {
  final DiscordIntegration integration;
  final VoidCallback onSync;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const DiscordIntegrationCard({
    super.key,
    required this.integration,
    required this.onSync,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Server info
            Row(
              children: [
                _buildServerIcon(),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        integration.guildName,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        '${integration.channels.length} channels • Last synced: ${_formatDate(integration.lastSyncAt)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert),
                  onSelected: (value) {
                    if (value == 'sync') {
                      onSync();
                    } else if (value == 'edit') {
                      onEdit();
                    } else if (value == 'delete') {
                      onDelete();
                    }
                  },
                  itemBuilder: (context) => [
                    const PopupMenuItem(
                      value: 'sync',
                      child: Row(
                        children: [
                          Icon(Icons.sync, size: 18),
                          SizedBox(width: 8),
                          Text('Sync Channels'),
                        ],
                      ),
                    ),
                    const PopupMenuItem(
                      value: 'edit',
                      child: Row(
                        children: [
                          Icon(Icons.edit, size: 18),
                          SizedBox(width: 8),
                          Text('Edit Settings'),
                        ],
                      ),
                    ),
                    const PopupMenuItem(
                      value: 'delete',
                      child: Row(
                        children: [
                          Icon(Icons.delete, size: 18, color: Colors.red),
                          SizedBox(width: 8),
                          Text('Delete Integration', style: TextStyle(color: Colors.red)),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),
            
            // Channels list
            const Text(
              'Connected Channels',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 8),
            if (integration.channels.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text('No channels connected'),
              )
            else
              _buildChannelsList(context),
          ],
        ),
      ),
    );
  }

  Widget _buildServerIcon() {
    if (integration.guildIconUrl != null) {
      return CircleAvatar(
        radius: 24,
        backgroundImage: NetworkImage(integration.guildIconUrl!),
        backgroundColor: Colors.grey.shade200,
      );
    }
    
    // Generate a color based on name
    final colorValue = integration.guildName.hashCode % Colors.primaries.length;
    final color = Colors.primaries[colorValue];
    
    return CircleAvatar(
      radius: 24,
      backgroundColor: color,
      child: Text(
        integration.guildName[0].toUpperCase(),
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.bold,
          fontSize: 20,
        ),
      ),
    );
  }

  Widget _buildChannelsList(BuildContext context) {
    // Only show up to 5 channels and add a "See all" option if there are more
    final displayedChannels = integration.channels.length > 5
        ? integration.channels.sublist(0, 5)
        : integration.channels;
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ...displayedChannels.map((channel) => _buildChannelItem(context, channel)),
        if (integration.channels.length > 5)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: TextButton(
              onPressed: () {
                // Show all channels dialog
              },
              child: Text(
                'See all ${integration.channels.length} channels',
                style: TextStyle(
                  color: Theme.of(context).primaryColor,
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildChannelItem(BuildContext context, DiscordChannel channel) {
    IconData channelIcon;
    switch (channel.type) {
      case 'text':
        channelIcon = Icons.tag;
        break;
      case 'voice':
        channelIcon = Icons.headset;
        break;
      default:
        channelIcon = Icons.chat;
    }
    
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(channelIcon, size: 16, color: Colors.grey),
          const SizedBox(width: 8),
          Text(
            channel.name,
            style: const TextStyle(fontSize: 14),
          ),
          if (channel.messageCount > 0) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Theme.of(context).primaryColor.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '${channel.messageCount}',
                style: TextStyle(
                  fontSize: 12,
                  color: Theme.of(context).primaryColor,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final difference = now.difference(date);
    
    if (difference.inDays > 365) {
      return '${(difference.inDays / 365).floor()} years ago';
    } else if (difference.inDays > 30) {
      return '${(difference.inDays / 30).floor()} months ago';
    } else if (difference.inDays > 0) {
      return '${difference.inDays} days ago';
    } else if (difference.inHours > 0) {
      return '${difference.inHours} hours ago';
    } else if (difference.inMinutes > 0) {
      return '${difference.inMinutes} minutes ago';
    } else {
      return 'Just now';
    }
  }
}

class AddDiscordIntegrationDialog extends ConsumerStatefulWidget {
  final String workspaceId;

  const AddDiscordIntegrationDialog({
    super.key,
    required this.workspaceId,
  });

  @override
  ConsumerState<AddDiscordIntegrationDialog> createState() => _AddDiscordIntegrationDialogState();
}

class _AddDiscordIntegrationDialogState extends ConsumerState<AddDiscordIntegrationDialog> {
  bool _isLoading = false;
  bool _isConnectingToDiscord = false;
  int _currentStep = 0;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add Discord Integration'),
      content: SizedBox(
        width: 500,
        child: _isLoading
            ? const Center(
                child: Padding(
                  padding: EdgeInsets.all(16.0),
                  child: CircularProgressIndicator(),
                ),
              )
            : _isConnectingToDiscord
                ? _buildConnectToDiscord()
                : _buildStepperContent(),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        _currentStep == 2
            ? ElevatedButton(
                onPressed: _finishIntegration,
                child: const Text('Finish'),
              )
            : ElevatedButton(
                onPressed: _currentStep < 2 ? _nextStep : null,
                child: Text(_currentStep == 0 ? 'Connect' : 'Next'),
              ),
      ],
    );
  }

  Widget _buildStepperContent() {
    return Stepper(
      currentStep: _currentStep,
      controlsBuilder: (context, details) => const SizedBox.shrink(),
      onStepTapped: (step) {
        if (step < _currentStep) {
          setState(() {
            _currentStep = step;
          });
        }
      },
      steps: [
        Step(
          title: const Text('Connect to Discord'),
          content: _buildConnectStep(),
          isActive: _currentStep >= 0,
          state: _currentStep > 0 ? StepState.complete : StepState.indexed,
        ),
        Step(
          title: const Text('Select Server'),
          content: _buildSelectServerStep(),
          isActive: _currentStep >= 1,
          state: _currentStep > 1 ? StepState.complete : StepState.indexed,
        ),
        Step(
          title: const Text('Select Channels'),
          content: _buildSelectChannelsStep(),
          isActive: _currentStep >= 2,
          state: _currentStep > 2 ? StepState.complete : StepState.indexed,
        ),
      ],
    );
  }

  Widget _buildConnectStep() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Connect to your Discord account to access your servers. '
            'This integration will allow syncing channels and messages between your workspace and Discord.',
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            icon: const Icon(Icons.login),
            label: const Text('Connect Discord Account'),
            onPressed: () {
              setState(() {
                _isConnectingToDiscord = true;
              });
              
              // Simulate OAuth flow
              Future.delayed(const Duration(seconds: 2), () {
                setState(() {
                  _isConnectingToDiscord = false;
                  _currentStep = 1;
                });
              });
            },
          ),
        ],
      ),
    );
  }

  Widget _buildConnectToDiscord() {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          const Text('Connecting to Discord...'),
          const SizedBox(height: 8),
          const Text(
            'You will be redirected to authorize this application',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ],
      ),
    );
  }

  Widget _buildSelectServerStep() {
    return Consumer(
      builder: (context, ref, child) {
        final guildsAsync = ref.watch(discordGuildsProvider);
        final selectedGuild = ref.watch(selectedGuildProvider);
        
        return guildsAsync.when(
          data: (guilds) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Select a Discord server to integrate with this workspace:'),
                const SizedBox(height: 16),
                ...guilds.map((guild) => _buildServerOption(guild, selectedGuild)),
              ],
            );
          },
          loading: () => const Center(
            child: Padding(
              padding: EdgeInsets.all(16.0),
              child: CircularProgressIndicator(),
            ),
          ),
          error: (error, stack) => Center(
            child: Text('Error loading servers: $error'),
          ),
        );
      },
    );
  }

  Widget _buildServerOption(Map<String, dynamic> guild, Map<String, dynamic>? selectedGuild) {
    final isSelected = selectedGuild != null && selectedGuild['id'] == guild['id'];
    
    return ListTile(
      leading: guild['icon'] != null
          ? CircleAvatar(
              backgroundImage: NetworkImage(guild['icon']),
              backgroundColor: Colors.grey.shade200,
            )
          : CircleAvatar(
              backgroundColor: Colors.primaries[guild['name'].hashCode % Colors.primaries.length],
              child: Text(
                guild['name'][0].toUpperCase(),
                style: const TextStyle(color: Colors.white),
              ),
            ),
      title: Text(guild['name']),
      trailing: isSelected ? const Icon(Icons.check_circle, color: Colors.green) : null,
      selected: isSelected,
      onTap: () {
        ref.read(selectedGuildProvider.notifier).state = guild;
      },
    );
  }

  Widget _buildSelectChannelsStep() {
    return Consumer(
      builder: (context, ref, child) {
        final selectedGuild = ref.watch(selectedGuildProvider);
        
        if (selectedGuild == null) {
          return const Text('Please select a server first');
        }
        
        final channelsAsync = ref.watch(discordChannelsProvider(selectedGuild['id']));
        final selectedChannels = ref.watch(selectedChannelsProvider);
        
        return channelsAsync.when(
          data: (channels) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Select channels from "${selectedGuild['name']}" to sync:'),
                const SizedBox(height: 8),
                Row(
                  children: [
                    TextButton(
                      onPressed: () {
                        ref.read(selectedChannelsProvider.notifier).state =
                            channels.map((channel) => channel['id'] as String).toList();
                      },
                      child: const Text('Select All'),
                    ),
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: () {
                        ref.read(selectedChannelsProvider.notifier).state = [];
                      },
                      child: const Text('Deselect All'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ...channels.map((channel) {
                  final isSelected = selectedChannels.contains(channel['id']);
                  IconData channelIcon;
                  switch (channel['type']) {
                    case 'text':
                      channelIcon = Icons.tag;
                      break;
                    case 'voice':
                      channelIcon = Icons.headset;
                      break;
                    default:
                      channelIcon = Icons.chat;
                  }
                  
                  return CheckboxListTile(
                    value: isSelected,
                    onChanged: (value) {
                      if (value == true) {
                        ref.read(selectedChannelsProvider.notifier).state = [
                          ...selectedChannels,
                          channel['id'],
                        ];
                      } else {
                        ref.read(selectedChannelsProvider.notifier).state = selectedChannels
                            .where((id) => id != channel['id'])
                            .toList();
                      }
                    },
                    title: Row(
                      children: [
                        Icon(channelIcon, size: 16),
                        const SizedBox(width: 8),
                        Text(channel['name']),
                      ],
                    ),
                    subtitle: channel['type'] == 'voice'
                        ? const Text('Voice channel')
                        : null,
                    controlAffinity: ListTileControlAffinity.leading,
                    dense: true,
                  );
                }).toList(),
              ],
            );
          },
          loading: () => const Center(
            child: Padding(
              padding: EdgeInsets.all(16.0),
              child: CircularProgressIndicator(),
            ),
          ),
          error: (error, stack) => Center(
            child: Text('Error loading channels: $error'),
          ),
        );
      },
    );
  }

  void _nextStep() {
    if (_currentStep == 0) {
      setState(() {
        _isConnectingToDiscord = true;
      });
      
      // Simulate OAuth flow
      Future.delayed(const Duration(seconds: 2), () {
        setState(() {
          _isConnectingToDiscord = false;
          _currentStep = 1;
        });
      });
    } else if (_currentStep == 1) {
      final selectedGuild = ref.read(selectedGuildProvider);
      if (selectedGuild == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please select a server')),
        );
        return;
      }
      setState(() {
        _currentStep = 2;
      });
    }
  }

  Future<void> _finishIntegration() async {
    final selectedGuild = ref.read(selectedGuildProvider);
    final selectedChannelIds = ref.read(selectedChannelsProvider);
    
    if (selectedGuild == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a server')),
      );
      return;
    }
    
    if (selectedChannelIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select at least one channel')),
      );
      return;
    }
    
    setState(() {
      _isLoading = true;
    });
    
    try {
      // Get the channels data
      final channelsData = await ref.read(discordChannelsProvider(selectedGuild['id']).future);
      
      // Filter selected channels
      final selectedChannelsData = channelsData
          .where((channel) => selectedChannelIds.contains(channel['id']))
          .toList();
      
      // Create Discord channel objects
      final discordChannels = selectedChannelsData
          .map((channel) => DiscordChannel(
                id: channel['id'],
                name: channel['name'],
                type: channel['type'],
                isSelected: true,
              ))
          .toList();
      
      // Add the integration
      await ref.read(discordIntegrationsProvider(widget.workspaceId).notifier).addIntegration(
        guildId: selectedGuild['id'],
        guildName: selectedGuild['name'],
        guildIconUrl: selectedGuild['icon'],
        channels: discordChannels,
        createdBy: AuthService.currentUser?.displayName ?? 'Unknown User',
      );
      
      if (!mounted) return;
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Successfully integrated with "${selectedGuild['name']}"'),
        ),
      );
      
      Navigator.of(context).pop();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error creating integration: $e')),
      );
      setState(() {
        _isLoading = false;
      });
    }
  }
}