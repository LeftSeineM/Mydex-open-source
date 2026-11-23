import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/main.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'package:mydex_mobile/pages/tracking_board.dart';
import 'client_test.dart' show fixture;

Json projectFixture() => {
      'id': 'p',
      'name': '机械臂抓取',
      'goal': '提高复杂摆放下的抓取稳定性',
      'updatedAt': 1793767200000,
      'organizedAt': 1793767200000,
      'organizing': false,
      'routerSummary': '碰撞修复与实验正在推进；复核等待实验结果。',
      'outline': {
        'groups': [
          {
            'id': 'g',
            'title': '修复与验证',
            'summary': '先检查修复，再比较实验结果',
            'sourceKeys': ['a', 'b']
          }
        ],
        'relations': []
      },
      'sources': [
        {
          'key': 'a',
          'worker': 'mini/mini',
          'session': 'mini~a',
          'title': '碰撞边界修复',
          'toolId': 'codex',
          'state': 'Running',
          'online': true,
          'model': '6.1 sol',
          'latest': '已完成边界修改，正在检查回归案例。',
          'lastObserved': 1793767200000
        },
        {
          'key': 'b',
          'worker': 'mini/mini',
          'session': 'mini~b',
          'title': '对照实验结果',
          'toolId': 'deepseek',
          'state': 'Completed',
          'online': true,
          'latest': '已返回本轮实验指标，等待人工复核。',
          'lastObserved': 1793767200000
        },
      ],
      'events': [
        {
          'id': 'e',
          'at': 1793767200000,
          'sourceKey': 'a',
          'title': '发现新回复：碰撞边界修复',
          'detail': '已完成修改，开始检查回归案例。'
        }
      ]
    };

class BoardApi extends GatewayApi {
  final calls = <Json>[];
  BoardApi()
      : super(const ConnectionSettings(baseUrl: 'https://fixture.invalid'));
  @override
  Future<Json> get(String path) async => {
        'schema': 2,
        'router': {'model': 'DeepSeek-V4.1-Flash-1017'},
        'projects': [projectFixture()]
      };
  @override
  Future<Json> post(String path, Json body, {String? requestId}) async {
    calls.add(body);
    if (body['operation'] == 'tracking_catalog') {
      return {
        'workers': [
          {'id': 'mini/mini', 'name': '小主机'}
        ],
        'projects': [
          {'id': 'original', 'name': '机械臂抓取', 'toolId': 'codex'}
        ],
        'sessions': [
          for (final x in ['a', 'b'])
            {
              'key': x,
              'worker': 'mini/mini',
              'session': 'mini~$x',
              'projectId': 'original',
              'toolId': 'codex',
              'title': x == 'a' ? '碰撞边界修复' : '对照实验结果',
              'status': 'Running'
            }
        ]
      };
    }
    if (body['operation'] == 'tracking_discuss') {
      return {
        'discussion': {'answer': '复核等待实验；修复可以独立推进。'}
      };
    }
    if (body['operation'] == 'tracking_original') {
      return {
        'worker': 'mini/mini',
        'session': 'mini~a',
        'task': {
          'title': '碰撞边界修复',
          'messages': [
            {'id': 'm', 'role': 'agent', 'type': 'text', 'text': '这是一条原会话证据。'}
          ]
        }
      };
    }
    return {'project': projectFixture()};
  }
}

Future<void> fonts(WidgetTester tester) async {
  await tester.runAsync(() async {
    for (final e in {
      'sans-serif': 'C:/Windows/Fonts/msyh.ttc',
      'MaterialIcons':
          'D:/Software/NFSeeBuild/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf'
    }.entries) {
      final f = File(e.value);
      if (f.existsSync()) {
        await (FontLoader(e.key)
              ..addFont(
                  Future.value(ByteData.sublistView(f.readAsBytesSync()))))
            .load();
      }
    }
  });
}

