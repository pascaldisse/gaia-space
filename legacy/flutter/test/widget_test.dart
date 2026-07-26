// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:gaia_space/main.dart';
import 'package:gaia_space/core/utils/app_logger.dart';

void main() {
  setUpAll(() async {
    // AppLogger uses a `late` static Logger that only becomes usable
    // after init() runs; GaiaSpaceApp's screens log during construction.
    await AppLogger.init();
  });

  testWidgets('App smoke test: builds without throwing', (WidgetTester tester) async {
    // Use a generous device size so the real login/home screens the
    // splash flow navigates to (see below) don't overflow the test
    // surface the way they would on the default 800x600 canvas.
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    // Build our app and trigger a frame.
    await tester.pumpWidget(
      const ProviderScope(
        child: GaiaSpaceApp(),
      ),
    );

    // The real GaiaSpaceApp boots into an animated SplashScreen that
    // schedules its own timers (auto-navigation, connectivity check,
    // 15s failsafe). Advance the virtual clock far enough for the
    // splash flow to finish navigating and all its timers to fire,
    // so the binding doesn't report pending timers at teardown.
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(seconds: 5));
    }
    expect(tester.takeException(), isNull);
  });
}
