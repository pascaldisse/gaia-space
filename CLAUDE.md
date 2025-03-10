# Project Guidelines and Commands

## Build and Development
- `npm install` - Install dependencies
- `npm start` - Start development server
- `expo start` - Start Expo development server
- `expo start --ios` - Start on iOS simulator
- `expo start --android` - Start on Android emulator
- `expo start --web` - Start on web browser

## Testing
- `npm test` - Run all tests
- `npm test -- -t "test name"` - Run specific test by name
- `npm test -- --watch` - Run tests in watch mode
- `npm test -- --coverage` - Generate test coverage report

## Linting and Formatting
- `npm run lint` - Run ESLint on project
- `npm run lint -- --fix` - Run ESLint with auto-fix
- `npm run format` - Run Prettier formatter
- `npm run format:check` - Check formatting without changing files

## Code Style Guidelines
- **Imports**: Group imports by type in this order:
  1. React/React Native imports
  2. External library imports
  3. Component imports
  4. Utility/helper imports
  5. Style/asset imports
- **Formatting**: 
  - 2-space indentation
  - Single quotes for strings
  - Semicolons required
  - 80-character line length limit
- **Components**: 
  - Use functional components with hooks
  - One component per file
  - Keep components focused on single responsibility
- **Naming**: 
  - PascalCase for components and files containing components
  - camelCase for variables, functions, and utility files
  - ALL_CAPS for constants
- **Error Handling**: 
  - Use try/catch for async operations
  - Implement proper error boundaries
  - Log errors with contextual information
- **Types**: 
  - Define TypeScript interfaces for all component props
  - Export types/interfaces from dedicated files
  - Use explicit return types for non-trivial functions
- **State Management**: 
  - Apollo Client for GraphQL data
  - React Context for app-wide state
  - useState/useReducer for component-level state

## Project Structure
- React and React Native components with Expo tooling
- Apollo GraphQL for data fetching
- Express for server-side functionality
- Follows feature-based organization pattern