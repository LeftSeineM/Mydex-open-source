import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'package:mydex_mobile/pages/native_router.dart';
import 'client_test.dart' show fixture;
import 'new_project_usage_test.dart' show NewProjectApi;

class RouterFixtureApi extends GatewayApi {
  final calls = <Json>[];
  RouterFixtureApi()
      : super(const ConnectionSettings(baseUrl: 'https://fixture.invalid'));
  @override
  Future<Json> get(String path) async => {
        'router': {'device': 'laptop', 'session': 'desktop:router-fixture'},
        'jobs': [
          {
            'id': 'job',
            'name': '机械臂抓取验证',
            'contextRevision': 1,
            'scope': ['laptop~desktop:worker'],
            'execution': {
              'sessions': ['laptop~desktop:worker'],
              'workspaces': [],
              'revision': 1
            },
            'paused': false
          }
        ],
        'tasks': [
          {
            'id': 'task',
            'dispatchId': 'fixture-stable-dispatch-123456',
            'job': 'job',
            'session': 'laptop~desktop:worker',
            'state': 'queued',
            'package': {'goal': '核对碰撞边界与测试证据'},
            'node': {'title': '碰撞修复', 'toolId': 'codex', 'device': 'laptop'}
          }
        ],
      };
  @override
  Future<Json> post(String path, Json body, {String? requestId}) async {
    calls.add(body);
    return {};
  }
}

void main() {
  test(
      'DSH native creation requires exact project and preserves desktop defaults',
      () async {
    final c = fixture(),
        api = NewProjectApi(
            const ConnectionSettings(baseUrl: 'https://fixture.invalid'));
    c.api = api;
    c.toolId = 'deepseek';
    c.tools = [
      {
        'id': 'deepseek',
        'deviceId': c.deviceId,
        'capabilities': {'create': true, 'send': true}
      }
    ];
    c.projects = [
      {
        'id': 'dsh-project',
        'deviceId': c.deviceId,
        'toolId': 'deepseek',
        'name': 'DSH 项目'
      }
    ];
    c.newTask();
    expect(c.toolCanCreate, isTrue);
    expect(await c.send('只回复验证标记'), isFalse);
    expect(api.creation, isNull);
    c.chooseProject('dsh-project');
    c.newTask();
    expect(await c.send('只回复验证标记'), isTrue);
    expect(api.creation?['projectId'], 'dsh-project');
    expect(api.creation?['toolId'], 'deepseek');
    expect(api.creation?.containsKey('model'), isFalse);
    expect(api.creation?.containsKey('apiKey'), isFalse);
    c.dispose();
  });
  setUpAll(() async {
    for (final entry in {
      'sans-serif': 'C:/Windows/Fonts/msyh.ttc',
      'MaterialIcons':
          'D:/Software/NFSeeBuild/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf'
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
  for (final width in [390.0, 760.0]) {
    testWidgets(
        'private Router fits $width and sends only the selected persisted task',
        (tester) async {
      await tester.binding.setSurfaceSize(Size(width, 940));
      final c = fixture(), api = RouterFixtureApi();
      c.api = api;
      await tester.pumpWidget(MaterialApp(
          theme: ThemeData(
              fontFamily: 'sans-serif',
              colorScheme:
                  ColorScheme.fromSeed(seedColor: const Color(0xff486781)),
              useMaterial3: true),
          home: RepaintBoundary(
              key: const ValueKey('capture'),
              child: NativeRouterPage(controller: c))));
      await tester.pumpAndSettle();
      expect(find.text('待派发'),
          findsNothing); // State is composed with native identity.
      expect(find.text('派发'), findsOneWidget);
      expect(tester.takeException(), isNull);
      final boundary = tester.renderObject<RenderRepaintBoundary>(
          find.byKey(const ValueKey('capture')));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1.5);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('build/router-review/router-${width.toInt()}.png');
        await file.parent.create(recursive: true);
        await file.writeAsBytes(data!.buffer.asUint8List());
      });
      await tester.tap(find.text('派发'));
      await tester.pumpAndSettle();
      expect(api.calls.single['operation'], 'dispatch');
      expect(api.calls.single['args'], {'taskId': 'task'});
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      await tester.binding.setSurfaceSize(null);
    });
  }
}
