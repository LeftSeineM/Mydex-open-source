import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/controller.dart';
import 'package:mydex_mobile/pages/router_workspace.dart';
import 'package:mydex_mobile/widgets/router_tree.dart';
import 'package:mydex_mobile/widgets/tool_picker.dart';
import 'client_test.dart' show fixture;
import 'router_workspace_test.dart' show WorkspaceApi;

void main() {
  for (final width in [390.0, 760.0]) {
    testWidgets('Coding menu opens real Router tree and returns at $width', (tester) async {
      final previous = AppController.superagentTest;
      AppController.superagentTest = true;
      addTearDown(() => AppController.superagentTest = previous);
      await tester.binding.setSurfaceSize(Size(width, 1000));
      final c = fixture(), api = WorkspaceApi();
      c.api = api;
      c.devices = [{'id': 'laptop', 'name': '测试电脑', 'online': true}];
      c.tools = [{'id': 'codex', 'deviceId': 'laptop', 'name': 'Codex',
        'capabilities': {'send': true}}];
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: ToolPicker(controller: c))));
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Router · 项目工作台').last);
      await tester.pumpAndSettle();
      expect(find.byType(RouterWorkspacePage), findsOneWidget);
      if(width<720){await tester.tap(find.byTooltip('执行网络'));await tester.pumpAndSettle();}
      expect(find.byType(RouterTree), findsOneWidget);
      expect(c.toolId, 'codex');
      expect(c.selectedId, 'laptop~desktop:router-fixture');
      expect(api.calls, isEmpty); // Opening never dispatches a task.
      await tester.tap(find.byTooltip('项目操作'));await tester.pumpAndSettle();await tester.tap(find.text('电脑原会话'));
      await tester.pumpAndSettle();
      expect(find.byType(RouterWorkspacePage), findsNothing);
      expect(find.byType(ToolPicker), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      c.dispose();
      await tester.binding.setSurfaceSize(null);
    });
  }
  testWidgets('ordinary release does not expose private Router menu', (tester) async {
    final previous = AppController.superagentTest;
    AppController.superagentTest = false;
    addTearDown(() => AppController.superagentTest = previous);
    final c = fixture();
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ToolPicker(controller: c))));
    expect(find.text('Router · 项目工作台'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    c.dispose();
  });
}
