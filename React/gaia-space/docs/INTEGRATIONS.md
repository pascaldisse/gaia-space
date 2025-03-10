# Integrations

This document covers the various third-party integrations available in Gaia Space and how to use them.

## Discord Integration

The Discord integration allows you to connect Discord servers to your Gaia Space workspaces, syncing channels for better collaboration.

### Setup Process

1. **Accessing the Integration**
   - Navigate to any workspace
   - Select the "Integrations" tab
   - Click on the Discord integration card

2. **Connection Flow**
   - **Step 1: Connect Account** - Authenticate with your Discord account
   - **Step 2: Select Server** - Choose which Discord server to connect
   - **Step 3: Select Channels** - Pick specific channels to sync with your workspace

3. **Managing Integrations**
   - View all connected Discord servers
   - Sync channels to get latest updates
   - Edit integration settings
   - Remove integrations when no longer needed

### Technical Implementation

The Discord integration uses Discord's OAuth2 flow and REST API to:
- Authenticate users through the official Discord OAuth flow
- Securely store and manage access/refresh tokens
- Fetch available servers (guilds) the user has access to
- Access channel information with proper permissions
- Sync messages and updates in real-time

#### Discord API Integration

The integration uses the Discord API v10 endpoints:
- `https://discord.com/api/v10/oauth2/token` - For authentication
- `https://discord.com/api/v10/users/@me/guilds` - To fetch user's servers
- `https://discord.com/api/v10/guilds/{guild_id}/channels` - To fetch channels

#### Data Flow

1. User initiates Discord connection through the UI
2. App generates Discord OAuth URL with required scopes
3. App launches external browser with the OAuth URL
4. User authenticates with Discord and grants permissions
5. Discord redirects to callback URL with authorization code
6. App securely exchanges the code for access and refresh tokens
7. Tokens are securely stored using Flutter Secure Storage
8. App uses the access token to:
   - Fetch user's Discord servers with proper error handling
   - Fetch channels from selected server
   - Create integration record in the database
9. Token refresh is handled automatically when tokens expire
10. Integration periodically syncs channel data to keep it up-to-date

#### Implementation Details

The integration is built using:
- `discord_service.dart` - Core service handling Discord API communication
  - Uses Dio HTTP client for API requests
  - Implements token management and refresh
  - Handles errors with proper logging
  - Provides methods for all Discord API operations
- `discord_integration.dart` - Data models representing the integration
  - Immutable data models with proper serialization
  - Support for all channel types and properties
- `discord_integration_screen.dart` - UI for managing integrations
  - Full OAuth flow with proper status feedback
  - Comprehensive error handling with recovery options
  - Server selection with search capabilities
  - Channel selection with category organization
- `discord_provider.dart` - Riverpod state management
  - Reactive state management for all integration data
  - Proper loading, error, and success states
  - Optimized refresh and update operations

### Testing

The Discord integration includes comprehensive test coverage:
- Unit tests for data models and serialization
- Tests for service methods and API communication
- End-to-end tests for the integration workflow

For testing the integration, refer to `test/discord_integration_test.dart`.

### Permissions Required

Discord integration requires the following permissions:
- `identify` - To identify the user
- `guilds` - To access the list of servers
- `channels` - To access channel information
- `messages.read` - To read messages for syncing

### Developer Setup

To set up the Discord integration for development or production:

1. **Create a Discord Application**
   - Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Note your Client ID and Client Secret

2. **Configure OAuth Settings**
   - In the OAuth2 section, add redirect URLs:
     - For local testing: `http://localhost:8080/auth/discord/callback`
     - For production: `https://gaia-space.app/auth/discord/callback`
   - Set up the proper scopes: `identify`, `guilds`, `bot`

3. **Update Application Credentials**
   - In `discord_service.dart`, update the client credentials:
     ```dart
     static const String _clientId = 'YOUR_DISCORD_CLIENT_ID';
     static const String _clientSecret = 'YOUR_DISCORD_CLIENT_SECRET';
     ```
   - For production, these should be environment variables or secure configuration

4. **Setup Callback Handling**
   - Implement a callback handler for the redirect URL
   - Parse the authorization code from the URL parameters
   - Call `exchangeCodeForToken` with the code and redirect URI

5. **Testing the Integration**
   - For local testing, you can use the manual code entry dialog
   - For real device testing, set up proper deep linking
   - For production, implement full redirect handling

## Planned Integrations

### GitHub/GitLab Integration

Connect your code repositories directly to workspaces:
- Track commits and pull requests
- Link issues to workspace tasks
- Trigger builds from the workspace

### Slack Integration

Two-way communication between Slack and Gaia Space:
- Sync channels and messages
- Receive notifications in Slack
- Send updates from workspace to Slack

### Jira/Trello Integration

Connect task management tools:
- Sync tasks and issues
- Update status from either platform
- Link work items across systems

### Cloud Storage Integration

Connect cloud storage services:
- Google Drive
- Dropbox
- OneDrive

## Integration Development

### Creating New Integrations

To develop a new integration, implement the following components:

1. **Models**:
   - Create integration model class in `lib/core/models/`
   - Include methods for serialization/deserialization

2. **Service**:
   - Create service class in `lib/core/services/`
   - Implement authentication and API methods

3. **State Management**:
   - Create providers in `lib/core/providers/`
   - Set up state management for the integration

4. **UI**:
   - Create integration screen in `lib/ui/screens/`
   - Implement connection flow UI

### Integration Testing

Each integration should include:
- Unit tests for models and services
- Integration tests for API communication
- UI tests for the connection flow
- End-to-end workflow tests

See the Discord integration tests for a reference implementation.