Future<void> shot(WidgetTester tester, String file) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(
      find.byKey(const ValueKey('capture')));
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1.5);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    final out = File('build/tracking-review/$file.png');
    await out.parent.create(recursive: true);
    await out.writeAsBytes(data!.buffer.asUint8List());
  });
}

void main() {
  testWidgets(
      'private project entry and ordinary computer entry remain separate',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 940));
    final c = fixture(), api = BoardApi();
    c.api = api;
    c.browse();
    c.devices.add({
      'id': 'superagent',
      'name': 'Superagent · 测试',
      'online': true,
      'desktopOnline': true
    });
    c.tools.add({
      'id': 'superagent',
      'name': 'Superagent',
      'deviceId': 'superagent',
      'capabilities': {'send': true, 'create': true}
    });
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('项目进展台 · 测试').last);
    await tester.pumpAndSettle();
    expect(find.byType(TrackingBoardPage), findsOneWidget);
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('工作电脑').last);
    await tester.pumpAndSettle();
    expect(find.byType(TrackingBoardPage), findsNothing);
    expect(c.deviceId, 'mini');
    expect(c.toolId, 'codex');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  for (final width in [390.0, 760.0]) {
    testWidgets('tree, timeline and scoped Router discussion at width $width',
        (tester) async {
      await fonts(tester);
      await tester.binding.setSurfaceSize(Size(width, 940));
      final c = fixture(), api = BoardApi();
      c.api = api;
      c.deviceId = 'superagent';
      c.toolId = 'superagent';
      await tester.pumpWidget(RepaintBoundary(
          key: const ValueKey('capture'),
          child: MaterialApp(
              theme: appTheme(Brightness.light),
              home: Scaffold(body: TrackingBoardPage(controller: c)))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('机械臂抓取').first);
      await tester.pumpAndSettle();
      expect(find.text('修复与验证'), findsOneWidget);
      await shot(tester, 'tree-${width.toInt()}');
      await tester.tap(find.text('时间脉络'));
      await tester.pumpAndSettle();
      expect(find.text('发现新回复：碰撞边界修复'), findsOneWidget);
      await shot(tester, 'timeline-${width.toInt()}');
      await tester.tap(find.text('树状层次'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byType(Checkbox).first);
      await tester.tap(find.byType(Checkbox).first);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('围绕所选节点提问'));
      await tester.tap(find.text('围绕所选节点提问'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, '现在为什么卡住？');
      await tester.tap(find.text('发送'));
      await tester.pumpAndSettle();
      expect(api.calls.last['sourceKeys'], ['a', 'b']);
      expect(find.text('复核等待实验；修复可以独立推进。'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      await tester.binding.setSurfaceSize(null);
    });
  }
  testWidgets(
      'project checkboxes retain partial membership and save explicit sources',
      (tester) async {
    await fonts(tester);
    await tester.binding.setSurfaceSize(const Size(390, 940));
    final c = fixture(), api = BoardApi();
    c.api = api;
    await tester.pumpWidget(RepaintBoundary(
        key: const ValueKey('capture'),
        child: MaterialApp(
            theme: appTheme(Brightness.light),
            home: Scaffold(body: TrackingBoardPage(controller: c)))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('接入会话'));
    await tester.pumpAndSettle();
    final checkboxes = find.byType(Checkbox);
    await tester.tap(checkboxes.first);
    await tester.pumpAndSettle();
    expect(tester.widget<Checkbox>(checkboxes.first).value, true);
    await tester.tap(checkboxes.at(1));
    await tester.pumpAndSettle();
    expect(tester.widget<Checkbox>(checkboxes.first).value, isNull);
    await shot(tester, 'import-390');
    await tester.enterText(find.byType(TextField).first, '抓取验证');
    await tester.ensureVisible(find.text('保存并整理'));
    await tester.tap(find.text('保存并整理'));
    await tester.pumpAndSettle();
    final request =
        api.calls.firstWhere((r) => r['operation'] == 'tracking_import');
    expect((request['sources'] as List).length, 1);
    expect(request['sources'][0]['session'], 'mini~b');
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
}
