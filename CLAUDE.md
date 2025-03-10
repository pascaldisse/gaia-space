# Project Guidelines and Commands

## Build and Development
- `flutter pub get` - Install dependencies
- `flutter run` - Start development server
- `flutter run -d chrome` - Start on web browser
- `flutter run -d ios` - Start on iOS simulator
- `flutter run -d android` - Start on Android emulator

## Testing
- `flutter test` - Run all tests
- `flutter test test/path/to/test_file.dart` - Run specific test
- `flutter test --coverage` - Generate test coverage report
- `flutter test test/discord_integration_test.dart` - Run Discord integration tests

## Linting and Analysis
- `flutter analyze` - Run analyzer on project
- `flutter format .` - Format code with dart formatter
- `flutter pub run build_runner build` - Generate code for models and services

## Code Style Guidelines
- **Imports**: Group imports:
  1. Dart/Flutter imports
  2. External library imports
  3. Project imports (models, services, etc.)
- **Formatting**: 
  - Standard Flutter formatting
  - Prefer `const` for widgets
- **Models**:
  - Use Equatable for immutable data models
  - Implement copyWith, toJson, fromJson methods
- **Components**: 
  - Use functional/stateless widgets where possible
  - Keep widgets focused on single responsibility
- **Naming**: 
  - PascalCase for widgets, classes, and files
  - camelCase for functions, methods, and variables
  - snake_case for file names
- **Error Handling**: 
  - Use try/catch for async operations
  - Log errors with AppLogger for contextual information
- **State Management**: 
  - Flutter Riverpod for state management
  - ConsumerWidget for stateful components
  - FutureProvider/StateProvider for async operations