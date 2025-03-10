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
      // Check if already authenticated
      final isAuthenticated = await _discordService.isAuthenticated();
      
      if (isAuthenticated) {
        // If already authenticated, go straight to server selection
        await _showAddIntegrationDialog();
      } else {
        // Start the OAuth flow
        // Support both platforms - web URL for production, custom scheme for mobile/desktop
        final webRedirectUri = 'https://gaia-space.app/auth/discord/callback';
        final appRedirectUri = 'gaiaspace://discord_callback';
        
        // Use app scheme for better deep linking support
        final redirectUri = appRedirectUri;
        
        final success = await _discordService.launchOAuthFlow(
          redirectUri: redirectUri,
          scopes: ['identify', 'guilds', 'bot'],
        );
        
        if (success) {
          // The app should receive the callback via deep linking
          // If that fails, allow manual entry as a fallback
          final code = await _showAuthCodeDialog();
          
          if (code != null && code.isNotEmpty) {
            // Exchange the code for a token
            await _discordService.exchangeCodeForToken(code, redirectUri);
            
            // Now show the server selection
            if (mounted) {
              await _showAddIntegrationDialog();
            }
          }
        } else {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('Failed to launch Discord authentication'),
                backgroundColor: Colors.red,
              ),
            );
          }
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error connecting to Discord: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isAddingIntegration = false;
        });
      }
    }
  }
  
  // Show dialog to manually enter the authorization code
  // In a real app with a proper redirect URI, this would be handled automatically
  Future<String?> _showAuthCodeDialog() async {
    final codeController = TextEditingController();
    
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('Enter Discord Authorization Code'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'After authorizing on Discord, copy the code from the redirect URL.\n\n'
              'Look for the "code" parameter in the URL.',
              style: TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: codeController,
              decoration: const InputDecoration(
                labelText: 'Authorization Code',
                border: OutlineInputBorder(),
                hintText: 'Paste the code here...',
              ),
              autofocus: true,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(codeController.text.trim()),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
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
  final DiscordService _discordService = DiscordService();
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
          const Text(
            'Gaia Space will request the following permissions:',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          _buildPermissionItem(
            icon: Icons.person,
            text: 'Access your Discord username and avatar',
            subtitle: 'Required to identify your account',
          ),
          _buildPermissionItem(
            icon: Icons.group,
            text: 'View your Discord servers',
            subtitle: 'Required to display available servers',
          ),
          _buildPermissionItem(
            icon: Icons.chat,
            text: 'Access your Discord channels',
            subtitle: 'Required to sync channel content',
          ),
          const SizedBox(height: 24),
          Center(
            child: ElevatedButton.icon(
              icon: const Icon(Icons.login),
              label: const Text('Connect Discord Account'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                textStyle: const TextStyle(fontSize: 16)
              ),
              onPressed: () => _connectToDiscord(),
            ),
          ),
          const SizedBox(height: 16),
          const Center(
            child: Text(
              'You\'ll be redirected to Discord to approve these permissions',
              style: TextStyle(color: Colors.grey, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
  
  Widget _buildPermissionItem({
    required IconData icon,
    required String text,
    required String subtitle,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: Colors.blue),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(text, style: const TextStyle(fontWeight: FontWeight.w500)),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
  
  void _connectToDiscord() async {
    setState(() {
      _isConnectingToDiscord = true;
    });
    
    try {
      // Launch OAuth flow with Discord
      // Support both platforms - web URL for production, custom scheme for mobile/desktop
      final webRedirectUri = 'https://gaia-space.app/auth/discord/callback';
      final appRedirectUri = 'gaiaspace://discord_callback';
      
      // Use app scheme for better deep linking support
      final redirectUri = appRedirectUri;
      
      final success = await _discordService.launchOAuthFlow(
        redirectUri: redirectUri,
        scopes: ['identify', 'guilds', 'bot'],
      );
      
      if (success) {
        // For this demo flow, show a dialog to enter the code manually
        // In a real app with proper deep linking, this would be automatic
        final code = await _showAuthCodeInputDialog();
        
        if (code != null && code.isNotEmpty) {
          // Show connecting status
          setState(() {
            _connectionStep = 2; // Authorizing application
          });
          
          // Exchange code for token
          await _discordService.exchangeCodeForToken(code, redirectUri);
          
          // Update connection step
          setState(() {
            _connectionStep = 3; // Fetching account information
          });
          
          // Small delay to show progress
          await Future.delayed(const Duration(milliseconds: 500));
          
          // Update connection step
          setState(() {
            _connectionStep = 4; // Retrieving servers
          });
          
          // Prefetch user guilds to ensure we're authenticated
          await ref.refresh(discordGuildsProvider.future);
          
          // Move to the next step
          if (mounted) {
            setState(() {
              _isConnectingToDiscord = false;
              _currentStep = 1;
            });
          }
        } else {
          // User cancelled code input
          setState(() {
            _isConnectingToDiscord = false;
          });
        }
      } else {
        // Browser launch failed
        if (mounted) {
          setState(() {
            _isConnectingToDiscord = false;
          });
          
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Failed to launch browser for Discord authentication'),
              backgroundColor: Colors.red,
            ),
          );
        }
      }
    } catch (e) {
      // Handle errors
      if (mounted) {
        setState(() {
          _isConnectingToDiscord = false;
        });
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error connecting to Discord: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }
  
  // Connection step for UI feedback
  int _connectionStep = 1;
  
  // Dialog to enter the authorization code
  Future<String?> _showAuthCodeInputDialog() async {
    final codeController = TextEditingController();
    
    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('Enter Authorization Code'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'After authorizing on Discord, copy the code from the redirect URL.\n\n'
              'Look for the "code" parameter in the URL.',
              style: TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: codeController,
              decoration: const InputDecoration(
                labelText: 'Authorization Code',
                border: OutlineInputBorder(),
                hintText: 'Paste the code here...',
              ),
              autofocus: true,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(codeController.text.trim()),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
  }

  Widget _buildConnectToDiscord() {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Discord logo
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: const Color(0xFF5865F2), // Discord brand color
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Icon(
              Icons.discord,
              color: Colors.white,
              size: 48,
            ),
          ),
          const SizedBox(height: 24),
          
          // Loading indicator and status
          const CircularProgressIndicator(),
          const SizedBox(height: 24),
          const Text(
            'Connecting to Discord',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'You will be redirected to authorize this application',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, color: Colors.grey),
          ),
          
          // Connection steps
          const SizedBox(height: 32),
          _buildConnectionStep(
            '1. Redirecting to Discord',
            isCompleted: _connectionStep > 1,
            isActive: _connectionStep == 1,
          ),
          _buildConnectionStep(
            '2. Authorizing application',
            isCompleted: _connectionStep > 2,
            isActive: _connectionStep == 2,
            isUpcoming: _connectionStep < 2,
          ),
          _buildConnectionStep(
            '3. Fetching account information',
            isCompleted: _connectionStep > 3,
            isActive: _connectionStep == 3,
            isUpcoming: _connectionStep < 3,
          ),
          _buildConnectionStep(
            '4. Retrieving your servers',
            isCompleted: _connectionStep > 4,
            isActive: _connectionStep == 4,
            isUpcoming: _connectionStep < 4,
          ),
        ],
      ),
    );
  }
  
  Widget _buildConnectionStep(
    String label, {
    bool isCompleted = false,
    bool isActive = false,
    bool isUpcoming = false,
  }) {
    Color? color;
    IconData? icon;
    
    if (isCompleted) {
      color = Colors.green;
      icon = Icons.check_circle;
    } else if (isActive) {
      color = Colors.blue;
      icon = Icons.refresh;
    } else {
      color = Colors.grey.shade400;
      icon = Icons.circle_outlined;
    }
    
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Row(
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 12),
          Text(
            label,
            style: TextStyle(
              color: isUpcoming ? Colors.grey : Colors.black,
              fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
            ),
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
            if (guilds.isEmpty) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.warning_amber_rounded, 
                        color: Colors.orange, 
                        size: 48
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'No Discord servers found',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'You need to be a member of at least one Discord server with proper permissions.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.grey),
                      ),
                      const SizedBox(height: 24),
                      ElevatedButton(
                        onPressed: () async {
                          // Clear authentication and restart
                          await _discordService.logout();
                          setState(() {
                            _currentStep = 0;
                          });
                          Navigator.of(context).pop();
                          _startAddIntegration();
                        },
                        child: const Text('Try with another account'),
                      ),
                    ],
                  ),
                ),
              );
            }
            
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Select a Discord server to integrate with this workspace',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Choose which Discord server you want to connect to this workspace. '
                  'You can sync channels from this server to enhance collaboration.',
                  style: TextStyle(fontSize: 14, color: Colors.grey),
                ),
                const SizedBox(height: 24),
                
                // Server count and refresh action
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8.0),
                  child: Row(
                    children: [
                      Text(
                        'Found ${guilds.length} servers',
                        style: const TextStyle(color: Colors.grey),
                      ),
                      const Spacer(),
                      TextButton.icon(
                        icon: const Icon(Icons.refresh, size: 16),
                        label: const Text('Refresh'),
                        onPressed: () {
                          ref.refresh(discordGuildsProvider);
                        },
                      ),
                    ],
                  ),
                ),
                
                // Search input
                TextField(
                  decoration: InputDecoration(
                    hintText: 'Search servers...',
                    prefixIcon: const Icon(Icons.search),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                    contentPadding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
                const SizedBox(height: 16),
                
                // Servers grid
                GridView.count(
                  crossAxisCount: 2,
                  childAspectRatio: 1.2,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  children: guilds.map((guild) => _buildServerCard(guild, selectedGuild)).toList(),
                ),
              ],
            );
          },
          loading: () => const Center(
            child: Padding(
              padding: EdgeInsets.all(24.0),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text(
                    'Loading your Discord servers...',
                    style: TextStyle(fontSize: 16),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'This may take a moment',
                    style: TextStyle(color: Colors.grey, fontSize: 14),
                  ),
                ],
              ),
            ),
          ),
          error: (error, stack) {
            // Handle authentication errors specifically
            final bool isAuthError = error.toString().contains('401') || 
                                     error.toString().contains('authentication') || 
                                     error.toString().contains('Not authenticated');
            
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      isAuthError ? Icons.lock : Icons.error_outline, 
                      color: Colors.red, 
                      size: 48
                    ),
                    const SizedBox(height: 16),
                    Text(
                      isAuthError ? 'Authentication Error' : 'Error Loading Servers',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      isAuthError 
                          ? 'Your Discord session has expired or is invalid.'
                          : 'Unable to load your Discord servers: ${error.toString().split('\n').first}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.grey),
                    ),
                    const SizedBox(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        ElevatedButton.icon(
                          icon: const Icon(Icons.refresh),
                          label: const Text('Retry'),
                          onPressed: () {
                            ref.refresh(discordGuildsProvider);
                          },
                        ),
                        const SizedBox(width: 12),
                        OutlinedButton.icon(
                          icon: const Icon(Icons.login),
                          label: const Text('Reconnect'),
                          onPressed: () async {
                            await _discordService.logout();
                            setState(() {
                              _currentStep = 0;
                            });
                            Navigator.of(context).pop();
                            _startAddIntegration();
                          },
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildServerCard(Map<String, dynamic> guild, Map<String, dynamic>? selectedGuild) {
    final isSelected = selectedGuild != null && selectedGuild['id'] == guild['id'];
    
    return InkWell(
      onTap: () {
        ref.read(selectedGuildProvider.notifier).state = guild;
      },
      borderRadius: BorderRadius.circular(12),
      child: Container(
        decoration: BoxDecoration(
          border: Border.all(
            color: isSelected ? Colors.blue : Colors.grey.shade300,
            width: isSelected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(12),
          color: isSelected ? Colors.blue.withOpacity(0.05) : null,
        ),
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Server icon
            guild['icon'] != null
                ? CircleAvatar(
                    radius: 28,
                    backgroundImage: NetworkImage(guild['icon']),
                    backgroundColor: Colors.grey.shade200,
                  )
                : CircleAvatar(
                    radius: 28,
                    backgroundColor: Colors.primaries[guild['name'].hashCode % Colors.primaries.length],
                    child: Text(
                      guild['name'][0].toUpperCase(),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
            const SizedBox(height: 12),
            
            // Server name
            Text(
              guild['name'],
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            
            // Selection indicator
            const SizedBox(height: 8),
            isSelected
                ? const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.check_circle, color: Colors.green, size: 16),
                      SizedBox(width: 4),
                      Text(
                        'Selected',
                        style: TextStyle(
                          color: Colors.green,
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  )
                : const Text(
                    'Click to select',
                    style: TextStyle(fontSize: 12, color: Colors.grey),
                  ),
          ],
        ),
      ),
    );
  }

  Widget _buildSelectChannelsStep() {
    return Consumer(
      builder: (context, ref, child) {
        final selectedGuild = ref.watch(selectedGuildProvider);
        
        if (selectedGuild == null) {
          return Padding(
            padding: const EdgeInsets.all(20.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.arrow_back, size: 48, color: Colors.grey),
                const SizedBox(height: 16),
                const Text(
                  'Please select a server first',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Go back to the previous step to select a Discord server',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey),
                ),
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: () {
                    setState(() {
                      _currentStep = 1;
                    });
                  },
                  child: const Text('Go Back to Server Selection'),
                ),
              ],
            ),
          );
        }
        
        final channelsAsync = ref.watch(discordChannelsProvider(selectedGuild['id']));
        final selectedChannels = ref.watch(selectedChannelsProvider);
        
        return channelsAsync.when(
          data: (channels) {
            if (channels.isEmpty) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.warning_amber_rounded, 
                        color: Colors.orange, 
                        size: 48
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'No channels found',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'The server "${selectedGuild['name']}" doesn\'t have any text or voice channels, '
                        'or you don\'t have permission to view them.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.grey),
                      ),
                      const SizedBox(height: 24),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          ElevatedButton.icon(
                            icon: const Icon(Icons.refresh),
                            label: const Text('Refresh'),
                            onPressed: () {
                              ref.refresh(discordChannelsProvider(selectedGuild['id']));
                            },
                          ),
                          const SizedBox(width: 12),
                          OutlinedButton.icon(
                            icon: const Icon(Icons.arrow_back),
                            label: const Text('Select Another Server'),
                            onPressed: () {
                              setState(() {
                                _currentStep = 1;
                              });
                            },
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }
            
            // Group channels by category
            final categorizedChannels = <String, List<Map<String, dynamic>>>{};
            
            // Add uncategorized section for channels without a parent
            categorizedChannels['Uncategorized'] = [];
            
            // First find all text channels and sort by category
            for (final channel in channels) {
              final parentId = channel['parent_id'] as String?;
              final channelType = channel['type'] as String;
              
              if (channelType == 'text' || channelType == 'voice') {
                if (parentId == null || parentId.isEmpty) {
                  categorizedChannels['Uncategorized']!.add(channel);
                } else {
                  final categoryName = _getCategoryName(parentId, channels) ?? 'Other';
                  categorizedChannels.putIfAbsent(categoryName, () => []).add(channel);
                }
              }
            }
            
            final textChannels = channels.where((c) => c['type'] == 'text').toList();
            final voiceChannels = channels.where((c) => c['type'] == 'voice').toList();
            
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header
                Text(
                  'Channels from "${selectedGuild['name']}"',
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Select which channels to sync with your workspace. '
                  'Text channels will show messages, while voice channels will show activity.',
                  style: TextStyle(fontSize: 14, color: Colors.grey),
                ),
                
                // Selection Controls
                Container(
                  margin: const EdgeInsets.symmetric(vertical: 16),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.grey.shade100,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      const Text('Channels selected:'),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: Colors.blue,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          '${selectedChannels.length}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const Spacer(),
                      TextButton.icon(
                        icon: const Icon(Icons.select_all, size: 16),
                        label: const Text('Select All'),
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                        ),
                        onPressed: () {
                          ref.read(selectedChannelsProvider.notifier).state =
                              channels.map((channel) => channel['id'] as String).toList();
                        },
                      ),
                      TextButton.icon(
                        icon: const Icon(Icons.deselect, size: 16),
                        label: const Text('Deselect All'),
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                        ),
                        onPressed: () {
                          ref.read(selectedChannelsProvider.notifier).state = [];
                        },
                      ),
                    ],
                  ),
                ),
                
                // Channel count + Refresh button
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8.0),
                  child: Row(
                    children: [
                      Text(
                        'Found ${channels.length} channels',
                        style: const TextStyle(color: Colors.grey),
                      ),
                      const Spacer(),
                      TextButton.icon(
                        icon: const Icon(Icons.refresh, size: 16),
                        label: const Text('Refresh'),
                        onPressed: () {
                          ref.refresh(discordChannelsProvider(selectedGuild['id']));
                        },
                      ),
                    ],
                  ),
                ),
                
                // Search input
                TextField(
                  decoration: InputDecoration(
                    hintText: 'Search channels...',
                    prefixIcon: const Icon(Icons.search),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                    contentPadding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
                const SizedBox(height: 16),
                
                // Categorized channels
                for (final category in categorizedChannels.keys) ...[
                  if (categorizedChannels[category]!.isNotEmpty) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade100,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.folder, size: 16),
                          const SizedBox(width: 8),
                          Text(
                            category.toUpperCase(),
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            '${categorizedChannels[category]!.length}',
                            style: const TextStyle(
                              color: Colors.grey,
                              fontWeight: FontWeight.bold,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    ...categorizedChannels[category]!
                      .where((channel) => 
                          channel['type'] == 'text' ||
                          channel['type'] == 'voice')
                      .map((channel) => _buildChannelTile(
                        channel,
                        selectedChannels,
                        ref,
                      )),
                    const SizedBox(height: 16),
                  ],
                ],
              ],
            );
          },
          loading: () => const Center(
            child: Padding(
              padding: EdgeInsets.all(24.0),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text(
                    'Loading channels from Discord...',
                    style: TextStyle(fontSize: 16),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'This may take a moment',
                    style: TextStyle(color: Colors.grey, fontSize: 14),
                  ),
                ],
              ),
            ),
          ),
          error: (error, stack) {
            // Handle authentication errors specifically
            final bool isAuthError = error.toString().contains('401') || 
                                     error.toString().contains('authentication');
            
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      isAuthError ? Icons.lock : Icons.error_outline, 
                      color: Colors.red, 
                      size: 48
                    ),
                    const SizedBox(height: 16),
                    Text(
                      isAuthError ? 'Authentication Error' : 'Error Loading Channels',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      isAuthError 
                          ? 'Your Discord session has expired or is invalid.'
                          : 'Unable to load channels: ${error.toString().split('\n').first}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.grey),
                    ),
                    const SizedBox(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        ElevatedButton.icon(
                          icon: const Icon(Icons.refresh),
                          label: const Text('Try Again'),
                          onPressed: () {
                            ref.refresh(discordChannelsProvider(selectedGuild['id']));
                          },
                        ),
                        if (isAuthError) ...[
                          const SizedBox(width: 12),
                          OutlinedButton.icon(
                            icon: const Icon(Icons.login),
                            label: const Text('Reconnect'),
                            onPressed: () async {
                              await _discordService.logout();
                              setState(() {
                                _currentStep = 0;
                              });
                              Navigator.of(context).pop();
                              _startAddIntegration();
                            },
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
  
  // Helper method to get category name from channel ID
  String? _getCategoryName(String categoryId, List<Map<String, dynamic>> channels) {
    for (final channel in channels) {
      if (channel['id'] == categoryId) {
        return channel['name'];
      }
    }
    return null;
  }
  
  Widget _buildChannelTile(
    Map<String, dynamic> channel,
    List<String> selectedChannels,
    WidgetRef ref,
  ) {
    final isSelected = selectedChannels.contains(channel['id']);
    IconData channelIcon;
    Color iconColor;
    
    switch (channel['type']) {
      case 'text':
        channelIcon = Icons.tag;
        iconColor = Colors.grey.shade700;
        break;
      case 'voice':
        channelIcon = Icons.headset;
        iconColor = Colors.green.shade700;
        break;
      default:
        channelIcon = Icons.chat;
        iconColor = Colors.blue.shade700;
    }
    
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        border: Border.all(
          color: isSelected ? Colors.blue.shade300 : Colors.grey.shade300,
          width: isSelected ? 2 : 1,
        ),
        borderRadius: BorderRadius.circular(8),
        color: isSelected ? Colors.blue.withOpacity(0.05) : Colors.white,
      ),
      child: CheckboxListTile(
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
            Icon(channelIcon, size: 16, color: iconColor),
            const SizedBox(width: 8),
            Text(
              channel['name'],
              style: TextStyle(
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ],
        ),
        subtitle: channel['type'] == 'voice'
            ? const Text('Voice activity only', style: TextStyle(fontSize: 12))
            : const Text('Text messages and threads', style: TextStyle(fontSize: 12)),
        secondary: isSelected
            ? const Icon(Icons.check_circle, color: Colors.green)
            : null,
        controlAffinity: ListTileControlAffinity.leading,
        dense: true,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
      ),
    );
  }

  void _nextStep() {
    if (_currentStep == 0) {
      // Start OAuth process via the connect method
      _connectToDiscord();
    } else if (_currentStep == 1) {
      final selectedGuild = ref.read(selectedGuildProvider);
      if (selectedGuild == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Please select a server'),
            backgroundColor: Colors.red,
          ),
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
    
    // Validation
    if (selectedGuild == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select a Discord server'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    
    if (selectedChannelIds.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select at least one channel to integrate'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    
    // Show loading state
    setState(() {
      _isLoading = true;
    });
    
    try {
      // Create a progress dialog
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          title: const Text('Creating Integration'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const LinearProgressIndicator(),
              const SizedBox(height: 20),
              Text('Integrating with "${selectedGuild['name']}"'),
              const SizedBox(height: 8),
              const Text(
                'This may take a moment while we configure your integration',
                style: TextStyle(fontSize: 12, color: Colors.grey),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
      
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
      
      // Add short delay to make the progress dialog visible
      await Future.delayed(const Duration(seconds: 1));
      
      // Add the integration
      final integration = await ref.read(discordIntegrationsProvider(widget.workspaceId).notifier).addIntegration(
        guildId: selectedGuild['id'],
        guildName: selectedGuild['name'],
        guildIconUrl: selectedGuild['icon'],
        channels: discordChannels,
        createdBy: AuthService.currentUser?.displayName ?? 'Unknown User',
      );
      
      // Close the progress dialog
      if (mounted) {
        Navigator.of(context).pop();
      }
      
      if (!mounted) return;
      
      // Show success dialog
      await showDialog(
        context: context,
        builder: (context) => AlertDialog(
          icon: Container(
            width: 60,
            height: 60,
            decoration: const BoxDecoration(
              color: Colors.green,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.check,
              color: Colors.white,
              size: 40,
            ),
          ),
          title: const Text('Integration Successful'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Successfully connected to Discord server "${selectedGuild['name']}"',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                'Synced ${discordChannels.length} channels',
                style: const TextStyle(color: Colors.grey),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close'),
            ),
          ],
        ),
      );
      
      // Return to the main screen
      if (mounted) {
        Navigator.of(context).pop();
      }
    } catch (e) {
      // Close the progress dialog if it's open
      if (mounted && Navigator.canPop(context)) {
        Navigator.of(context).pop();
      }
      
      if (!mounted) return;
      
      // Show error dialog
      await showDialog(
        context: context,
        builder: (context) => AlertDialog(
          icon: Container(
            width: 60,
            height: 60,
            decoration: const BoxDecoration(
              color: Colors.red,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.error_outline,
              color: Colors.white,
              size: 40,
            ),
          ),
          title: const Text('Integration Failed'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'There was a problem connecting to Discord',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  e.toString(),
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    color: Colors.red,
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Dismiss'),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.of(context).pop();
                _finishIntegration();
              },
              child: const Text('Retry'),
            ),
          ],
        ),
      );
      
      setState(() {
        _isLoading = false;
      });
    }
  }
}