# Gaia Space Architecture

## Overview

Gaia Space follows a feature-based, clean architecture approach to create a maintainable and scalable application. The application is built with Flutter and uses Riverpod for state management.

## Architecture Layers

The application is structured with the following layers:

### 1. Presentation Layer (UI)

- Located in `lib/ui/`
- Contains all UI components, screens, and widgets
- Uses Riverpod providers to consume application state
- Follows Material Design guidelines with custom theming

### 2. Application Layer (Services)

- Located in `lib/core/services/`
- Contains business logic and use cases
- Coordinates data operations and user actions
- Handles application-specific rules and workflows

### 3. Domain Layer (Models)

- Located in `lib/core/models/`
- Defines core business entities
- Contains pure Dart classes with business logic
- Independent from external frameworks and UI

### 4. Data Layer (Repositories & Providers)

- Located in `lib/core/repositories/` and `lib/data/providers/`
- Abstracts data sources (API, local storage)
- Handles data persistence and retrieval
- Manages caching and offline capabilities

## State Management

Gaia Space uses Riverpod for state management, which offers several advantages:

- Dependency injection
- Reactive programming
- Testing support
- Reducers and side effects
- Provider overrides for testing

## Folder Structure

```
lib/
├── core/
│   ├── models/         # Domain entities
│   ├── providers/      # State providers
│   ├── repositories/   # Data access
│   ├── services/       # Business logic
│   └── utils/          # Utilities
├── data/
│   └── providers/      # Additional providers
├── main.dart           # App entry point
└── ui/
    ├── screens/        # App screens
    ├── themes/         # Styling
    └── widgets/        # Reusable components
```

## Data Flow

1. User interacts with the UI
2. UI triggers a state change via a provider
3. Service layer processes the request
4. Repository layer handles data operations
5. Updated state flows back through providers
6. UI automatically updates to reflect the new state

## Architecture Principles

- **Separation of Concerns**: Each layer has a specific responsibility
- **Dependency Rule**: Dependencies point inward (UI → Services → Repositories)
- **Testability**: Each component can be tested in isolation
- **Modularity**: Features can be developed independently
- **Single Responsibility**: Each class has one reason to change