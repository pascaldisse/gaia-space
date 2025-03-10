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
- Authenticate users
- Fetch available servers (guilds)
- Access channel information
- Sync messages and updates

#### Data Flow

1. User initiates Discord connection
2. App generates Discord OAuth URL with required scopes
3. User authenticates with Discord and grants permissions
4. Discord returns an authorization code
5. App exchanges the code for access and refresh tokens
6. App uses the access token to:
   - Fetch user's Discord servers (guilds)
   - Fetch channels from selected server
   - Create integration record in the database
7. Integration periodically syncs channel data

#### Implementation Details

The integration is built using:
- `discord_service.dart` - Core service handling Discord API communication
- `discord_integration.dart` - Data models representing the integration
- `discord_integration_screen.dart` - UI for managing integrations
- `discord_provider.dart` - Riverpod state management

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