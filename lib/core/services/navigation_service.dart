import 'package:flutter/material.dart';

class NavigationService {
  static final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  static NavigatorState get navigator => navigatorKey.currentState!;

  static Future<T?> navigateTo<T>(String routeName, {Object? arguments}) {
    return navigator.pushNamed<T>(routeName, arguments: arguments);
  }

  static Future<T?> navigateToReplacement<T>(String routeName, {Object? arguments}) {
    return navigator.pushReplacementNamed<T, dynamic>(
      routeName,
      arguments: arguments,
    );
  }

  static Future<T?> navigateToAndClearStack<T>(String routeName, {Object? arguments}) {
    return navigator.pushNamedAndRemoveUntil<T>(
      routeName,
      (Route<dynamic> route) => false,
      arguments: arguments,
    );
  }

  static Future<T?> navigateWithWidget<T>(Widget widget) {
    return navigator.push<T>(
      MaterialPageRoute(builder: (context) => widget),
    );
  }

  static void pop<T>([T? result]) {
    if (navigator.canPop()) {
      navigator.pop<T>(result);
    }
  }

  static void popUntil(String routeName) {
    navigator.popUntil(ModalRoute.withName(routeName));
  }
}