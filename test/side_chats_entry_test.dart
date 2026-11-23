import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/main.dart';
import 'package:mydex_mobile/models.dart';
import 'package:mydex_mobile/services/api.dart';
import 'client_test.dart' show fixture;

const parentId = 'mini~desktop:11111111-2222-3333-4444-555555555555';
const childRaw = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const childId = 'mini~desktop:$childRaw';

class SideEntryApi extends GatewayApi {
  SideEntryApi(super.settings);
  final List<String> requests = [];
  @override
  Future<Json> get(String path) async {
    requests.add(path);
    if (path.endsWith('/controls')) {
      return {
        'capabilities': {'sideChats': true},
        'sideChats': [
          {'id': childRaw, 'title': '布局与交互讨论', 'ephemeral': true}
        ]
      };
    }
    return {
      'id': childId,
      'title': '布局与交互讨论',
      'deviceId': 'mini',
      'toolId': 'codex',
      'source': 'desktop',
      'status': 'Completed',
      'messages': [
        {'id': 'reply', 'role': 'agent', 'type': 'text', 'text': '这里可以继续侧边讨论。'}
      ]
    };
  }
}

void main() {
  testWidgets(
      'top text opens side chats directly and retains the same parent from a child',
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
    parent['id'] = parentId;
    c.selectedId = parentId;
    c.details.clear();
    c.details[parentId] = parent;
    final api = SideEntryApi(c.settings);
    c.api = api;
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pumpAndSettle();
    expect(
        (tester.getCenter(find.byKey(const ValueKey('side-chats-link'))).dy -
                tester.getCenter(find.byTooltip('连接设置')).dy)
            .abs(),
        lessThanOrEqualTo(1));
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/side-entry-phone.png'));
    await tester.tap(find.byKey(const ValueKey('side-chats-link')));
    await tester.pumpAndSettle();
    expect(find.text('布局与交互讨论'), findsOneWidget);
    expect(
        api.requests, ['/api/tasks/${Uri.encodeComponent(parentId)}/controls']);
    await expectLater(find.byType(MaterialApp),
        matchesGoldenFile('goldens/side-picker-phone.png'));
    await tester.tap(find.text('布局与交互讨论'));
    await tester.pumpAndSettle();
    expect(c.selectedId, childId);
    expect(c.parentChat, parentId);
    expect(find.text('返回主会话'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('side-chats-link')));
    await tester.pumpAndSettle();
    expect(api.requests.last,
        '/api/tasks/${Uri.encodeComponent(parentId)}/controls');
    expect(c.selectedId, childId);
    await tester.tap(find.byTooltip('关闭侧聊列表'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
  testWidgets('generic subagent parent never changes side-chat scope',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    final c = fixture();
    final task = c.selected!;
    task['id'] = parentId;
    c.selectedId = parentId;
    c.details.clear();
    c.details[parentId] = task;
    // A return-navigation relation is not a native side-chat relationship.
    c.parentChats[parentId] =
        'mini~desktop:99999999-2222-3333-4444-555555555555';
    final api = SideEntryApi(c.settings);
    c.api = api;
    await tester.pumpWidget(MydexApp(controller: c));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('side-chats-link')));
    await tester.pumpAndSettle();
    expect(api.requests.last,
        '/api/tasks/${Uri.encodeComponent(parentId)}/controls');
    await tester.tap(find.byTooltip('关闭侧聊列表'));
    await tester.pumpAndSettle();
    // Switching to another conversation must read that conversation, without reusing a list.
    c.selectedId = childId;
    c.details[childId] = {...task, 'id': childId, 'title': '另一个项目的对话'};
    c.notifyListeners();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('side-chats-link')));
    await tester.pumpAndSettle();
    expect(api.requests.last,
        '/api/tasks/${Uri.encodeComponent(childId)}/controls');
    expect(find.text('当前会话：另一个项目的对话'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
    await tester.binding.setSurfaceSize(null);
  });
}
