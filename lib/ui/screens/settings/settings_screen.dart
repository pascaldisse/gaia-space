import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/services/auth_service.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _notificationsEnabled = true;
  bool _darkThemeEnabled = false;
  String _selectedLanguage = 'English';
  
  final List<String> _languages = [
    'English',
    'Spanish',
    'French',
    'German',
    'Japanese',
    'Chinese',
  ];

  @override
  Widget build(BuildContext context) {
    final user = AuthService.currentUser;
    
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
      ),
      body: ListView(
        children: [
          // User profile section
          if (user != null) ...[
            _buildSectionHeader('Account'),
            ListTile(
              leading: CircleAvatar(
                backgroundColor: Theme.of(context).primaryColor,
                child: Text(
                  user.displayName.isNotEmpty ? user.displayName[0].toUpperCase() : 'U',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              title: Text(user.displayName),
              subtitle: Text(user.email),
              trailing: const Icon(Icons.chevron_right),
              onTap: () {
                // TODO: Navigate to profile edit screen
              },
            ),
            const Divider(),
          ],
          
          // Appearance settings
          _buildSectionHeader('Appearance'),
          SwitchListTile(
            title: const Text('Dark Theme'),
            subtitle: const Text('Use dark color scheme'),
            value: _darkThemeEnabled,
            onChanged: (value) {
              setState(() {
                _darkThemeEnabled = value;
                // TODO: Implement theme change
              });
            },
          ),
          ListTile(
            title: const Text('Language'),
            subtitle: Text(_selectedLanguage),
            trailing: const Icon(Icons.chevron_right),
            onTap: _showLanguageSelector,
          ),
          const Divider(),
          
          // Notification settings
          _buildSectionHeader('Notifications'),
          SwitchListTile(
            title: const Text('Enable Notifications'),
            subtitle: const Text('Receive push notifications'),
            value: _notificationsEnabled,
            onChanged: (value) {
              setState(() {
                _notificationsEnabled = value;
                // TODO: Implement notification setting
              });
            },
          ),
          const Divider(),
          
          // About section
          _buildSectionHeader('About'),
          ListTile(
            title: const Text('App Version'),
            subtitle: const Text('1.0.0'),
            trailing: const Icon(Icons.info_outline),
            onTap: () {
              // TODO: Show version details
            },
          ),
          ListTile(
            title: const Text('Terms of Service'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              // TODO: Navigate to terms of service
            },
          ),
          ListTile(
            title: const Text('Privacy Policy'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              // TODO: Navigate to privacy policy
            },
          ),
          const Divider(),
        ],
      ),
    );
  }
  
  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        title,
        style: TextStyle(
          color: Theme.of(context).primaryColor,
          fontWeight: FontWeight.bold,
          fontSize: 14,
        ),
      ),
    );
  }
  
  void _showLanguageSelector() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Select Language'),
        content: SizedBox(
          width: double.maxFinite,
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: _languages.length,
            itemBuilder: (context, index) {
              final language = _languages[index];
              return RadioListTile<String>(
                title: Text(language),
                value: language,
                groupValue: _selectedLanguage,
                onChanged: (value) {
                  setState(() {
                    _selectedLanguage = value!;
                    // TODO: Implement language change
                  });
                  Navigator.of(context).pop();
                },
              );
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }
}