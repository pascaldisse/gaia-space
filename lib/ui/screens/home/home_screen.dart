import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gaia_space/core/services/auth_service.dart';
import 'package:gaia_space/ui/screens/auth/login_screen.dart';
import 'package:gaia_space/ui/screens/home/workspace_screen.dart';
import 'package:gaia_space/ui/screens/home/project_screen.dart';
import 'package:gaia_space/ui/screens/home/repository_screen.dart';
import 'package:gaia_space/ui/screens/home/pipeline_screen.dart';
import 'package:gaia_space/ui/screens/home/document_screen.dart';
import 'package:gaia_space/ui/screens/settings/settings_screen.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _selectedIndex = 1; // Default to Projects (index 1)
  
  // List of screens for bottom navigation
  final List<Widget> _screens = [
    const WorkspaceScreen(),
    const ProjectScreen(),
    const RepositoryScreen(),
    const PipelineScreen(),
    const DocumentScreen(),
  ];
  
  // Navigation items
  final List<NavigationDestination> _navigationItems = const [
    NavigationDestination(
      icon: Icon(Icons.workspaces),
      label: 'Workspaces',
    ),
    NavigationDestination(
      icon: Icon(Icons.task_alt),
      label: 'Projects',
    ),
    NavigationDestination(
      icon: Icon(Icons.code),
      label: 'Repositories',
    ),
    NavigationDestination(
      icon: Icon(Icons.account_tree),
      label: 'Pipelines',
    ),
    NavigationDestination(
      icon: Icon(Icons.article),
      label: 'Documents',
    ),
  ];

  void _onItemTapped(int index) {
    setState(() {
      _selectedIndex = index;
    });
  }
  
  Future<void> _logout() async {
    // Show confirmation dialog
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Logout'),
        content: const Text('Are you sure you want to logout?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Logout'),
          ),
        ],
      ),
    );
    
    if (confirmed == true) {
      await AuthService.logout();
      
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (context) => const LoginScreen()),
        );
      }
    }
  }
  
  void _openSettings() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (context) => const SettingsScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = AuthService.currentUser;
    
    return Scaffold(
      appBar: AppBar(
        title: Text(_navigationItems[_selectedIndex].label),
        actions: [
          // User profile menu
          PopupMenuButton<String>(
            onSelected: (value) {
              if (value == 'settings') {
                _openSettings();
              } else if (value == 'logout') {
                _logout();
              }
            },
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'profile',
                child: Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: Theme.of(context).primaryColor,
                      radius: 14,
                      child: Text(
                        user?.displayName.isNotEmpty == true
                            ? user!.displayName[0].toUpperCase()
                            : 'U',
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          user?.displayName ?? 'User',
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                        Text(
                          user?.email ?? 'user@example.com',
                          style: TextStyle(
                            fontSize: 12,
                            color: Theme.of(context).textTheme.bodyMedium?.color?.withOpacity(0.7),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const PopupMenuDivider(),
              const PopupMenuItem(
                value: 'settings',
                child: Row(
                  children: [
                    Icon(Icons.settings),
                    SizedBox(width: 8),
                    Text('Settings'),
                  ],
                ),
              ),
              const PopupMenuItem(
                value: 'logout',
                child: Row(
                  children: [
                    Icon(Icons.logout),
                    SizedBox(width: 8),
                    Text('Logout'),
                  ],
                ),
              ),
            ],
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0),
              child: CircleAvatar(
                backgroundColor: Theme.of(context).primaryColor.withOpacity(0.2),
                radius: 16,
                child: Text(
                  user?.displayName.isNotEmpty == true
                      ? user!.displayName[0].toUpperCase()
                      : 'U',
                  style: TextStyle(
                    color: Theme.of(context).primaryColor,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
      body: _screens[_selectedIndex],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: _onItemTapped,
        destinations: _navigationItems,
      ),
    );
  }
}