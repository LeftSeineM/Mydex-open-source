import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/main.dart';
import 'package:mydex_mobile/controller.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/storage.dart';
import 'package:mydex_mobile/pages/settings.dart';
import 'package:mydex_mobile/widgets/mesh_connection.dart';

void main() {
  testWidgets('mesh connection settings phone and unfolded screenshots',
      (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        const MethodChannel('dev.mydex/mesh'),
        (_) async => '{"state":"Running","authUrl":""}');
    await tester.runAsync(() async {
      for (final item in [
        ['sans-serif', 'C:/Windows/Fonts/msyh.ttc'],
        [
          'MaterialIcons',
          '${Platform.environment['FLUTTER_ROOT']}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf'
        ]
      ]) {
        final file = File(item[1]);
        if (await file.exists()) {
          await (FontLoader(item[0])
                ..addFont(Future.value(
                    ByteData.sublistView(await file.readAsBytes()))))
              .load();
        }
      }
    });
    final c = AppController(LocalStorage());
    c.settings = ConnectionSettings(
        baseUrl: 'https://100.64.0.1:18443',
        token: 'demo-only-not-a-real-token',
        fingerprint: '0' * 64,
        mesh: true);
    for (final width in [390.0, 720.0]) {
      await tester.binding.setSurfaceSize(Size(width, 844));
      await tester.pumpWidget(MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: appTheme(Brightness.light),
          home: SettingsPage(controller: c)));
      await tester.pump();
      await tester.ensureVisible(find.byType(MeshConnection));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await expectLater(find.byType(MaterialApp),
          matchesGoldenFile('goldens/mesh-${width.round()}.png'));
      await tester.pumpWidget(const SizedBox());
    }
    c.dispose();
    tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('dev.mydex/mesh'), null);
    debugDefaultTargetPlatformOverride = null;
    await tester.binding.setSurfaceSize(null);
  }, tags: ['golden']);
}
