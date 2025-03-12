# Project Guidelines and Commands

## Build and Development
- `flutter pub get` - Install dependencies
- `flutter run` - Start development server
- `flutter run -d chrome` - Start on web browser
- `flutter run -d ios` - Start on iOS simulator
- `flutter run -d android` - Start on Android emulator

## Testing
- `flutter test` - Run all tests
- `flutter test test/discord_integration_test.dart` - Run specific test
- `flutter test --coverage` - Generate test coverage report

## Linting and Analysis
- `flutter analyze` - Run analyzer on project
- `flutter format .` - Format code with dart formatter
- `flutter pub run build_runner build` - Generate code for models and services

## Code Style Guidelines
- **Imports**: Group imports: Dart/Flutter, external libraries, project imports
- **Formatting**: Use standard Flutter formatting, prefer `const` for widgets
- **Models**: Use Equatable for immutable data models with copyWith, toJson, fromJson methods
- **Components**: Create functional/stateless widgets where possible, maintain single responsibility
- **Naming**: PascalCase for widgets/classes, camelCase for functions/variables, snake_case for files
- **Error Handling**: Use try/catch for async operations, log errors with AppLogger
- **State Management**: Use Flutter Riverpod with ConsumerWidget, FutureProvider, StateProvider