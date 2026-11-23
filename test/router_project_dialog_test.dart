import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/widgets/router_project_dialog.dart';
import 'package:mydex_mobile/models.dart';

void main() {
  setUpAll(() async {
    await (FontLoader('Chinese')
          ..addFont(Future.value(ByteData.sublistView(
              await File('C:/Windows/Fonts/msyh.ttc').readAsBytes()))))
        .load();
    await (FontLoader('MaterialIcons')
          ..addFont(Future.value(ByteData.sublistView(await File(
                  'D:/Software/NFSeeBuild/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf')
              .readAsBytes()))))
        .load();
  });
  for (final width in [390.0, 760.0]) {
    testWidgets(
        'project wizard preserves exact Router Worker workspace resource at $width',
        (tester) async {
      await tester.binding.setSurfaceSize(Size(width, 900));
      Json? result;
      final catalog = <String, dynamic>{
        'sessions': [
          {
            'key': 'pc~r',
            'device': 'pc',
            'session': 'r',
            'toolId': 'codex',
            'title': '默认 Router',
            'mode': 'original-live',
            'capabilities': {'send': 'supported'}
          },
          {
            'key': 'pc~dsh:r',
            'device': 'pc',
            'session': 'dsh:r',
            'toolId': 'deepseek',
            'title': '组织者',
            'mode': 'original-live',
            'capabilities': {'send': 'supported'}
          },
          {
            'key': 'mini~w',
            'device': 'mini',
            'session': 'w',
            'toolId': 'codex',
            'title': '搭塔研究',
            'cwd': 'D:/CAP',
            'mode': 'original-live',
            'capabilities': {'send': 'unsupported'}
          },
        ],
        'workspaces': [
          {
            'key': 'pc~p',
            'device': 'pc',
            'toolId': 'deepseek',
            'name': '研究项目',
            'path': 'D:/Research'
          }
        ],
        'resources': [
          {'id': 'gpu', 'name': '实验服务器'}
        ]
      };
      await tester.pumpWidget(MaterialApp(
          theme: ThemeData(
              fontFamily: 'Chinese',
              colorScheme:
                  ColorScheme.fromSeed(seedColor: const Color(0xff486781)),
              useMaterial3: true),
          home: Builder(
              builder: (context) => Scaffold(
                  body: TextButton(
                      child: const Text('开始'),
                      onPressed: () async {
                        result = await showDialog<Json>(
                            context: context,
                            builder: (_) => RepaintBoundary(
                                key: const ValueKey('capture'),
                                child: RouterProjectDialog(
                                    catalog: catalog,
                                    defaultRouter: const {
                                      'device': 'pc',
                                      'session': 'r'
                                    })));
                      })))));
      await tester.tap(find.text('开始'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'CAP 工作台');
      await tester.pumpAndSettle();
      await tester.tap(find.text('组织者'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('下一步'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('codex · mini'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('D:/CAP'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('搭塔研究'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final boundary = tester.renderObject<RenderRepaintBoundary>(
          find.byKey(const ValueKey('capture')));
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final f =
            File('build/router-review/project-selection-${width.toInt()}.png');
        await f.parent.create(recursive: true);
        await f.writeAsBytes(bytes!.buffer.asUint8List());
        image.dispose();
      });
      await tester.ensureVisible(find.text('服务器 · 资源节点'));
      await tester.tap(find.text('服务器 · 资源节点'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('实验服务器'));
      await tester.tap(find.text('实验服务器'));
      await tester.tap(find.text('下一步'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('研究项目'));
      await tester.tap(find.text('创建项目'));
      await tester.pumpAndSettle();
      expect(result?['routerKey'], 'pc~dsh:r');
      expect(result?['scope'], ['mini~w']);
      expect(result?['workspaceScope'], ['pc~p']);
      expect(result?['resourceScope'], ['gpu']);
      expect(result?.containsKey('execution'), false);
      expect(tester.takeException(), isNull);
      await tester.binding.setSurfaceSize(null);
    });
  }
}
