import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mydex_mobile/main.dart' as app;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('iOS native bridge, Keychain and first-run settings',
      (tester) async {
    const storage = FlutterSecureStorage();
    const key = 'mydex.integration.probe';
    try {
      await storage.write(key: key, value: 'local-simulator-probe');
      expect(await storage.read(key: key), 'local-simulator-probe');
    } finally {
      await storage.delete(key: key);
    }
    const channel = MethodChannel('dev.mydex/device');
    final version =
        await channel.invokeMapMethod<String, dynamic>('appVersion');
    expect(version?['name'], isNotEmpty);
    expect(version?['code'], greaterThan(0));
    // Checks the native method exists; a simulator cannot verify physical haptics.
    await channel.invokeMethod<void>('vibrate');
    app.main();
    await tester.pumpAndSettle();
    expect(find.byType(MaterialApp), findsOneWidget);
    expect(tester.takeException(), isNull);
    await binding.takeScreenshot('ios-first-launch');
    await tester.tap(find.byTooltip('连接设置'));
    await tester.pumpAndSettle();
    expect(find.text('连接与设置'), findsOneWidget);
    await binding.takeScreenshot('ios-settings-top');
    // The settings list builds off-screen children lazily on a phone.
    await tester.scrollUntilVisible(
      find.text('iOS 测试版本'),
      350,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.pumpAndSettle();
    expect(find.text('iOS 测试版本'), findsOneWidget);
    expect(find.text('下载更新'), findsNothing);
    expect(tester.takeException(), isNull);
    await binding.takeScreenshot('ios-settings');
  });
}
