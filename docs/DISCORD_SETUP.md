# Discord Integration Setup Guide

This guide walks you through setting up the Discord integration for Gaia Space.

## 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name (e.g., "Gaia Space")
3. In your application dashboard, note the **Client ID** and **Client Secret**

## 2. Configure OAuth2 Settings

1. In the left sidebar, select "OAuth2"
2. Add your redirect URLs:
   - For development: `http://localhost:8080/auth/discord/callback`
   - For production: `https://gaia-space.app/auth/discord/callback`
3. Save changes

## 3. Set Bot Permissions

1. In the left sidebar, select "Bot"
2. Under "Privileged Gateway Intents", enable:
   - Server Members Intent
   - Message Content Intent
3. Under "Bot Permissions", enable:
   - Read Messages/View Channels
   - Send Messages
   - Read Message History
4. Save changes

## 4. Update Credentials in the App

1. Open `/lib/core/services/discord_service.dart`
2. Update the client credentials:
   ```dart
   static const String _clientId = 'YOUR_DISCORD_CLIENT_ID';
   static const String _clientSecret = 'YOUR_DISCORD_CLIENT_SECRET';
   ```
   
   For production, consider using environment variables through Flutter's `--dart-define` feature:
   ```dart
   static const String _clientId = String.fromEnvironment('DISCORD_CLIENT_ID');
   static const String _clientSecret = String.fromEnvironment('DISCORD_CLIENT_SECRET');
   ```

## 5. Add URL Handling for Redirect

For mobile and desktop apps, you need to set up deep linking to handle the OAuth redirect:

### Flutter Setup

1. Update `android/app/src/main/AndroidManifest.xml` to handle your redirect URL
2. Update `ios/Runner/Info.plist` to handle your redirect URL

Example intent filter for Android:
```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data
    android:scheme="https"
    android:host="gaia-space.app"
    android:pathPrefix="/auth/discord/callback" />
</intent-filter>
```

## 6. Testing the Integration

1. Start the application
2. Navigate to a workspace
3. Open the Discord integration screen
4. Click "Connect Discord Account"
5. Follow the OAuth flow
6. Select a server and channels to integrate
7. Verify the integration works by checking synced channels

## Troubleshooting

- **Authentication Errors**: Make sure your client ID and secret are correct
- **Redirect Issues**: Verify your redirect URL is correctly registered in the Discord Developer Portal
- **Permission Errors**: Ensure the user has granted the necessary permissions
- **Rate Limiting**: Discord has rate limits; implement proper backoff if needed

## Security Considerations

- Never hardcode your client secret in the app
- Use secure storage for tokens
- Implement PKCE for OAuth flow if possible
- Validate all incoming data from the Discord API