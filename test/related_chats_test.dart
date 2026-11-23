import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/main.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'client_test.dart' show fixture;

class RelatedApi extends GatewayApi {
  RelatedApi(super.settings, this.parent, this.child);
  final Json parent, child;
  final List<String> stopped = [];
  @override
  Future<Json> get(String path) async =>
      path.contains('child') ? child : parent;
  @override
  Future<Json> post(String path, Json body, {String? requestId}) async {
    stopped.add(path);
    if (body['expectedTurnId'] != 'turn-child') throw StateError('错误的运行轮次');
    return {'accepted': true};
  }
}

void main() {
  testWidgets(
      'related thread stays on the same computer and returns to its parent',
      (tester) async {
    await tester.runAsync(() async {
      for (final entry in {
        'MaterialIcons':
            '${Platform.environment['FLUTTER_ROOT']}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
        'sans-serif': 'C:/Windows/Fonts/msyh.ttc',
      }.entries) {
        final file = File(entry.value);
        if (file.existsSync()) {
          await (FontLoader(entry.key)
                ..addFont(
                    Future.value(ByteData.sublistView(file.readAsBytesSync()))))
              .load();
        }
      }
    });
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final c = fixture();
    final parent = c.selected!;
    parent['messages'] = [
      {'id': 'user', 'role': 'user', 'type': 'text', 'text': '请检查手机端的布局和连接逻辑。'},
      {
        'id': 'agents',
        'role': 'agent',
        'type': 'subagent',
        'operation': 'spawnAgent',
        'status': 'inProgress',
        'model': 'Codex',
        'effort': 'high',
        'prompt': '检查布局，保留发现的问题和建议。',
        'agents': [
          {
            'id': 'child',
            'name': '布局检查',
            'status': 'running',
            'message': '正在核查窄屏布局'
          }
        ]
      },
    ];
    final child = <String, dynamic>{
      'id': 'mini~desktop:child',
      'title': '布局检查',
      'deviceId': 'mini',
      'status': 'Running',
      'source': 'desktop',
      'toolId': 'codex',
      'turnId': 'turn-child',
      'canInterrupt': true,
      'messages': [
        {
          'id': 'response',
          'role': 'agent',
          'type': 'text',
          'text': '已开始检查输入区域与折叠屏布局。结果会同步回主会话。'
        }
      ],
    };
    final api = RelatedApi(c.settings, parent, child);
    c.api = api;
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tap(find.text('创建子 Agent'));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.ensureVisible(find.text('布局检查'));
    await tester.pump(const Duration(milliseconds: 500));
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/related-agents-phone.png'));
    await tester.tap(find.text('布局检查'));
    await tester.pump(const Duration(milliseconds: 500));
    expect(c.selectedId, 'mini~desktop:child');
    expect(find.text('返回主会话'), findsOneWidget);
    expect(find.byTooltip('停止当前会话'), findsOneWidget);
    await tester.tap(find.byTooltip('停止当前会话'));
    await tester.pump(const Duration(milliseconds: 500));
    expect(api.stopped.single, '/api/tasks/mini~desktop%3Achild/interrupt');
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/related-child-phone.png'));
    await tester.tap(find.text('返回主会话'));
    await tester.pump(const Duration(milliseconds: 500));
    expect(c.selectedId, parent['id']);
    await tester.binding.setSurfaceSize(const Size(800, 900));
    await tester.pump(const Duration(milliseconds: 500));
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/related-agents-foldable.png'));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
}
