import 'dart:io';
import 'package:mydex_mobile/main.dart';
import 'package:mydex_mobile/pages/home.dart';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'package:mydex_mobile/widgets/new_task_project.dart';
import 'package:mydex_mobile/pages/usage.dart';
import 'client_test.dart' show fixture;

class NewProjectApi extends GatewayApi {
  NewProjectApi(super.settings);
  Json? creation;
  @override
  Future<Json> post(String path, Json body, {String? requestId}) async {
    creation = body;
    return {'id': 'mini~new', 'title': 'new'};
  }

  @override
  Future<Json> get(String path) async => path.contains('/usage')
      ? {
          'available': true,
          'credits': {'balance': '12.3456', 'unlimited': false},
          'windows': [
            {
              'label': '5 小时',
              'remainingPercent': 80,
              'usedPercent': 20,
              'resetsAt': null
            }
          ],
        }
      : {'id': 'mini~new', 'title': 'new', 'messages': []};
}

void main() {
  testWidgets(
      'new conversation exposes local projects, inherits current project and sends selection',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    await tester.runAsync(() async {
      for (final entry in {
        'sans-serif': 'C:/Windows/Fonts/msyh.ttc',
        'MaterialIcons':
            '${Platform.environment['FLUTTER_ROOT']}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf'
      }.entries) {
        final f = File(entry.value);
        if (f.existsSync()) {
          await (FontLoader(entry.key)
                ..addFont(
                    Future.value(ByteData.sublistView(f.readAsBytesSync()))))
              .load();
        }
      }
    });
    final c = fixture();
    c.projects = [
      {'id': 'a', 'deviceId': 'mini', 'name': '项目 A'},
      {'id': 'b', 'deviceId': 'mini', 'name': '项目 B'},
      {'id': 'other', 'deviceId': 'other', 'name': '其他电脑'}
    ];
    c.selected!['projectId'] = 'a';
    c.newTask();
    expect(c.projectId, 'a');
    final api = NewProjectApi(c.settings);
    c.api = api;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ListenableBuilder(
                listenable: c,
                builder: (_, __) => NewTaskProjectPicker(controller: c)))));
    await tester.tap(find.byKey(const ValueKey('new-task-project')));
    await tester.pumpAndSettle();
    expect(find.text('其他电脑'), findsNothing);
    await tester.tap(find.text('项目 B').last);
    await tester.pumpAndSettle();
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pumpAndSettle();
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/new-task-project.png'));
    expect(c.projectId, 'b');
    expect(c.composing, true);
    expect(await c.send('请检查项目'), true);
    expect(api.creation?['projectId'], 'b');
    expect(api.creation?['deviceId'], 'mini');
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  testWidgets('quota page renders remaining and used separately',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final c = fixture();
    c.api = NewProjectApi(c.settings);
    await tester.pumpWidget(MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: appTheme(Brightness.light),
        home: Scaffold(body: UsagePanel(controller: c))));
    await tester.pumpAndSettle();
    expect(find.text('5 小时 · 剩余 80%'), findsOneWidget);
    expect(find.text('已用 20%'), findsOneWidget);
    expect(find.text('额外额度余额：12.3456（接口原值）'), findsOneWidget);
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/subscription-usage.png'));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  testWidgets(
      'new project selection fits a small screen with large text and keyboard',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 640));
    final c = fixture();
    c.newTask();
    await tester.pumpWidget(MaterialApp(
        theme: appTheme(Brightness.light),
        home: MediaQuery(
            data: const MediaQueryData(
                size: Size(320, 640),
                textScaler: TextScaler.linear(2),
                viewInsets: EdgeInsets.only(bottom: 200)),
            child: HomePage(controller: c))));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
}
