# Setup Guide

This guide will help you set up the Gaia Space application for development.

## Prerequisites

Before you begin, ensure you have the following installed:

- [Flutter SDK](https://flutter.dev/docs/get-started/install) (version 3.0.0 or later)
- [Dart SDK](https://dart.dev/get-dart) (version 3.0.0 or later)
- [Git](https://git-scm.com/downloads) for version control
- [Android Studio](https://developer.android.com/studio) or [VS Code](https://code.visualstudio.com/) with Flutter extensions

## Clone the Repository

```bash
git clone https://github.com/pascaldisse/gaia-space.git
cd gaia-space
```

## Install Dependencies

Install all the required packages by running:

```bash
flutter pub get
```

## Run the Application

To run the application in debug mode:

```bash
flutter run
```

To run on a specific device, use:

```bash
flutter devices # List available devices
flutter run -d <device_id> # Run on a specific device
```

## Available Build Commands

### Debug Builds

```bash
# For Android
flutter build apk --debug

# For iOS
flutter build ios --debug

# For Web
flutter build web --debug
```

### Release Builds

```bash
# For Android
flutter build apk --release
flutter build appbundle --release # For Google Play Store

# For iOS
flutter build ios --release # Further steps in Xcode required for App Store

# For Web
flutter build web --release
```

## Project Structure

```
lib/
├── core/           # Core functionality
│   ├── models/     # Data models
│   ├── providers/  # State providers
│   ├── services/   # Business logic
│   └── utils/      # Utilities and helpers
├── data/           # Data handling
│   └── providers/  # Data providers
├── ui/             # User interface
│   ├── screens/    # App screens
│   ├── themes/     # App styling
│   └── widgets/    # Reusable components
└── main.dart       # App entry point
```

## Configuration

### Environment Variables

The app supports different environments (development, staging, production):

1. Create a `.env` file in the project root (for development)
2. Add necessary environment variables

Example `.env` file:

```
API_URL=https://api.dev.gaiaspace.com
AUTH_CLIENT_ID=your_client_id
AUTH_REDIRECT_URI=com.gaiaspace.app://login-callback
```

## Running Tests

```bash
# Run all tests
flutter test

# Run specific test file
flutter test test/path/to/test_file.dart

# Run with coverage
flutter test --coverage
```

## Code Formatting

```bash
# Format code
flutter format .

# Analyze code for issues
flutter analyze
```

## Building for Production

Before deploying to production:

1. Update the version in `pubspec.yaml`
2. Configure the correct environment variables
3. Run a full test suite
4. Build the release version for your target platform(s)

## Troubleshooting

### Common Issues

1. **Flutter SDK not found**: Ensure Flutter is properly installed and added to your PATH
2. **Dependency conflicts**: Try `flutter clean` followed by `flutter pub get`
3. **Build failures**: Check for any compilation errors in your code
4. **Device not detected**: Ensure USB debugging is enabled (for Android) or the device is properly connected

### Getting Help

If you encounter issues not covered here:

1. Check the [Flutter documentation](https://flutter.dev/docs)
2. Search for solutions on [Stack Overflow](https://stackoverflow.com/questions/tagged/flutter)
3. Open an issue on the GitHub repository