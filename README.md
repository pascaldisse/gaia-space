# Gaia Space - Collaborative Workspace Platform

Gaia Space is a modern Flutter application designed to provide a comprehensive workspace collaboration environment. It integrates team communication, project management, document sharing, and third-party services like Discord.

## Table of Contents

- [Features Overview](#features-overview)
- [Technical Architecture](#technical-architecture)
- [Getting Started](#getting-started)
   - [Requirements](#requirements)
   - [Building and Running](#building-and-running)
   - [Development Environment Setup](#development-environment-setup)
- [Core Components](#core-components)
   - [Server Configuration](#server-configuration)
   - [Database Schema](#database-schema)
   - [Service Layer](#service-layer)
   - [API Layer](#api-layer)
   - [UI Templates](#ui-templates)
- [Authentication](#authentication)
- [Database Access](#database-access)
- [Extending the Platform](#extending-the-platform)
- [Production Deployment](#production-deployment)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)
- [License](#license)

## Features Overview

Gaia Space combines the functionality of multiple DevOps tools into a unified platform:

- **Team Collaboration** - Workspaces, channels, and real-time messaging
- **Project Management** - Kanban boards, tasks, priorities, and deadlines
- **Document Sharing** - Markdown support and collaborative editing
- **Source Control** - Git repositories, branches, and merge requests with code reviews
- **CI/CD** - Pipelines, jobs, and build automation
- **Discord Integration** - Connect Discord servers to workspaces
- **Extensible Platform** - Easy to add new integrations and features
- **Documentation** - Document spaces, versioning, and collaborative editing
- **Package Registry** - Package repositories for various formats
- **Organization Management** - Departments, teams, and roles

## Technical Architecture

### System Overview

Gaia-Space follows a layered architecture pattern:

```
┌────────────┐   ┌─────────────┐   ┌──────────────┐   ┌─────────────┐
│ UI Layer   │   │ State       │   │ Service      │   │ Data        │
│ (Screens & │<──│ Management  │<──│ Layer        │<──│ Layer       │
│  Widgets)  │   │ (Riverpod)  │   │ (Business    │   │ (Models &   │
└────────────┘   └─────────────┘   │ Logic)       │   │ Providers)  │
                                   └──────────────┘   └─────────────┘
```

- **UI Layer**: Flutter widgets and screens for responsive UI
- **State Management**: Riverpod for state management and dependency injection
- **Service Layer**: Business logic and API communication
- **Data Layer**: Data models, repositories, and local storage

### Technology Stack

- **Framework**: Flutter for cross-platform UI
- **Language**: Dart
- **State Management**: Flutter Riverpod
- **Database**: Drift (SQLite) for local storage
- **API Communication**: Dio for REST, GraphQL for advanced queries
- **Authentication**: JWT tokens with secure storage
- **UI Components**: Material Design with custom theming
- **Git Integration**: git2dart for Git operations

## Getting Started

### Requirements

- Flutter SDK 3.0.0 or later
- Dart SDK 3.0.0 or later
- Git (for version control)
- Android Studio or VS Code with Flutter extensions

### Building and Running

Clone the repository:

```bash
git clone https://github.com/yourusername/gaia-space.git
cd gaia-space
```

Install dependencies:

```bash
flutter pub get
```

Run the application:

```bash
flutter run
```

For specific platforms:

```bash
flutter run -d chrome  # For web
flutter run -d ios     # For iOS simulator
flutter run -d android # For Android emulator
```

### Development Environment Setup

1. **IDE Configuration**: The project works well with Android Studio or VS Code with Flutter extensions
2. **Simulator/Emulator**: Set up iOS simulators or Android emulators for testing
3. **Hot Reload**: Flutter supports hot reload for fast development

To enable verbose logging during development:

```bash
flutter run --verbose
```

## Core Components

### App Structure

The application follows a modular structure:

```
lib/
├── core/
│   ├── models/         # Data models
│   ├── services/       # Business logic services
│   ├── repositories/   # Data access layer
│   └── utils/          # Utility functions
├── data/
│   └── providers/      # Data providers for state management
├── ui/
│   ├── screens/        # App screens
│   ├── widgets/        # Reusable UI components
│   └── themes/         # App theming
└── main.dart           # Application entry point
```

### Data Models

Gaia-Space uses Equatable models for immutable data handling:

#### Core Models
- `User` - User account information
- `Workspace` - Top-level organizational containers
- `Channel` - Communication channels within workspaces
- `Message` - Channel messages or task comments

#### Project Management Models
- `Project` - Project containers within workspaces
- `Board` - Kanban boards for task visualization
- `Task` - Individual work items with metadata
- `TaskDependency` - Relationships between tasks
- `TaskActivity` - Audit log of task changes

#### Git Models
- `GitRepository` - Source code repositories
- `GitBranch` - Branches within repositories
- `MergeRequest` - Code review submissions
- `CodeDiff` - Code changes for review
- `CodeComment` - Review comments on code

#### CI/CD Models
- `Pipeline` - CI/CD workflows
- `Job` - Individual jobs within pipelines
- `JobStep` - Execution steps within jobs

#### Documentation Models
- `DocumentSpace` - Documentation organization containers
- `Document` - Individual documents
- `DocumentVersion` - Version history of documents

Example model structure:

```dart
class Workspace extends Equatable {
  final String id;
  final String name;
  final String? description;
  final String createdBy;
  final DateTime createdAt;
  final int membersCount;
  final int channelsCount;
  final String? avatarUrl;

  const Workspace({
    required this.id,
    required this.name,
    this.description,
    required this.createdBy,
    required this.createdAt,
    required this.membersCount,
    required this.channelsCount,
    this.avatarUrl,
  });
  
  // Methods for immutability, serialization, etc.
  Workspace copyWith({...}) {...}
  Map<String, dynamic> toJson() {...}
  factory Workspace.fromJson(Map<String, dynamic> json) {...}
}
```

### Service Layer

Services implement business logic and data access:

```dart
class AuthService {
  static User? _currentUser;
  static String? _token;
  
  static User? get currentUser => _currentUser;
  static String? get token => _token;
  static bool get isAuthenticated => _currentUser != null && _token != null;
  
  static Future<User?> login(String username, String password) async {
    // Authentication logic
  }
  
  static Future<User?> register(String username, String email, String password) async {
    // Registration logic
  }
  
  static Future<void> logout() async {
    // Logout logic
  }
}
```

Key service classes:

- `AuthService` - Authentication and user management
- `WorkspaceService` - Workspace operations
- `ChannelService` - Channel and message management
- `TaskService` - Task and task list operations
- `ProjectService` - Project and board management
- `GitService` - Repository and branch management
- `DocumentService` - Documentation system operations

### State Management

The app uses Riverpod for state management:

```dart
// Provider definition
final workspacesProvider = FutureProvider<List<Workspace>>((ref) async {
  // Fetch workspaces from API or local database
  return workspaceService.getAllWorkspaces();
});

// Usage in widget
class WorkspaceScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspacesAsync = ref.watch(workspacesProvider);
    
    return workspacesAsync.when(
      data: (workspaces) {
        // Display workspaces
      },
      loading: () => const LoadingIndicator(),
      error: (error, stackTrace) => ErrorDisplay(error: error),
    );
  }
}
```

### UI Layer

The UI layer is built with Flutter widgets:

- Material Design based components
- Responsive layouts for multiple screen sizes
- Custom theming for consistent branding
- Navigation using Flutter's navigation system

Example screen structure:

```dart
class WorkspaceScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspacesAsync = ref.watch(workspacesProvider);
    
    return Scaffold(
      appBar: AppBar(title: const Text('Workspaces')),
      body: workspacesAsync.when(
        data: (workspaces) => ListView.builder(
          itemCount: workspaces.length,
          itemBuilder: (context, index) => WorkspaceCard(
            workspace: workspaces[index],
          ),
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => ErrorDisplay(error: error),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCreateWorkspaceDialog(context),
        child: const Icon(Icons.add),
      ),
    );
  }
}
```

## Authentication

The app uses JWT token-based authentication:

```dart
class AuthService {
  static Future<User?> login(String username, String password) async {
    try {
      // API authentication
      final response = await apiClient.post('/auth/login', data: {
        'username': username,
        'password': password,
      });
      
      final token = response.data['token'];
      final userData = response.data['user'];
      
      // Store auth data securely
      await _secureStorage.write(key: 'auth_token', value: token);
      await _secureStorage.write(
        key: 'auth_user', 
        value: jsonEncode(userData),
      );
      
      // Update current user state
      _token = token;
      _currentUser = User.fromJson(userData);
      
      return _currentUser;
    } catch (e) {
      // Error handling
      rethrow;
    }
  }
}
```

For development and testing, the app includes mock authentication:

```dart
// Mock login for development
Future<User?> _mockLogin(String username, String password) async {
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
  
  // Store and return mock data
  await _storeAuthData(encodedToken, user);
  return user;
}
```

The app implements:

1. **Secure Storage**: Flutter Secure Storage for token persistence
2. **JWT Management**: Token validation and expiration handling
3. **Role-based Authorization**: User roles and permissions
4. **Biometric Authentication**: Optional fingerprint/face ID (in production)

## Data Storage

The app uses a multi-layered approach to data storage:

1. **Remote API**: RESTful and GraphQL APIs for backend communication
2. **Local Database**: Drift (SQLite) for offline capability
3. **Secure Storage**: Encrypted storage for sensitive information
4. **State Management**: Riverpod providers for in-memory application state

Example data repository implementation:

```dart
class WorkspaceRepository {
  final ApiClient _apiClient;
  final LocalDatabase _db;
  
  WorkspaceRepository(this._apiClient, this._db);
  
  // Fetch workspaces with offline support
  Future<List<Workspace>> getWorkspaces() async {
    try {
      // Try to fetch from API
      final response = await _apiClient.get('/workspaces');
      final workspaces = (response.data as List)
          .map((json) => Workspace.fromJson(json))
          .toList();
          
      // Update local cache
      await _db.workspaces.insertAll(workspaces);
      return workspaces;
    } catch (e) {
      // Fallback to local data if offline
      return _db.workspaces.getAll();
    }
  }
  
  // Additional methods for CRUD operations
}
```

## Extending the Platform

### Adding a New Entity

To add a new entity to the application:

1. Define the data model in `lib/core/models/`:
   ```dart
   class NewEntity extends Equatable {
     final String id;
     final String name;
     final String? description;
     final String relatedEntityId;
     final DateTime createdAt;

     const NewEntity({
       required this.id,
       required this.name,
       this.description,
       required this.relatedEntityId,
       required this.createdAt,
     });
     
     // Implement copyWith, toJson, fromJson methods
     
     @override
     List<Object?> get props => [id, name, description, relatedEntityId, createdAt];
   }
   ```

2. Add repository class in `lib/core/repositories/`:
   ```dart
   class NewEntityRepository {
     final ApiClient _apiClient;
     final LocalDatabase _db;
     
     NewEntityRepository(this._apiClient, this._db);
     
     Future<List<NewEntity>> getAll() async {
       // Implementation
     }
     
     Future<NewEntity?> getById(String id) async {
       // Implementation
     }
     
     Future<NewEntity> create(NewEntityRequest request) async {
       // Implementation
     }
     
     // Additional methods...
   }
   ```

3. Create a service class in `lib/core/services/`:
   ```dart
   class NewEntityService {
     final NewEntityRepository _repository;
     
     NewEntityService(this._repository);
     
     Future<List<NewEntity>> getAllEntities() async {
       return _repository.getAll();
     }
     
     Future<NewEntity?> getEntityById(String id) async {
       return _repository.getById(id);
     }
     
     Future<NewEntity> createEntity(NewEntityRequest request) async {
       // Add any business logic validation
       return _repository.create(request);
     }
     
     // Additional methods...
   }
   ```

4. Add a state provider in `lib/data/providers/`:
   ```dart
   final newEntitiesProvider = FutureProvider<List<NewEntity>>((ref) async {
     final service = ref.read(newEntityServiceProvider);
     return service.getAllEntities();
   });
   
   final newEntityProvider = FutureProvider.family<NewEntity?, String>((ref, id) async {
     final service = ref.read(newEntityServiceProvider);
     return service.getEntityById(id);
   });
   ```

5. Create UI screens and widgets in the `lib/ui/` directory:
   ```dart
   class NewEntityScreen extends ConsumerWidget {
     @override
     Widget build(BuildContext context, WidgetRef ref) {
       final entitiesAsync = ref.watch(newEntitiesProvider);
       
       return Scaffold(
         appBar: AppBar(title: const Text('New Entities')),
         body: entitiesAsync.when(
           data: (entities) => ListView.builder(
             itemCount: entities.length,
             itemBuilder: (context, index) => NewEntityCard(
               entity: entities[index],
             ),
           ),
           loading: () => const Center(child: CircularProgressIndicator()),
           error: (error, stackTrace) => ErrorDisplay(error: error),
         ),
         floatingActionButton: FloatingActionButton(
           onPressed: () => _showCreateEntityDialog(context),
           child: const Icon(Icons.add),
         ),
       );
     }
   }
   ```

### Adding a New Feature Module

To add a completely new feature module:

1. Create folder structure:
   ```
   lib/
   ├── features/
   │   └── new_feature/
   │       ├── models/
   │       ├── services/
   │       ├── repositories/
   │       ├── providers/
   │       └── screens/
   ```

2. Add data models, repositories, and services

3. Create UI screens and widgets

4. Update navigation to include the new feature:
   ```dart
   class AppRouter {
     static Route<dynamic> generateRoute(RouteSettings settings) {
       switch (settings.name) {
         // Existing routes
         case '/new-feature':
           return MaterialPageRoute(
             builder: (_) => const NewFeatureScreen(),
           );
         // Additional routes...
       }
     }
   }
   ```

## Production Deployment

### Building for Production

To build the app for production:

```bash
# Android
flutter build apk --release
flutter build appbundle --release

# iOS
flutter build ios --release

# Web
flutter build web --release
```

### Backend Configuration

For production, configure a robust backend API:

```dart
// Configure production API client
ApiClient productionClient = ApiClient(
  baseUrl: 'https://api.gaiaspace.com/v1',
  connectTimeout: const Duration(seconds: 30),
  receiveTimeout: const Duration(seconds: 30),
  interceptors: [
    AuthInterceptor(),
    LoggingInterceptor(),
    CacheInterceptor(),
  ],
);
```

### Deployment Considerations

For a production environment:

1. **API Security**: HTTPS, API keys, rate limiting
2. **Authentication**: Implement refresh tokens and JWT validation
3. **Analytics**: Firebase Analytics or similar for usage metrics
4. **Crash Reporting**: Firebase Crashlytics or similar
5. **Performance Monitoring**: Monitor app performance and API response times
6. **Push Notifications**: Firebase Cloud Messaging for real-time updates

Example Firebase configuration:

```dart
Future<void> initializeFirebase() async {
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  
  // Initialize Firebase services
  await FirebaseAnalytics.instance.setAnalyticsCollectionEnabled(true);
  FlutterError.onError = FirebaseCrashlytics.instance.recordFlutterError;
  
  if (kReleaseMode) {
    await FirebasePerformance.instance.setPerformanceCollectionEnabled(true);
  }
}
```

### CI/CD Setup

Example GitHub Actions workflow:

```yaml
name: Flutter CI/CD

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.x'
          channel: 'stable'
          
      - name: Install dependencies
        run: flutter pub get
        
      - name: Analyze code
        run: flutter analyze
        
      - name: Run tests
        run: flutter test
        
      - name: Build APK
        run: flutter build apk --release
        
      - name: Upload APK
        uses: actions/upload-artifact@v3
        with:
          name: app-release
          path: build/app/outputs/flutter-apk/app-release.apk
```

## API Integration

### RESTful API Endpoints

The Flutter app connects to the following backend API endpoints:

#### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/refresh-token` - Refresh access token
- `POST /api/auth/logout` - User logout

#### Users
- `GET /api/users` - List all users
- `GET /api/users/{id}` - Get user by ID
- `PUT /api/users/{id}` - Update a user profile
- `GET /api/users/me` - Get current user profile

#### Workspaces
- `GET /api/workspaces` - List all workspaces
- `GET /api/workspaces/{id}` - Get workspace by ID
- `POST /api/workspaces` - Create a new workspace
- `PUT /api/workspaces/{id}` - Update a workspace
- `DELETE /api/workspaces/{id}` - Delete a workspace
- `GET /api/workspaces/{id}/members` - List workspace members
- `POST /api/workspaces/{id}/members` - Add member to workspace

#### Projects
- `GET /api/projects` - List all projects
- `GET /api/projects/{id}` - Get project by ID
- `POST /api/projects` - Create a new project
- `PUT /api/projects/{id}` - Update a project
- `DELETE /api/projects/{id}` - Delete a project
- `PUT /api/projects/{id}/status` - Update project status

#### Repositories
- `GET /api/git/repositories` - List all repositories
- `GET /api/git/repositories/{id}` - Get repository by ID
- `POST /api/git/repositories` - Create a new repository
- `GET /api/git/repositories/{id}/branches` - List branches
- `POST /api/git/repositories/{id}/branches` - Create a branch

### GraphQL Integration

For more complex data requirements, the app utilizes GraphQL:

```dart
const String fetchWorkspaceWithProjectsQuery = r'''
  query WorkspaceWithProjects($id: ID!) {
    workspace(id: $id) {
      id
      name
      description
      createdAt
      createdBy {
        id
        username
        displayName
      }
      members {
        id
        username
        displayName
        role
      }
      projects {
        id
        name
        description
        status
        dueDate
        tasks {
          id
          title
          status
          assignee {
            id
            username
          }
        }
      }
    }
  }
''';

Future<Workspace> fetchWorkspaceWithProjects(String id) async {
  final QueryOptions options = QueryOptions(
    document: gql(fetchWorkspaceWithProjectsQuery),
    variables: {'id': id},
  );
  
  final result = await _client.query(options);
  
  if (result.hasException) {
    throw Exception(result.exception.toString());
  }
  
  return Workspace.fromJson(result.data!['workspace']);
}
```

## Contributing

We welcome contributions to Gaia-Space! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Coding Standards

- Follow Kotlin coding conventions
- Write unit tests for new functionality
- Document new features and API endpoints
- Keep UI templates consistent with existing design

## License

This project is licensed under the MIT License - see the LICENSE file for details.