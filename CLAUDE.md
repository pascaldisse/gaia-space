# Project Guidelines and Commands

## Build and Development
- `flutter pub get` - Install dependencies
- `flutter run` - Start development server
- `flutter run -d chrome` - Start on web browser
- `flutter run -d ios` - Start on iOS simulator
- `flutter run -d android` - Start on Android emulator

## Testing
- `flutter test` - Run all tests
- `flutter test test/discord_integration_test.dart` - Run specific test file
- `flutter test test/custom_command_test.dart` - Test custom commands
- `flutter test --coverage` - Generate test coverage report

## Linting and Analysis
- `flutter analyze` - Run analyzer on project
- `flutter format .` - Format code with dart formatter
- `flutter pub run build_runner build` - Generate code for models
- `flutter pub run build_runner watch` - Generate code automatically on changes

## Git Operations
- `git branch` - List local branches
- `git checkout -b feature/name` - Create and switch to new branch
- `git commit -m "Message"` - Commit changes with message
- `git push origin feature/name` - Push branch to remote

## Code Style Guidelines
- **Imports**: Order imports: 1) Dart/Flutter, 2) External libraries, 3) Project imports
- **Formatting**: Use standard Flutter formatting, prefer `const` for widgets
- **Models**: Use Equatable with copyWith, toJson, fromJson methods
- **Components**: Single responsibility, stateless widgets when possible 
- **Naming**: PascalCase (widgets/classes), camelCase (methods/variables), snake_case (files)
- **Error Handling**: Use AppLogger with context (debug/info/warning/error) inside try/catch
- **State Management**: Flutter Riverpod (ConsumerWidget, FutureProvider, StateProvider)
- **Documentation**: Add comments for complex logic, document public APIs
- **Testing**: Write unit tests for all models and services, widget tests for UI