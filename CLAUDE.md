# Project Guidelines and Commands

## Build and Development
- `npm install` - Install dependencies
- `npm start` - Start development server
- `expo start` - Start Expo development server

## Testing
- `npm test` - Run all tests
- `npm test -- -t "test name"` - Run specific test

## Linting and Formatting
- `npm run lint` - Run ESLint
- `npm run format` - Run Prettier formatter

## Code Style Guidelines
- **Imports**: Group imports by type (React, libraries, components, styles)
- **Formatting**: Use 2-space indentation, single quotes, semicolons
- **Components**: Use functional components with hooks
- **Naming**: PascalCase for components, camelCase for variables/functions
- **Error Handling**: Use try/catch for async operations, proper error boundaries
- **Types**: Prefer TypeScript interfaces for component props
- **State Management**: Use Apollo Client for GraphQL, React context for global state

## Project Structure
- React and React Native components with Expo tooling
- Apollo GraphQL for data fetching
- Express for any server components