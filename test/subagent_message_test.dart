import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mydex_mobile/widgets/message.dart';

void main() {
  testWidgets('shows subagent activity and expands details', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: MessageBlock(api: null, message: {
          'id': 'a',
          'type': 'subagent',
          'operation': 'spawnAgent',
          'status': 'inProgress',
          'prompt': '检查问题',
          'agents': [
            {'name': 'review', 'status': 'running', 'message': '正在检查'}
          ]
        }),
      ),
    ));
    expect(find.text('创建子 Agent'), findsOneWidget);
    await tester.tap(find.text('创建子 Agent'));
    await tester.pumpAndSettle();
    expect(find.text('检查问题'), findsOneWidget);
    expect(find.text('review'), findsOneWidget);
    expect(find.text('运行中 · 正在检查'), findsOneWidget);
  });
}
